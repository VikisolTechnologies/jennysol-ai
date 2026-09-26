// SQLite persistence for AgentGoalRun/TaskStep — same engine and same "identity owns its own rows"
// pattern pendingActions.ts already established, not a new datastore. Deliberately no ORM: two
// small tables, prepared statements, matching every other store in this codebase.
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import type { ProductIdentity } from "../productIdentity.js";
import type { AgentGoalRun, AgentGoalRunBudget, RunStatus, StopReason, TaskStep } from "./types.js";

db.exec(`CREATE TABLE IF NOT EXISTS agent_goal_runs (
  id TEXT PRIMARY KEY,
  identity_json TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  budget_json TEXT NOT NULL,
  spent_ms INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '',
  pending_action_id TEXT,
  stop_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS agent_goal_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_goal_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  tool_name TEXT,
  args_json TEXT,
  result_json TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_goal_run_steps_run_id ON agent_goal_run_steps(run_id)`);

interface RunRow {
  id: string;
  identity_json: string;
  goal: string;
  status: RunStatus;
  budget_json: string;
  spent_ms: number;
  content: string;
  pending_action_id: string | null;
  stop_reason: StopReason | null;
  created_at: number;
  updated_at: number;
}

function rowToRun(row: RunRow): AgentGoalRun {
  return {
    id: row.id,
    identity: JSON.parse(row.identity_json),
    goal: row.goal,
    status: row.status,
    budget: JSON.parse(row.budget_json),
    spentMs: row.spent_ms,
    content: row.content,
    pendingActionId: row.pending_action_id ?? undefined,
    stopReason: row.stop_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRun(identity: ProductIdentity, goal: string, budget: AgentGoalRunBudget): AgentGoalRun {
  const now = Date.now();
  const run: AgentGoalRun = { id: randomUUID(), identity, goal, status: "queued", budget, spentMs: 0, content: "", createdAt: now, updatedAt: now };
  db.prepare(
    `INSERT INTO agent_goal_runs (id, identity_json, goal, status, budget_json, spent_ms, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(run.id, JSON.stringify(identity), goal, run.status, JSON.stringify(budget), 0, "", now, now);
  return run;
}

// Ownership check happens here, not one layer up — same convention as pendingActions.ts's
// consumeAction, so "read someone else's run" and "act on someone else's run" both fail the same
// structural way (a missing row from this identity's point of view), not a separate ACL check
// bolted on after a broader, unscoped lookup.
export function getOwnedRun(runId: string, identity: ProductIdentity): AgentGoalRun | undefined {
  const row = db.prepare("SELECT * FROM agent_goal_runs WHERE id = ?").get(runId) as RunRow | undefined;
  if (!row) return undefined;
  const owner = JSON.parse(row.identity_json) as ProductIdentity;
  if (owner.product !== identity.product || owner.externalUserId !== identity.externalUserId || owner.tenantId !== identity.tenantId) {
    return undefined;
  }
  return rowToRun(row);
}

export function updateRun(run: AgentGoalRun): void {
  run.updatedAt = Date.now();
  db.prepare(
    `UPDATE agent_goal_runs SET status = ?, spent_ms = ?, content = ?, pending_action_id = ?, stop_reason = ?, updated_at = ? WHERE id = ?`
  ).run(run.status, run.spentMs, run.content, run.pendingActionId ?? null, run.stopReason ?? null, run.updatedAt, run.id);
}

export function appendStep(runId: string, index: number, kind: TaskStep["kind"], toolName?: string, args?: Record<string, unknown>): TaskStep {
  const step: TaskStep = { id: randomUUID(), runId, index, kind, toolName, args, startedAt: Date.now(), endedAt: null };
  db.prepare(
    `INSERT INTO agent_goal_run_steps (id, run_id, step_index, kind, tool_name, args_json, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(step.id, runId, index, kind, toolName ?? null, args ? JSON.stringify(args) : null, step.startedAt);
  return step;
}

export function finishStep(stepId: string, result?: unknown, error?: string): void {
  db.prepare(`UPDATE agent_goal_run_steps SET result_json = ?, error = ?, ended_at = ? WHERE id = ?`).run(
    result === undefined ? null : JSON.stringify(result),
    error ?? null,
    Date.now(),
    stepId
  );
}

export function getSteps(runId: string): TaskStep[] {
  const rows = db.prepare("SELECT * FROM agent_goal_run_steps WHERE run_id = ? ORDER BY step_index ASC").all(runId) as Array<{
    id: string; run_id: string; step_index: number; kind: TaskStep["kind"]; tool_name: string | null;
    args_json: string | null; result_json: string | null; error: string | null; started_at: number; ended_at: number | null;
  }>;
  return rows.map((r) => ({
    id: r.id, runId: r.run_id, index: r.step_index, kind: r.kind,
    toolName: r.tool_name ?? undefined,
    args: r.args_json ? JSON.parse(r.args_json) : undefined,
    result: r.result_json ? JSON.parse(r.result_json) : undefined,
    error: r.error ?? undefined,
    startedAt: r.started_at, endedAt: r.ended_at,
  }));
}

export function __clearAllRunsForTests(): void {
  db.exec("DELETE FROM agent_goal_run_steps; DELETE FROM agent_goal_runs;");
}

// Test-only: find a run mid-flight (before startRun's own promise has resolved and handed back
// its id), by the goal text the test itself chose — never used by real request-serving code.
export function __findRunByGoalForTests(goal: string): AgentGoalRun | undefined {
  const row = db.prepare("SELECT * FROM agent_goal_runs WHERE goal = ? ORDER BY created_at DESC LIMIT 1").get(goal) as RunRow | undefined;
  return row ? rowToRun(row) : undefined;
}
