// Stage C §5.2 of JENNYSOL-AGENTS-UI-FIRST.md: real, server-side write-scope enforcement for shared
// memory. A real gap found by inspection, not assumed away: agentTaskRunner.ts's MEMORY_READ_SCOPE
// has governed reads since Phase 5, but every real write (agentOrchestrator.ts's three
// sessionStore.setMemory calls) went straight to the store, unguarded — "Phase 2 flagged this as a
// gap to close by this point, not before" (agentTaskRunner.ts's own comment). This module is that
// closing: the one place a memory write is actually checked before it happens, mirroring
// agentToolRegistry.ts's own enforcement shape (requirePermission, then delegate) rather than
// inventing a second style.
import * as sessionStore from "./agentSessionStore.js";
import { getAgent, hasPermission, type AgentRole } from "./agentRegistry.js";
import { appendSessionEvent } from "./sessionEventBus.js";

export class MemoryScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryScopeError";
  }
}

// Each role's own declared output key(s) — the write-side mirror of agentTaskRunner.ts's
// MEMORY_READ_SCOPE. Only consulted for a role that lacks "memory:write_any" (orchestrator,
// architect, final_judge per agentRegistry.ts's ROLE_CATALOG already hold that broader permission by
// design — a real, existing Phase 2 decision, not something this stage overrides). Defined for all
// 14 roles now, same reasoning as ROLE_CATALOG's own "define the full catalog now, not per-phase"
// comment — only coder's and (later) the other non-write_any roles' entries are exercised by real
// code yet; the rest are ready for Stage D without a schema change.
const MEMORY_WRITE_SCOPE: Record<AgentRole, string[]> = {
  orchestrator: ["requirements", "current_plan", "open_questions"],
  architect: ["architecture"],
  coder: ["changed_files"],
  qa: ["tests"],
  security: ["audit_results"],
  performance: ["audit_results"],
  code_reviewer: ["audit_results"],
  product_analyst: ["requirements", "open_questions"],
  ux: ["current_plan"],
  ui: ["changed_files"],
  backend: ["changed_files"],
  database: ["changed_files"],
  visual_qa: ["tests", "audit_results"],
  final_judge: ["audit_results"],
};

// The one real enforcement point for a memory write: an agent must not be able to write outside its
// scope by manipulating a path, an id, or its own request (the brief's own §5.2 wording). Concretely:
// - agentId must really belong to sessionId (getAgent's own cross-session-leakage guard — the same
//   one agentToolRegistry.ts's requirePermission already relies on) — an agent can't write into a
//   session it doesn't belong to just by passing a different sessionId in its own call.
// - a role without "memory:write_any" can only write a key in its own declared MEMORY_WRITE_SCOPE —
//   not any key it likes.
export function writeSessionMemory(sessionId: string, agentId: string, key: string, value: unknown): void {
  const agent = getAgent(sessionId, agentId);
  if (!agent) throw new MemoryScopeError(`Agent ${agentId} not found in session ${sessionId}`);

  if (!hasPermission(agent, "memory:write_any") && !MEMORY_WRITE_SCOPE[agent.role].includes(key)) {
    throw new MemoryScopeError(`Agent ${agentId} (role ${agent.role}) is not permitted to write memory key "${key}"`);
  }

  sessionStore.setMemory(sessionId, key, value, agentId);
  // The event taxonomy has named "memory.updated" since Phase 4 (sessionEventBus.ts) but nothing
  // ever emitted it — every real write went straight through the unguarded store function with no
  // event at all. Closed here, not as a separate follow-up, since this is now the one place a write
  // legitimately happens.
  appendSessionEvent({ sessionId, agentId, type: "memory.updated", payload: { key } });
}
