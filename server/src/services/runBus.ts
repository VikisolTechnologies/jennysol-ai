import { EventEmitter } from "node:events";
import type { AgentEvent } from "./agentRunStore.js";

// In-process pub/sub keyed by runId, used so an SSE connection can tail a
// run's events live. This is deliberately NOT the source of truth — every
// event published here was already durably written to agent_events first
// (see agentRunStore.appendEvent, always called before publish in
// chatRunner.ts's emit() helper) — so a run with zero live subscribers (the
// browser closed, or never reconnected) loses nothing; a later GET
// /api/agent/runs/:id/events?after= replays the same events from SQLite.
//
// Single Node process only, matching the rest of this app's SQLite-backed,
// single-instance deployment (see providerHealth.ts for the same tradeoff
// spelled out) — if this ever runs as more than one instance, this would
// need to move to something shared like Redis pub/sub instead of a
// module-level EventEmitter.
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(runId: string, event: AgentEvent): void {
  bus.emit(runId, event);
}

export function subscribe(runId: string, handler: (event: AgentEvent) => void): () => void {
  bus.on(runId, handler);
  return () => bus.off(runId, handler);
}
