import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";

// The AgentSession state machine — same shape as AgentRunStatus (agentRunStore.ts) one level up:
// a session groups many agent_tasks the way a run groups its own event log, and is the thing a
// disconnected dashboard client recovers from. See docs/AI_AGENT_SYSTEM_ARCHITECTURE.md §5.
export type AgentSessionStatus = "planning" | "running" | "paused" | "completed" | "cancelled" | "failed";

// Mirrors architecture doc §5's agent_tasks.status enum exactly. "ready" (every dependency
// completed) vs. "queued" (ready AND granted an execution slot) is the literal distinction Phase 6's
// Resource Manager needs — kept as separate states from Phase 1 on rather than collapsed later.
export type AgentTaskStatus =
  | "pending"
  | "ready"
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentSession {
  id: string;
  userId: string;
  objective: string;
  status: AgentSessionStatus;
  maxSessionTimeMs: number | null;
  maxTokenBudget: number | null;
  maxCost: number | null;
  maxAgentCount: number | null;
  maxConcurrentAgents: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SessionMemoryEntry {
  sessionId: string;
  key: string;
  value: unknown;
  updatedAt: string;
  updatedByAgentId: string | null;
}

export interface AgentTask {
  id: string;
  sessionId: string;
  agentId: string | null;
  title: string;
  description: string | null;
  // JSON array of other agent_tasks.id values — the DAG edges. Phase 1 stores these as-is; cycle
  // detection and readiness resolution are Phase 3's job (readyTasks()), not this module's.
  dependsOn: string[];
  status: AgentTaskStatus;
  priority: number;
  startedAt: string | null;
  completedAt: string | null;
  result: unknown;
  createdAt: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  objective: string;
  status: AgentSessionStatus;
  max_session_time_ms: number | null;
  max_token_budget: number | null;
  max_cost: number | null;
  max_agent_count: number | null;
  max_concurrent_agents: number | null;
  created_at: string;
  completed_at: string | null;
}

function rowToSession(r: SessionRow): AgentSession {
  return {
    id: r.id,
    userId: r.user_id,
    objective: r.objective,
    status: r.status,
    maxSessionTimeMs: r.max_session_time_ms,
    maxTokenBudget: r.max_token_budget,
    maxCost: r.max_cost,
    maxAgentCount: r.max_agent_count,
    maxConcurrentAgents: r.max_concurrent_agents,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

export function createSession(params: {
  userId: string;
  objective: string;
  maxSessionTimeMs?: number;
  maxTokenBudget?: number;
  maxCost?: number;
  maxAgentCount?: number;
  maxConcurrentAgents?: number;
}): AgentSession {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_sessions
       (id, user_id, objective, status, max_session_time_ms, max_token_budget, max_cost, max_agent_count, max_concurrent_agents)
     VALUES (?, ?, ?, 'planning', ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.userId,
    params.objective,
    params.maxSessionTimeMs ?? null,
    params.maxTokenBudget ?? null,
    params.maxCost ?? null,
    params.maxAgentCount ?? null,
    params.maxConcurrentAgents ?? null
  );
  return getSession(params.userId, id)!;
}

// Scoped by userId exactly like agentRunStore.getRun — a session id alone is never enough to read
// it back, matching the ownership discipline already applied everywhere else in this codebase.
export function getSession(userId: string, sessionId: string): AgentSession | null {
  const row = db
    .prepare(`SELECT * FROM agent_sessions WHERE id = ? AND user_id = ?`)
    .get(sessionId, userId) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function listSessionsForUser(userId: string): AgentSession[] {
  // rowid as a tiebreaker: created_at (datetime('now')) only has second resolution, so two
  // sessions created within the same second — real under concurrent orchestration, not just a
  // test artifact — would otherwise sort arbitrarily instead of newest-first.
  const rows = db
    .prepare(`SELECT * FROM agent_sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`)
    .all(userId) as SessionRow[];
  return rows.map(rowToSession);
}

export function updateSessionStatus(sessionId: string, status: AgentSessionStatus): void {
  const completesNow = status === "completed" || status === "cancelled" || status === "failed";
  db.prepare(
    `UPDATE agent_sessions SET status = ?, completed_at = CASE WHEN ? THEN datetime('now') ELSE completed_at END WHERE id = ?`
  ).run(status, completesNow ? 1 : 0, sessionId);
}

// --- session_memory ---
//
// One row per top-level SessionMemory key, not one blob (architecture doc §5) — setMemory upserts
// a single key without touching any other agent's own section, which is what avoids a
// read-modify-write race across concurrently-running agents.

function rowToMemoryEntry(r: {
  session_id: string;
  key: string;
  value: string;
  updated_at: string;
  updated_by_agent_id: string | null;
}): SessionMemoryEntry {
  return {
    sessionId: r.session_id,
    key: r.key,
    value: JSON.parse(r.value),
    updatedAt: r.updated_at,
    updatedByAgentId: r.updated_by_agent_id,
  };
}

export function setMemory(sessionId: string, key: string, value: unknown, updatedByAgentId?: string): void {
  db.prepare(
    `INSERT INTO session_memory (session_id, key, value, updated_by_agent_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now'),
       updated_by_agent_id = excluded.updated_by_agent_id`
  ).run(sessionId, key, JSON.stringify(value), updatedByAgentId ?? null);
}

export function getMemory(sessionId: string, key: string): SessionMemoryEntry | null {
  const row = db
    .prepare(`SELECT * FROM session_memory WHERE session_id = ? AND key = ?`)
    .get(sessionId, key) as Parameters<typeof rowToMemoryEntry>[0] | undefined;
  return row ? rowToMemoryEntry(row) : null;
}

// Full-session read, used for prompt assembly (architecture doc §5) filtered down to a given role's
// declared read scope by the caller — this function itself has no notion of scope, same division of
// responsibility as getToolsFor() vs. dispatch() in toolRegistry.ts.
export function listMemory(sessionId: string): SessionMemoryEntry[] {
  const rows = db
    .prepare(`SELECT * FROM session_memory WHERE session_id = ? ORDER BY key ASC`)
    .all(sessionId) as Parameters<typeof rowToMemoryEntry>[0][];
  return rows.map(rowToMemoryEntry);
}

// --- agent_tasks ---

interface TaskRow {
  id: string;
  session_id: string;
  agent_id: string | null;
  title: string;
  description: string | null;
  depends_on: string;
  status: AgentTaskStatus;
  priority: number;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  created_at: string;
}

function rowToTask(r: TaskRow): AgentTask {
  return {
    id: r.id,
    sessionId: r.session_id,
    agentId: r.agent_id,
    title: r.title,
    description: r.description,
    dependsOn: JSON.parse(r.depends_on),
    status: r.status,
    priority: r.priority,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    result: r.result ? JSON.parse(r.result) : null,
    createdAt: r.created_at,
  };
}

export function createTask(params: {
  sessionId: string;
  title: string;
  description?: string;
  dependsOn?: string[];
  priority?: number;
}): AgentTask {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_tasks (id, session_id, title, description, depends_on, priority, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  ).run(
    id,
    params.sessionId,
    params.title,
    params.description ?? null,
    JSON.stringify(params.dependsOn ?? []),
    params.priority ?? 0
  );
  return getTask(params.sessionId, id)!;
}

// Scoped by sessionId, not just id — the direct regression guard against cross-session leakage:
// a task id from session A must return null when looked up under session B, exactly like
// agentRunStore.getRun scopes every read by userId.
export function getTask(sessionId: string, taskId: string): AgentTask | null {
  const row = db
    .prepare(`SELECT * FROM agent_tasks WHERE id = ? AND session_id = ?`)
    .get(taskId, sessionId) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export function listTasksForSession(sessionId: string): AgentTask[] {
  // Same created_at-resolution tiebreaker as listSessionsForUser — an orchestrator inserting many
  // tasks in one tick will genuinely create several within the same second.
  const rows = db
    .prepare(`SELECT * FROM agent_tasks WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(sessionId) as TaskRow[];
  return rows.map(rowToTask);
}

export function updateTaskStatus(
  sessionId: string,
  taskId: string,
  status: AgentTaskStatus,
  extra?: { agentId?: string; result?: unknown }
): void {
  const startsNow = status === "running";
  const completesNow = status === "completed" || status === "failed" || status === "cancelled";
  db.prepare(
    `UPDATE agent_tasks SET
       status = ?,
       agent_id = COALESCE(?, agent_id),
       result = COALESCE(?, result),
       started_at = CASE WHEN ? THEN datetime('now') ELSE started_at END,
       completed_at = CASE WHEN ? THEN datetime('now') ELSE completed_at END
     WHERE id = ? AND session_id = ?`
  ).run(
    status,
    extra?.agentId ?? null,
    extra?.result !== undefined ? JSON.stringify(extra.result) : null,
    startsNow ? 1 : 0,
    completesNow ? 1 : 0,
    taskId,
    sessionId
  );
}

// Test-only escape hatch, matching the established convention (pendingActions.ts's
// __clearAllPendingActionsForTests, providerHealth.ts's __resetHealthForTests).
export function __deleteSessionForTests(sessionId: string): void {
  db.prepare(`DELETE FROM agent_sessions WHERE id = ?`).run(sessionId);
}
