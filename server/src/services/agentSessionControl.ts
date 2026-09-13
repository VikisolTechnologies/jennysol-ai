// Stage B of JENNYSOL-AGENTS-UI-FIRST.md: the human control surface's server-side actions. Every
// function here operates on state that already exists (session/task/agent status, file locks,
// pending actions) — no new domain modeling, just real transitions the Scheduler (Phase 6), the
// session driver (agentSessionRunner.ts), and the approval gate (agentToolRegistry.ts) all already
// respect by construction (a paused/cancelled session's tasks are never selected as "ready" again,
// a cancelled task is a permanent dependency dead-end per agentTaskDag.ts's own documented rule).
import * as sessionStore from "./agentSessionStore.js";
import { listAgentsForSession, updateAgentStatus, getAgent } from "./agentRegistry.js";
import { appendSessionEvent } from "./sessionEventBus.js";
import { releaseAllLocksForSession, releaseLocksHeldByAgent } from "./agentFileLocks.js";
import { rejectAllPendingActionsForSession, rejectPendingActionsForAgent } from "./agentToolRegistry.js";

export class SessionControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionControlError";
  }
}

const NON_TERMINAL_TASK_STATUSES: readonly sessionStore.AgentTaskStatus[] = [
  "pending",
  "ready",
  "queued",
  "running",
  "blocked",
  "awaiting_approval",
];
const NON_TERMINAL_AGENT_STATUSES = ["idle", "planning", "working", "waiting", "blocked", "reviewing", "auditing"];

export function pauseSession(sessionId: string): void {
  const session = sessionStore.getSessionUnscoped(sessionId);
  if (!session) throw new SessionControlError(`Session ${sessionId} not found`);
  if (session.status === "paused") return;
  if (session.status !== "running" && session.status !== "planning") {
    throw new SessionControlError(`Session ${sessionId} cannot be paused from status "${session.status}"`);
  }
  sessionStore.updateSessionStatus(sessionId, "paused");
  appendSessionEvent({ sessionId, type: "session.status_changed", payload: { status: "paused", reason: "human_requested" } });
}

// Only flips the durable status — agentSessionRunner.ts's drive loop is already alive, idle-polling
// while paused, and notices the change on its own next check. Safe to call even if no loop happens
// to be alive right now (e.g. after a process restart) because the route that calls this also
// re-invokes driveSession(), which is a no-op if a loop is already running.
export function resumeSession(sessionId: string): void {
  const session = sessionStore.getSessionUnscoped(sessionId);
  if (!session) throw new SessionControlError(`Session ${sessionId} not found`);
  if (session.status !== "paused") {
    throw new SessionControlError(`Session ${sessionId} is not paused (status: "${session.status}")`);
  }
  sessionStore.updateSessionStatus(sessionId, "running");
  appendSessionEvent({ sessionId, type: "session.status_changed", payload: { status: "running", reason: "human_requested" } });
}

// "Cancel a run cleanly: locks released, partial state recorded, no orphaned agents" (Stage B §3).
export function cancelSession(sessionId: string): void {
  const session = sessionStore.getSessionUnscoped(sessionId);
  if (!session) throw new SessionControlError(`Session ${sessionId} not found`);
  if (session.status === "completed" || session.status === "cancelled" || session.status === "failed") return;

  for (const task of sessionStore.listTasksForSession(sessionId)) {
    if (NON_TERMINAL_TASK_STATUSES.includes(task.status)) {
      sessionStore.updateTaskStatus(sessionId, task.id, "cancelled");
      appendSessionEvent({
        sessionId,
        agentId: task.agentId ?? undefined,
        taskId: task.id,
        type: "task.cancelled",
        payload: { reason: "session_cancelled" },
      });
    }
  }
  for (const agent of listAgentsForSession(sessionId)) {
    if (NON_TERMINAL_AGENT_STATUSES.includes(agent.status)) {
      updateAgentStatus(sessionId, agent.id, "cancelled", { currentTaskId: null });
    }
  }
  rejectAllPendingActionsForSession(sessionId);
  releaseAllLocksForSession(sessionId);
  sessionStore.updateSessionStatus(sessionId, "cancelled");
  appendSessionEvent({ sessionId, type: "session.status_changed", payload: { status: "cancelled", reason: "human_requested" } });
}

// "Kill a single agent without tearing down the whole DAG" (Stage B §3) — only this agent's own
// current task, locks, and pending actions are touched; sibling tasks/agents run on untouched. Any
// task depending on this agent's cancelled task simply never becomes ready (agentTaskDag.ts's
// existing, documented rule: a cancelled dependency permanently excludes it) — no separate logic
// needed here to propagate that.
export function killAgent(sessionId: string, agentId: string): void {
  const agent = getAgent(sessionId, agentId);
  if (!agent) throw new SessionControlError(`Agent ${agentId} not found in session ${sessionId}`);

  if (agent.currentTaskId) {
    const task = sessionStore.getTask(sessionId, agent.currentTaskId);
    if (task && NON_TERMINAL_TASK_STATUSES.includes(task.status)) {
      sessionStore.updateTaskStatus(sessionId, task.id, "cancelled");
      appendSessionEvent({
        sessionId,
        agentId,
        taskId: task.id,
        type: "task.cancelled",
        payload: { reason: "agent_killed" },
      });
    }
  }
  rejectPendingActionsForAgent(sessionId, agentId);
  releaseLocksHeldByAgent(sessionId, agentId);
  updateAgentStatus(sessionId, agentId, "cancelled", { currentTaskId: null });
  appendSessionEvent({ sessionId, agentId, type: "agent.status_changed", payload: { status: "cancelled", reason: "human_killed" } });
}
