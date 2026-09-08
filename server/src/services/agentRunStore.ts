import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import type { Source } from "./conversationStore.js";

// The AgentRun state machine. A run starts "queued" the instant the HTTP
// route creates it (before any model call happens), moves to "running" once
// executeChatRun's async work actually starts, "streaming" once the first
// token arrives, then "completed" or "failed". This is the persisted source
// of truth a disconnected/reconnecting client recovers from — deliberately
// independent of any one HTTP response's lifetime.
export type AgentRunStatus = "queued" | "running" | "streaming" | "completed" | "failed" | "cancelled";

export interface AgentRun {
  id: string;
  userId: string;
  conversationId: string;
  requestId: string | null;
  userMessage: string;
  responseText: string;
  provider: string | null;
  status: AgentRunStatus;
  error: string | null;
  sources: Source[] | null;
  startedAt: string;
  firstEventAt: string | null;
  firstTokenAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string | null;
  seenAt: string | null;
}

export interface AgentEvent {
  id: number;
  runId: string;
  type: string;
  payload: unknown;
  createdAt: string;
}

interface RunRow {
  id: string;
  user_id: string;
  conversation_id: string;
  request_id: string | null;
  user_message: string;
  response_text: string;
  provider: string | null;
  status: AgentRunStatus;
  error: string | null;
  sources: string | null;
  started_at: string;
  first_event_at: string | null;
  first_token_at: string | null;
  completed_at: string | null;
  last_heartbeat_at: string | null;
  seen_at: string | null;
}

function rowToRun(r: RunRow): AgentRun {
  return {
    id: r.id,
    userId: r.user_id,
    conversationId: r.conversation_id,
    requestId: r.request_id,
    userMessage: r.user_message,
    responseText: r.response_text,
    provider: r.provider,
    status: r.status,
    error: r.error,
    sources: r.sources ? JSON.parse(r.sources) : null,
    startedAt: r.started_at,
    firstEventAt: r.first_event_at,
    firstTokenAt: r.first_token_at,
    completedAt: r.completed_at,
    lastHeartbeatAt: r.last_heartbeat_at,
    seenAt: r.seen_at,
  };
}

export function createRun(params: {
  userId: string;
  conversationId: string;
  requestId: string;
  userMessage: string;
}): AgentRun {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_runs (id, user_id, conversation_id, request_id, user_message, status)
     VALUES (?, ?, ?, ?, ?, 'queued')`
  ).run(id, params.userId, params.conversationId, params.requestId, params.userMessage);
  return getRun(params.userId, id)!;
}

export function getRun(userId: string, runId: string): AgentRun | null {
  const row = db.prepare(`SELECT * FROM agent_runs WHERE id = ? AND user_id = ?`).get(runId, userId) as
    | RunRow
    | undefined;
  return row ? rowToRun(row) : null;
}

export function markFirstEvent(runId: string): void {
  db.prepare(
    `UPDATE agent_runs SET status = 'running', first_event_at = datetime('now') WHERE id = ? AND first_event_at IS NULL`
  ).run(runId);
}

export function markFirstToken(runId: string): void {
  db.prepare(
    `UPDATE agent_runs SET status = 'streaming', first_token_at = datetime('now') WHERE id = ? AND first_token_at IS NULL`
  ).run(runId);
}

export function appendResponseText(runId: string, delta: string): void {
  db.prepare(`UPDATE agent_runs SET response_text = response_text || ? WHERE id = ?`).run(delta, runId);
}

export function markHeartbeat(runId: string): void {
  db.prepare(`UPDATE agent_runs SET last_heartbeat_at = datetime('now') WHERE id = ?`).run(runId);
}

export function markCompleted(runId: string, provider: string, sources: Source[]): void {
  // response_text is already fully persisted via appendResponseText as each
  // delta arrived — this only flips status, so a completed run's text is
  // never dependent on this final write landing.
  db.prepare(
    `UPDATE agent_runs SET status = 'completed', provider = ?, sources = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(provider, sources.length > 0 ? JSON.stringify(sources) : null, runId);
}

export function markFailed(runId: string, errorMessage: string): void {
  db.prepare(
    `UPDATE agent_runs SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(errorMessage, runId);
}

// Only transitions a run that's actually still in flight — a cancel request
// racing a run that already completed/failed/was-already-cancelled is a
// no-op here (the WHERE clause simply matches nothing), never overwrites a
// real outcome with "cancelled".
export function markCancelled(runId: string): void {
  db.prepare(
    `UPDATE agent_runs SET status = 'cancelled', completed_at = datetime('now')
     WHERE id = ? AND status IN ('queued', 'running', 'streaming')`
  ).run(runId);
}

export function markSeen(userId: string, runId: string): void {
  db.prepare(`UPDATE agent_runs SET seen_at = datetime('now') WHERE id = ? AND user_id = ?`).run(runId, userId);
}

// Runs that are either still in flight, or finished since the caller last
// looked (seen_at IS NULL) — this is what powers "Jenny finished while you
// were away" on reload/return-to-tab. Bounded lookback avoids surfacing a
// months-old abandoned run as if it just happened.
export function listActiveOrUnseenRuns(userId: string, sinceHours = 24): AgentRun[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_runs
       WHERE user_id = ?
         AND (status IN ('queued', 'running', 'streaming') OR seen_at IS NULL)
         AND started_at >= datetime('now', ?)
       ORDER BY started_at ASC`
    )
    .all(userId, `-${sinceHours} hours`) as RunRow[];
  return rows.map(rowToRun);
}

export function getActiveRunForConversation(userId: string, conversationId: string): AgentRun | null {
  const row = db
    .prepare(
      `SELECT * FROM agent_runs
       WHERE user_id = ? AND conversation_id = ? AND status IN ('queued', 'running', 'streaming')
       ORDER BY started_at DESC LIMIT 1`
    )
    .get(userId, conversationId) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

function payloadToEvent(r: { id: number; run_id: string; type: string; payload: string | null; created_at: string }): AgentEvent {
  return {
    id: r.id,
    runId: r.run_id,
    type: r.type,
    payload: r.payload ? JSON.parse(r.payload) : null,
    createdAt: r.created_at,
  };
}

export function appendEvent(runId: string, type: string, payload?: unknown): AgentEvent {
  const info = db
    .prepare(`INSERT INTO agent_events (run_id, type, payload) VALUES (?, ?, ?)`)
    .run(runId, type, payload !== undefined ? JSON.stringify(payload) : null);
  const row = db.prepare(`SELECT * FROM agent_events WHERE id = ?`).get(info.lastInsertRowid) as {
    id: number;
    run_id: string;
    type: string;
    payload: string | null;
    created_at: string;
  };
  return payloadToEvent(row);
}

// Powers reconnect/replay: a client that saw events up through id N asks for
// everything after N instead of re-deriving state or missing a gap.
export function getEventsAfter(runId: string, afterId: number): AgentEvent[] {
  const rows = db
    .prepare(`SELECT * FROM agent_events WHERE run_id = ? AND id > ? ORDER BY id ASC`)
    .all(runId, afterId) as { id: number; run_id: string; type: string; payload: string | null; created_at: string }[];
  return rows.map(payloadToEvent);
}
