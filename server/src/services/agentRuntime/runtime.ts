// JENNYSOL-ARCHITECTURE.md §3 — the Agent Runtime loop. Deliberately a thin wrapper around
// infrastructure that already exists and is already tested: routeChatCompletion's own tool-calling
// (the same mechanism routes/agentGateway.ts uses for Arena) does the actual planning and
// multi-round tool use; this module adds persistence (so a run is visible and stoppable from
// outside the single HTTP request that started it), a real budget, and the exact same
// propose->approve->execute path for WRITE tools that Arena's gateway already proves works —
// never a second approval mechanism.
import { randomUUID } from "node:crypto";
import { routeChatCompletion } from "../modelRouter.js";
import type { ToolCall } from "../llmProvider.js";
import { toolRegistry } from "../tools/registryInstance.js";
import { proposeAction } from "../tools/pendingActions.js";
import { ToolRejectedError } from "../tools/productConnector.js";
import type { ProductIdentity } from "../productIdentity.js";
import { createRun, updateRun, getOwnedRun, appendStep, finishStep, getSteps } from "./store.js";
import { AgentGoalRunError, DEFAULT_BUDGET, type AgentGoalRun, type AgentGoalRunBudget } from "./types.js";

const RUNTIME_SYSTEM_PROMPT =
  "You are Jenny, working on a goal for this user through real tools. Use only the tools you're " +
  "given; never claim you did something a tool result doesn't confirm. Stop and give your final " +
  "answer as soon as the goal is genuinely met — don't call more tools than the goal needs. If a " +
  "tool result tells you an action is awaiting the user's approval, say so plainly rather than " +
  "claiming it already happened.";

// Cancellation is the SAME AbortController pattern agentCommandTool.ts and modelRouter.ts's own
// outerSignal already use elsewhere in this codebase — not a new mechanism. One entry per
// in-flight run; cleared as soon as the run leaves "running" for any reason.
const activeControllers = new Map<string, AbortController>();

export async function startRun(
  identity: ProductIdentity,
  goal: string,
  budget: AgentGoalRunBudget = DEFAULT_BUDGET,
  // Independent review finding #1: a READ tool never needs this, but a WRITE tool that calls back
  // into its own product's authenticated API (same reasoning as ToolExecutionContext's own doc
  // comment) does — and this had no way to receive one at all before, silently hardcoding "". No
  // real caller is broken by adding it (nothing calls startRun() over HTTP yet), but the moment a
  // route wires this up for a real signed-in user, the real token has somewhere to go.
  rawToken = ""
): Promise<AgentGoalRun> {
  const run = createRun(identity, goal, budget);
  run.status = "running";
  updateRun(run);

  const controller = new AbortController();
  activeControllers.set(run.id, controller);
  const startedAt = Date.now();

  const availableTools = toolRegistry.getToolsFor(identity);
  const tools = availableTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  let stepIndex = 0;
  let budgetExceeded = false;

  try {
    let content = "";
    await routeChatCompletion(
      RUNTIME_SYSTEM_PROMPT,
      [{ role: "user", content: goal }],
      (delta) => {
        content += delta;
      },
      undefined,
      "general",
      controller.signal,
      tools.length ? tools : undefined,
      tools.length
        ? async (call: ToolCall) => {
            // Budget is enforced BEFORE a tool actually runs, not just checked after — a run
            // that's already over budget must not sneak in "one more" tool call.
            if (stepIndex >= run.budget.maxSteps || Date.now() - startedAt >= run.budget.maxMs) {
              budgetExceeded = true;
              controller.abort();
              throw new AgentGoalRunError("Budget exceeded — no further tool calls");
            }
            const index = stepIndex++;
            const step = appendStep(run.id, index, "tool_call", call.name, call.args);
            run.spentMs = Date.now() - startedAt;
            updateRun(run);

            const tier = toolRegistry.getTier(identity, call.name);
            try {
              if (tier === "WRITE") {
                // Independent review finding #2: a run must never carry TWO live proposals. Before
                // this fix, a model that proposed a second WRITE action before finishing its turn
                // silently created a second, independently-approvable PendingAction and overwrote
                // run.pendingActionId — orphaning the first one from the run's own view while it
                // stayed live and single-use-approvable to anyone who still had its id. That's a
                // real path to two side effects (e.g. two job applications) from what looks like
                // one pause. Once this run already has a pending approval, refuse the next WRITE
                // call outright — the run stays paused on the FIRST proposal until it's decided.
                if (run.status === "awaiting_approval") {
                  // A known, expected business condition — same treatment as ToolRejectedError
                  // below: reported to the model as data so it can explain itself, never thrown
                  // all the way out to end the turn over something this ordinary.
                  const message =
                    "This run is already waiting on your approval for a previous action — decide that one before anything else can happen.";
                  finishStep(step.id, undefined, message);
                  return { error: message };
                }
                // Identical shape to routes/agentGateway.ts's own WRITE-tier handling — the
                // SAME pendingActions store and the SAME /api/agent/gateway/actions/:id route
                // resolves it, whichever product's identity is asking. Deliberately does NOT
                // abort here: the model still gets to finish its turn with a natural reply
                // ("this needs your approval") exactly like the gateway route does — aborting
                // would race the model's own continuation against cancellation for no reason.
                const action = proposeAction(identity, call.name, call.args);
                run.status = "awaiting_approval";
                run.pendingActionId = action.id;
                updateRun(run);
                const result = { status: "awaiting_user_approval", actionId: action.id };
                finishStep(step.id, result);
                return result;
              }
              const result = await toolRegistry.dispatch(identity, call.name, call.args, { rawToken });
              finishStep(step.id, result);
              return result;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              finishStep(step.id, undefined, message);
              if (err instanceof ToolRejectedError) return { error: message };
              throw err;
            }
          }
        : undefined
    );
    run.content = content;
    if (run.status === "running") {
      // Only reachable if the model finished without the budget guard or an approval pause
      // having already moved status elsewhere.
      appendStep(run.id, stepIndex, "final_answer");
      run.status = "completed";
      run.stopReason = "completed";
    }
  } catch (err) {
    if (budgetExceeded) {
      run.status = "failed";
      run.stopReason = "budget_exceeded";
    } else if (controller.signal.aborted && run.status === "running") {
      run.status = "cancelled";
      run.stopReason = "cancelled_by_user";
    } else if (run.status === "running") {
      run.status = "failed";
      run.stopReason = "provider_failed";
      run.content = err instanceof Error ? err.message : String(err);
    }
  } finally {
    run.spentMs = Date.now() - startedAt;
    updateRun(run);
    activeControllers.delete(run.id);
  }

  return run;
}

// Stoppable from outside the call that started it — the DoD's own "the user can see what Jenny
// is doing and stop it." Works whether or not the run is still literally in-flight in this
// process: an already-finished run just gets its terminal state confirmed back, never an error
// for stopping something that's already over.
export function stopRun(runId: string, identity: ProductIdentity): AgentGoalRun {
  const run = getOwnedRun(runId, identity);
  if (!run) throw new AgentGoalRunError("No such run");
  const controller = activeControllers.get(runId);
  if (controller) controller.abort();
  if (run.status === "running" || run.status === "queued") {
    run.status = "cancelled";
    run.stopReason = "cancelled_by_user";
    updateRun(run);
  }
  return run;
}

export function getRun(runId: string, identity: ProductIdentity): { run: AgentGoalRun; steps: ReturnType<typeof getSteps> } | undefined {
  const run = getOwnedRun(runId, identity);
  if (!run) return undefined;
  return { run, steps: getSteps(runId) };
}

export const __testing = { activeControllers };
