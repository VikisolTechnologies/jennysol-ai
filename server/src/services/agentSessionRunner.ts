// Stage A of JENNYSOL-AGENTS-UI-FIRST.md: a real gap found while planning the live dashboard —
// nothing before this stage actually drove a session end-to-end outside of a test manually calling
// runRoleTask() task-by-task. The Scheduler (Phase 6, agentScheduler.ts) arbitrates one tick;
// runRoleTask (Phase 9, agentOrchestrator.ts) executes one task; this module is the missing loop that
// calls tick() repeatedly, with the role-aware executor, until the session is actually finished —
// the thing a real "start a session" API route needs to kick off, and the thing the live dashboard
// needs running for there to be anything real to watch.
import * as sessionStore from "./agentSessionStore.js";
import { tick } from "./agentScheduler.js";
import { runRoleTask } from "./agentOrchestrator.js";
import { readyTasks } from "./agentTaskDag.js";
import { appendSessionEvent } from "./sessionEventBus.js";

// A task in one of these statuses has a real executor promise still alive somewhere inside tick()
// (running or genuinely awaiting a human decision) — the loop must never declare deadlock while any
// task is still in-flight, since it will resolve itself.
const IN_FLIGHT_TASK_STATUSES = new Set<sessionStore.AgentTaskStatus>(["queued", "running", "awaiting_approval"]);

let tickIntervalMs = 1000;

// One entry per currently-driven session, in this one process — same single-instance caveat as
// every other in-memory map in this codebase (sessionEventBus.ts, agentFileLocks.ts,
// agentToolRegistry.ts). Guards against ever running two competing drive loops for the same session
// (e.g. a resume route call landing while the original loop is still alive and merely idle-polling a
// paused session).
const activeRunners = new Set<string>();

function isTerminalSessionStatus(status: sessionStore.AgentSessionStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

function isTerminalTaskStatus(status: sessionStore.AgentTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// Fire-and-forget by design, same shape as chatRunner's executeChatRun: the route that starts a
// session returns as soon as the session row exists, and this keeps running in the background,
// writing real, durable events the whole way — a disconnected or never-connected dashboard client
// loses nothing (sessionEventBus.ts's own durable-first guarantee).
//
// `executor` defaults to the real runRoleTask and is only ever overridden by tests, matching
// agentScheduler.tick()'s own convention — this is what makes "the loop actually keeps ticking until
// the session is done" directly, deterministically testable without a real or mocked LLM call.
export async function driveSession(
  sessionId: string,
  executor: (sessionId: string, taskId: string) => Promise<void> = runRoleTask
): Promise<void> {
  if (activeRunners.has(sessionId)) return;
  activeRunners.add(sessionId);
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const session = sessionStore.getSessionUnscoped(sessionId);
      if (!session) return;
      if (isTerminalSessionStatus(session.status)) return;
      if (session.status === "paused") {
        await new Promise((r) => setTimeout(r, tickIntervalMs));
        continue;
      }

      const result = await tick(sessionId, executor);

      // tick() already recorded the pause itself (status + event) when a budget was hit — this loop
      // just needs to stop dispatching and keep idling until a human resumes or cancels it.
      if (result.pausedForBudget) {
        await new Promise((r) => setTimeout(r, tickIntervalMs));
        continue;
      }

      const tasks = sessionStore.listTasksForSession(sessionId);
      if (tasks.length > 0 && tasks.every((t) => isTerminalTaskStatus(t.status))) {
        const anyFailed = tasks.some((t) => t.status === "failed");
        sessionStore.updateSessionStatus(sessionId, anyFailed ? "failed" : "completed");
        appendSessionEvent({
          sessionId,
          type: "session.status_changed",
          payload: { status: anyFailed ? "failed" : "completed" },
        });
        return;
      }

      // Real deadlock, found live (JENNY_IMPLEMENTATION_STATUS.md's Stage D group 3 entry): nothing
      // ready, nothing in flight, yet at least one task is still non-terminal — this can only happen
      // when every remaining task is a permanent dependency dead-end on a failed/cancelled task
      // (agentTaskDag.ts's own documented "no automatic unblock" rule: a dependency that's failed or
      // cancelled excludes a task from readyTasks() forever). A task genuinely "awaiting_approval" is
      // excluded from this by IN_FLIGHT_TASK_STATUSES — it still has a live executor promise inside
      // tick() and will resolve itself the moment a human decides, so this can never misfire on a
      // session that's merely waiting on one. Before this check, a session like that looped here
      // forever, permanently "running" on the dashboard with no further progress possible and no way
      // for a human to tell the difference between "waiting" and "stuck" without reading the DAG by
      // hand.
      const nothingInFlight = !tasks.some((t) => IN_FLIGHT_TASK_STATUSES.has(t.status));
      const nothingReady = readyTasks(sessionId).length === 0;
      const somethingStillPending = tasks.some((t) => !isTerminalTaskStatus(t.status));
      if (nothingInFlight && nothingReady && somethingStillPending) {
        sessionStore.updateSessionStatus(sessionId, "failed");
        appendSessionEvent({
          sessionId,
          type: "session.status_changed",
          payload: { status: "failed", reason: "deadlocked_on_failed_dependency" },
        });
        return;
      }

      await new Promise((r) => setTimeout(r, tickIntervalMs));
    }
  } finally {
    activeRunners.delete(sessionId);
  }
}

export function isDrivingSession(sessionId: string): boolean {
  return activeRunners.has(sessionId);
}

export function __resetSessionRunnerForTests(): void {
  activeRunners.clear();
  tickIntervalMs = 1000;
}

export function __setTickIntervalMsForTests(ms: number): void {
  tickIntervalMs = ms;
}

// Stage C §5.3 (checkpoints): the real "resume after a process restart" gap flagged when this loop
// was first built (activeRunners is in-memory only — a session left "running" when the process died
// has no loop left driving it, and nothing before this stage ever restarted one). Called once at
// server boot. A task stuck "running" or "awaiting_approval" when the process died has no real
// executor promise left behind it — the actual work is gone even though the row says otherwise — so
// each is reset to a clean 'pending' via the same resetTaskForRetry the manual retry route uses
// before the session's loop is re-invoked, rather than leaving it stuck forever (readyTasks() never
// re-selects a non-'pending' task) or silently marking it 'completed' with no real evidence it ran.
// Deliberately does NOT touch a session stuck in "planning" — that would mean re-running a real LLM
// decomposition call the operator never explicitly asked for again; left for a human to notice and
// retry via the dashboard instead.
export function resumeInFlightSessionsOnBoot(
  executor: (sessionId: string, taskId: string) => Promise<void> = runRoleTask
): void {
  for (const session of sessionStore.listAllSessions()) {
    if (session.status !== "running") continue;
    for (const task of sessionStore.listTasksForSession(session.id)) {
      if (task.status === "running" || task.status === "awaiting_approval") {
        sessionStore.resetTaskForRetry(session.id, task.id);
        appendSessionEvent({
          sessionId: session.id,
          agentId: task.agentId ?? undefined,
          taskId: task.id,
          type: "task.retried",
          payload: { title: task.title, reason: "process_restart" },
        });
      }
    }
    driveSession(session.id, executor).catch(() => {});
  }
}
