// Phase 4 of docs/AI_AGENT_IMPLEMENTATION_PLAN.md: the session-scoped event bus. Directly
// generalizes agentRunStore.appendEvent + runBus.ts from one run to one session — same durability
// discipline, same single-process caveat, deliberately not a new architectural decision (see
// docs/AI_AGENT_SYSTEM_ARCHITECTURE.md §4).
//
// This table is the ONLY source of truth the Phase 13 live dashboard will ever render from
// (architecture doc §3's "fake autonomy" defense). The in-process EventEmitter below is a
// convenience for live tailing ONLY — durable-first, always: every event is written to
// agent_session_events before it is ever published, never the reverse, so a session with zero live
// subscribers loses nothing; a later replay via getSessionEventsAfter() sees the exact same
// sequence a live subscriber would have.
import { EventEmitter } from "node:events";
import { db } from "../db/index.js";

// The real event taxonomy this phase implements (Phase 4's own documentation requirement) — not
// the founding directive's illustrative list verbatim, the actual set this system emits.
export type SessionEventType =
  | "session.created"
  | "session.status_changed"
  | "task.ready"
  | "task.started"
  | "task.progress"
  | "task.completed"
  | "task.failed"
  | "agent.spawned"
  | "agent.status_changed"
  | "tool.exec.started"
  | "tool.exec.finished"
  | "file.locked"
  | "file.changed"
  | "file.unlocked"
  | "memory.updated"
  | "checkpoint.started"
  | "checkpoint.completed"
  | "decision.raised"
  | "decision.answered"
  | "audit.started"
  | "audit.result";

export interface SessionEvent {
  id: number;
  sessionId: string;
  agentId: string | null;
  taskId: string | null;
  type: SessionEventType;
  payload: unknown;
  createdAt: string;
}

interface EventRow {
  id: number;
  session_id: string;
  agent_id: string | null;
  task_id: string | null;
  type: SessionEventType;
  payload: string | null;
  created_at: string;
}

function rowToEvent(r: EventRow): SessionEvent {
  return {
    id: r.id,
    sessionId: r.session_id,
    agentId: r.agent_id,
    taskId: r.task_id,
    type: r.type,
    payload: r.payload ? JSON.parse(r.payload) : null,
    createdAt: r.created_at,
  };
}

// Single Node process only — same tradeoff runBus.ts already documents and the same reason
// (this app's real deployment is one Railway instance). Would need Redis pub/sub if that changes.
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function appendSessionEvent(params: {
  sessionId: string;
  agentId?: string;
  taskId?: string;
  type: SessionEventType;
  payload?: unknown;
}): SessionEvent {
  const info = db
    .prepare(
      `INSERT INTO agent_session_events (session_id, agent_id, task_id, type, payload)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      params.sessionId,
      params.agentId ?? null,
      params.taskId ?? null,
      params.type,
      params.payload !== undefined ? JSON.stringify(params.payload) : null
    );
  const row = db.prepare(`SELECT * FROM agent_session_events WHERE id = ?`).get(info.lastInsertRowid) as EventRow;
  const event = rowToEvent(row);
  // Publish only after the durable write above has committed — a live subscriber and a client that
  // later calls getSessionEventsAfter() must never be able to observe a different sequence.
  bus.emit(params.sessionId, event);
  return event;
}

export function subscribeToSession(sessionId: string, handler: (event: SessionEvent) => void): () => void {
  bus.on(sessionId, handler);
  return () => bus.off(sessionId, handler);
}

// Replay: identical semantics to agentRunStore.getEventsAfter, one level up — a dashboard client
// that saw events up through id N asks for everything after N instead of re-deriving state.
export function getSessionEventsAfter(sessionId: string, afterId: number): SessionEvent[] {
  const rows = db
    .prepare(`SELECT * FROM agent_session_events WHERE session_id = ? AND id > ? ORDER BY id ASC`)
    .all(sessionId, afterId) as EventRow[];
  return rows.map(rowToEvent);
}
