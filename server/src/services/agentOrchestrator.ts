// Phase 9 of docs/AI_AGENT_IMPLEMENTATION_PLAN.md: the first 4 real roles working together.
// decomposeObjective() is the Orchestrator role made real — the founding directive's own §9 worked
// example (a user objective becoming a real, dependency-ordered agent_tasks graph), not a fixture.
// runRoleTask() is the role-aware dispatcher: Architect and Coder run through the existing
// runAgentTask() (Phase 5) with a role-specific prompt and a real post-processing step; QA never
// calls an LLM at all (architecture doc §9/§12: a verdict must cite real evidence, never a model's
// own unverified "this passes") — it runs a real command through the exact same propose/approve gate
// every WRITE-tier tool uses (Phase 7/8) and reports PASS/FAIL from the real exit code.
import type { ChatTurn } from "./llmProvider.js";
import { routeChatCompletion } from "./modelRouter.js";
import * as sessionStore from "./agentSessionStore.js";
import type { AgentTask } from "./agentSessionStore.js";
import { spawnAgent, getAgent, updateAgentStatus, type Agent } from "./agentRegistry.js";
import { createTaskBatch, type TaskDraft } from "./agentTaskDag.js";
import { runAgentTask } from "./agentTaskRunner.js";
import { proposeAgentAction, awaitApprovalDecision } from "./agentToolRegistry.js";
import { appendSessionEvent } from "./sessionEventBus.js";
import { extractJson } from "./agentJsonExtract.js";
import { writeSessionMemory } from "./agentMemoryWriteScope.js";
import { ORCHESTRATOR_SYSTEM_PROMPT, ARCHITECT_SYSTEM_PROMPT, CODER_SYSTEM_PROMPT } from "./agentRolePrompts.js";

export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

interface OrchestratorTaskSpec {
  localId: string;
  role: "architect" | "coder" | "qa";
  title: string;
  description?: string;
  dependsOn: string[];
}

function validateSpecs(value: unknown): OrchestratorTaskSpec[] {
  if (!Array.isArray(value)) throw new OrchestratorError("Orchestrator output was not a JSON array");
  return value.map((v, i) => {
    if (typeof v !== "object" || v === null) throw new OrchestratorError(`Task ${i} in orchestrator output is not an object`);
    const obj = v as Record<string, unknown>;
    if (typeof obj.localId !== "string") throw new OrchestratorError(`Task ${i} is missing a string "localId"`);
    if (obj.role !== "architect" && obj.role !== "coder" && obj.role !== "qa") {
      throw new OrchestratorError(`Task "${obj.localId}" has invalid role "${String(obj.role)}" — must be architect/coder/qa`);
    }
    if (typeof obj.title !== "string") throw new OrchestratorError(`Task "${obj.localId}" is missing a string "title"`);
    return {
      localId: obj.localId,
      role: obj.role,
      title: obj.title,
      description: typeof obj.description === "string" ? obj.description : undefined,
      dependsOn: Array.isArray(obj.dependsOn) ? obj.dependsOn.filter((d): d is string => typeof d === "string") : [],
    };
  });
}

export interface DecomposeResult {
  orchestratorAgentId: string;
  tasks: AgentTask[];
}

// Real, live: a real routeChatCompletion() call, real JSON parsing (honest failure if unparseable —
// agentJsonExtract.ts — never a silently-empty task list), real agents spawned per role actually
// referenced, real createTaskBatch() insert (with real cycle/self-dependency rejection already
// proven in Phase 3).
export async function decomposeObjective(sessionId: string, objective: string): Promise<DecomposeResult> {
  const orchestrator = spawnAgent(sessionId, "orchestrator");
  writeSessionMemory(sessionId, orchestrator.id, "requirements", { objective });
  updateAgentStatus(sessionId, orchestrator.id, "planning");
  appendSessionEvent({
    sessionId,
    agentId: orchestrator.id,
    type: "task.started",
    payload: { title: "Decompose objective" },
  });

  const history: ChatTurn[] = [{ role: "user", content: objective }];
  let fullText = "";
  try {
    const result = await routeChatCompletion(
      ORCHESTRATOR_SYSTEM_PROMPT,
      history,
      (delta) => {
        fullText += delta;
      },
      undefined,
      "reasoning"
    );

    const specs = validateSpecs(extractJson(fullText));
    if (specs.length === 0) throw new OrchestratorError("Orchestrator produced zero tasks");

    const agentByRole = new Map<string, string>();
    for (const spec of specs) {
      if (!agentByRole.has(spec.role)) {
        agentByRole.set(spec.role, spawnAgent(sessionId, spec.role).id);
      }
    }

    const drafts: TaskDraft[] = specs.map((s) => ({
      localId: s.localId,
      title: s.title,
      description: s.description,
      dependsOn: s.dependsOn,
    }));
    const created = createTaskBatch(sessionId, drafts);
    for (let i = 0; i < created.length; i++) {
      sessionStore.updateTaskStatus(sessionId, created[i].id, "pending", { agentId: agentByRole.get(specs[i].role)! });
    }

    updateAgentStatus(sessionId, orchestrator.id, "completed", {
      addTokensUsed: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
      modelProvider: result.providerUsed,
      modelId: result.model,
    });
    appendSessionEvent({
      sessionId,
      agentId: orchestrator.id,
      type: "task.completed",
      payload: { title: "Decompose objective", tasksCreated: created.length, provider: result.providerUsed },
    });

    return { orchestratorAgentId: orchestrator.id, tasks: sessionStore.listTasksForSession(sessionId) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAgentStatus(sessionId, orchestrator.id, "failed");
    appendSessionEvent({
      sessionId,
      agentId: orchestrator.id,
      type: "task.failed",
      payload: { title: "Decompose objective", error: message },
    });
    throw err;
  }
}

function fail(
  sessionId: string,
  taskId: string,
  agentId: string,
  message: string
): never {
  sessionStore.updateTaskStatus(sessionId, taskId, "failed", { result: { error: message } });
  updateAgentStatus(sessionId, agentId, "failed", { currentTaskId: null });
  appendSessionEvent({ sessionId, agentId, taskId, type: "task.failed", payload: { error: message } });
  throw new OrchestratorError(message);
}

// QA's own real-evidence execution path — no LLM call. The task's own `description` carries the
// exact {cwd, command, args} to run, produced by the Orchestrator as part of its decomposition.
async function runQaTask(sessionId: string, taskId: string, task: AgentTask, agent: Agent): Promise<void> {
  sessionStore.updateTaskStatus(sessionId, taskId, "running", { agentId: agent.id });
  updateAgentStatus(sessionId, agent.id, "working", { currentTaskId: taskId });
  appendSessionEvent({ sessionId, agentId: agent.id, taskId, type: "task.started", payload: { title: task.title } });

  let spec: { cwd: string; command: string; args: string[] };
  try {
    spec = JSON.parse(task.description ?? "") as typeof spec;
  } catch {
    fail(sessionId, taskId, agent.id, `QA task "${task.title}" has an unparseable command spec in its description`);
  }

  let result: { exitCode: number | null };
  try {
    const action = proposeAgentAction(sessionId, agent.id, "exec.command", spec);
    sessionStore.updateTaskStatus(sessionId, taskId, "awaiting_approval");
    appendSessionEvent({
      sessionId,
      agentId: agent.id,
      taskId,
      type: "task.awaiting_approval",
      payload: { actionId: action.id, tool: "exec.command", command: spec.command, args: spec.args },
    });
    // Stage B: a real human decision, not a self-approval — this promise only resolves when the
    // admin approval-queue route (or this action's own TTL) actually decides. See
    // agentToolRegistry.ts's awaitApprovalDecision.
    const decision = await awaitApprovalDecision(action.id);
    if (!decision.approved) {
      throw new Error(`QA command was rejected${decision.error ? `: ${decision.error}` : ""}`);
    }
    result = decision.result as { exitCode: number | null };
  } catch (err) {
    fail(sessionId, taskId, agent.id, err instanceof Error ? err.message : String(err));
  }

  const passed = result.exitCode === 0;
  sessionStore.updateTaskStatus(sessionId, taskId, passed ? "completed" : "failed", { result });
  updateAgentStatus(sessionId, agent.id, passed ? "completed" : "failed", { currentTaskId: null });
  appendSessionEvent({
    sessionId,
    agentId: agent.id,
    taskId,
    type: passed ? "task.completed" : "task.failed",
    payload: { exitCode: result.exitCode },
  });
  if (!passed) throw new OrchestratorError(`QA check failed for task "${task.title}" (exit code ${result.exitCode})`);
}

// The one entry point Phase 6's Scheduler (or a direct test) calls per task — dispatches to the
// right execution shape for whichever of the 4 roles owns this task.
export async function runRoleTask(sessionId: string, taskId: string): Promise<void> {
  const task = sessionStore.getTask(sessionId, taskId);
  if (!task) throw new OrchestratorError(`Task ${taskId} not found in session ${sessionId}`);
  if (!task.agentId) throw new OrchestratorError(`Task ${taskId} has no agent assigned yet`);
  const agent = getAgent(sessionId, task.agentId);
  if (!agent) throw new OrchestratorError(`Agent ${task.agentId} not found in session ${sessionId}`);

  if (agent.role === "qa") {
    return runQaTask(sessionId, taskId, task, agent);
  }

  const systemPromptOverride = agent.role === "architect" ? ARCHITECT_SYSTEM_PROMPT : agent.role === "coder" ? CODER_SYSTEM_PROMPT : undefined;

  return runAgentTask(sessionId, taskId, {
    systemPromptOverride,
    onComplete: async (fullText, ctx) => {
      if (ctx.agent.role === "architect") {
        writeSessionMemory(sessionId, ctx.agent.id, "architecture", { note: fullText.trim() });
        return;
      }
      if (ctx.agent.role === "coder") {
        const parsed = extractJson(fullText) as Record<string, unknown>;
        if (typeof parsed.filePath !== "string" || typeof parsed.content !== "string") {
          throw new OrchestratorError(`Coder output for task "${ctx.task.title}" is missing filePath/content`);
        }
        const action = proposeAgentAction(sessionId, ctx.agent.id, "file.write", {
          filePath: parsed.filePath,
          content: parsed.content,
        });
        sessionStore.updateTaskStatus(sessionId, ctx.task.id, "awaiting_approval");
        appendSessionEvent({
          sessionId,
          agentId: ctx.agent.id,
          taskId: ctx.task.id,
          type: "task.awaiting_approval",
          payload: { actionId: action.id, tool: "file.write", filePath: parsed.filePath },
        });
        // Stage B: real human decision — see the identical note in runQaTask above.
        const decision = await awaitApprovalDecision(action.id);
        if (!decision.approved) {
          throw new OrchestratorError(
            `File write for task "${ctx.task.title}" was rejected${decision.error ? `: ${decision.error}` : ""}`
          );
        }
        const existing = sessionStore.getMemory(sessionId, "changed_files");
        const files = Array.isArray(existing?.value) ? (existing!.value as string[]) : [];
        writeSessionMemory(sessionId, ctx.agent.id, "changed_files", [...files, parsed.filePath]);
      }
    },
  });
}
