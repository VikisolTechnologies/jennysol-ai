// Phase 6 of docs/AI_AGENT_IMPLEMENTATION_PLAN.md: the Scheduler loop + Resource Manager
// (architecture doc §6) — the concrete mechanism behind "many logical agents, few concurrent model
// executions." No new infra (per architecture doc §4): this is an in-process counter and a
// wait-queue, generalizing providers/ollama.ts's existing single-provider concurrency gate to
// arbitrate every agent-task execution, not just Ollama's.
//
// Global, not per-session, on purpose: the scarce resource this exists to protect (this machine's
// real local-model concurrency) is shared across every session that might be running at once, the
// same way providers/ollama.ts's own gate already is. Per-session budgets (below) are the separate,
// per-session concern.
import { getHardwareProfile } from "./models/hardwareProfile.js";
import * as sessionStore from "./agentSessionStore.js";
import type { AgentSession } from "./agentSessionStore.js";
import { readyTasks } from "./agentTaskDag.js";
import { runAgentTask } from "./agentTaskRunner.js";
import { appendSessionEvent } from "./sessionEventBus.js";
import { listAgentsForSession } from "./agentRegistry.js";

let maxConcurrentSlotsOverride: number | null = null;
let runningCount = 0;

function maxConcurrentSlots(): number {
  return maxConcurrentSlotsOverride ?? getHardwareProfile().maxConcurrentLocalRuns;
}

function hasFreeSlot(): boolean {
  return runningCount < maxConcurrentSlots();
}

// SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC with no timezone marker — this is
// the one, established parse for that shape already implicit elsewhere in this codebase's use of
// the same column format; made explicit here since this is the first place that does arithmetic on
// it rather than just displaying it.
function parseUtc(sqliteDatetime: string): number {
  return new Date(sqliteDatetime.replace(" ", "T") + "Z").getTime();
}

// Real, computed from actual data — NOT max_cost. max_cost is accepted and stored (Phase 1's
// schema) but deliberately not enforced here: no $/token pricing table exists anywhere in this
// codebase (confirmed by inspection — COST-BASELINE.md tracks token counts, not a real per-model
// price list), and inventing one to satisfy this field would be exactly the kind of guessed number
// this engagement has avoided everywhere else. Flagged here as a real, open gap, not silently
// skipped.
function budgetExceeded(session: AgentSession, agentTokensUsed: number): "time" | "tokens" | null {
  if (session.maxSessionTimeMs != null) {
    const elapsedMs = Date.now() - parseUtc(session.createdAt);
    if (elapsedMs >= session.maxSessionTimeMs) return "time";
  }
  if (session.maxTokenBudget != null && agentTokensUsed >= session.maxTokenBudget) {
    return "tokens";
  }
  return null;
}

export interface TickResult {
  dispatched: string[]; // task ids actually granted a slot and started this tick
  pausedForBudget: "time" | "tokens" | null;
}

// One iteration of the Scheduler loop for one session (architecture doc §6's (a)-(c)): find ready
// tasks, ask the Resource Manager for a slot, and — only once actually granted — transition the
// task pending -> running and execute it. Not a setInterval itself; the caller decides cadence (real
// production wiring is Phase 9+'s job, once there's a real orchestrator loop to drive it) — this
// function is the one, directly-testable unit of "what happens on one tick."
//
// `executor` defaults to the real runAgentTask and is only ever overridden by tests, to observe
// real concurrency behavior without waiting on real model calls.
export async function tick(
  sessionId: string,
  executor: (sessionId: string, taskId: string) => Promise<void> = runAgentTask
): Promise<TickResult> {
  const session = sessionStore.getSessionUnscoped(sessionId);
  if (!session) return { dispatched: [], pausedForBudget: null };
  // Stage B of JENNYSOL-AGENTS-UI-FIRST.md: a human pause/cancel must actually stop dispatch, not
  // just be a label the driver loop happens to also check — this is the Scheduler's own job as the
  // sole authority on pending -> running transitions (this file's own header comment).
  if (session.status === "paused" || session.status === "cancelled" || session.status === "completed" || session.status === "failed") {
    return { dispatched: [], pausedForBudget: null };
  }

  const agentsTokensUsed = listAgentsForSession(sessionId).reduce((sum, a) => sum + a.tokensUsed, 0);
  const budgetHit = budgetExceeded(session, agentsTokensUsed);
  if (budgetHit) {
    // session.status is already narrowed to "planning" | "running" here (the guard above returns
    // early for every other status), so it can never already be "paused" at this point.
    sessionStore.updateSessionStatus(sessionId, "paused");
    appendSessionEvent({
      sessionId,
      type: "session.status_changed",
      payload: { status: "paused", reason: `budget_exceeded:${budgetHit}` },
    });
    return { dispatched: [], pausedForBudget: budgetHit };
  }

  // Only tasks already assigned to an agent are dispatchable — assigning one is Phase 9's
  // Orchestrator's job, out of this phase's scope (concurrency/budget arbitration only). Priority
  // descending, then FIFO by creation time for ties.
  const candidates = readyTasks(sessionId)
    .filter((t) => t.agentId !== null)
    .sort((a, b) => b.priority - a.priority || parseUtc(a.createdAt) - parseUtc(b.createdAt));

  const dispatched: string[] = [];
  for (const task of candidates) {
    if (!hasFreeSlot()) break;
    runningCount++;
    dispatched.push(task.id);
    // The Scheduler itself owns the pending -> running transition (architecture doc §6) so a
    // second tick() call — real or in a test — never re-selects a task already granted a slot,
    // regardless of what a given executor does or doesn't do internally.
    sessionStore.updateTaskStatus(sessionId, task.id, "running", { agentId: task.agentId! });
    appendSessionEvent({ sessionId, agentId: task.agentId!, taskId: task.id, type: "task.ready" });
    executor(sessionId, task.id)
      .catch(() => {
        // A real executor (runAgentTask) already records its own failure as a real task.failed
        // event and re-throws — this loop's job is only to always release the slot, never to
        // swallow or duplicate that reporting.
      })
      .finally(() => {
        runningCount--;
      });
  }
  return { dispatched, pausedForBudget: null };
}

export function getRunningCount(): number {
  return runningCount;
}

export function __setMaxConcurrentSlotsForTests(n: number | null): void {
  maxConcurrentSlotsOverride = n;
}

export function __resetSchedulerForTests(): void {
  maxConcurrentSlotsOverride = null;
  runningCount = 0;
}
