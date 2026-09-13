// Phase 7 of docs/AI_AGENT_IMPLEMENTATION_PLAN.md — file locking (architecture doc §7, Phase 1 of
// code isolation: a shared working tree with a real lock, not git worktrees yet — see that doc's
// own "Minimal Change Principle" reasoning for why). The literal, direct implementation of the
// founding directive's §12 requirement: "never allow silent overwriting." A second agent requesting
// a path already held gets a real WAIT status (a real event, not a silent block) and is granted the
// lock the instant the holder releases it — never a busy-poll, never lost.
import { db } from "../db/index.js";
import { appendSessionEvent } from "./sessionEventBus.js";

export type LockOutcome = "acquired" | "wait";

export interface LockRequest {
  outcome: LockOutcome;
  // Resolves the moment this agent is actually granted the lock — immediately already-resolved
  // when outcome is "acquired", resolves later (when the current holder releases) when "wait".
  granted: Promise<void>;
}

interface Waiter {
  agentId: string;
  resolve: () => void;
}

// In-process only, same single-instance caveat as every other in-memory map in this codebase
// (runBus.ts, pendingActions.ts, providerHealth.ts) — correct for JennySol's real deployment (one
// process), would need a shared store if that ever changes. The durable file_locks table (who holds
// what, right now) is the source of truth for "is this locked"; this map only orders who's next.
const waiters = new Map<string, Waiter[]>();

function lockKey(sessionId: string, filePath: string): string {
  return `${sessionId}:${filePath}`;
}

function currentHolder(sessionId: string, filePath: string): string | null {
  const row = db
    .prepare(
      `SELECT agent_id FROM file_locks WHERE session_id = ? AND file_path = ? AND released_at IS NULL
       ORDER BY acquired_at DESC LIMIT 1`
    )
    .get(sessionId, filePath) as { agent_id: string } | undefined;
  return row?.agent_id ?? null;
}

function grantLock(sessionId: string, filePath: string, agentId: string): void {
  db.prepare(`INSERT INTO file_locks (session_id, file_path, agent_id) VALUES (?, ?, ?)`).run(
    sessionId,
    filePath,
    agentId
  );
  appendSessionEvent({ sessionId, agentId, type: "file.locked", payload: { filePath, status: "acquired" } });
}

export function requestLock(sessionId: string, filePath: string, agentId: string): LockRequest {
  const holder = currentHolder(sessionId, filePath);
  if (holder === null || holder === agentId) {
    // Re-entrant: an agent that already holds the lock is not made to wait on itself.
    if (holder === null) grantLock(sessionId, filePath, agentId);
    return { outcome: "acquired", granted: Promise.resolve() };
  }

  appendSessionEvent({
    sessionId,
    agentId,
    type: "file.locked",
    payload: { filePath, status: "wait", heldBy: holder },
  });
  let resolveFn!: () => void;
  const granted = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  const key = lockKey(sessionId, filePath);
  const list = waiters.get(key) ?? [];
  list.push({ agentId, resolve: resolveFn });
  waiters.set(key, list);
  return { outcome: "wait", granted };
}

// A release from an agent that isn't the actual current holder is a no-op, not an error — mirrors
// runCancellation.ts's own "nothing to cancel" treatment for the same class of harmless race.
export function releaseLock(sessionId: string, filePath: string, agentId: string): void {
  const info = db
    .prepare(
      `UPDATE file_locks SET released_at = datetime('now')
       WHERE session_id = ? AND file_path = ? AND agent_id = ? AND released_at IS NULL`
    )
    .run(sessionId, filePath, agentId);
  if (info.changes === 0) return;
  appendSessionEvent({ sessionId, agentId, type: "file.unlocked", payload: { filePath } });

  const key = lockKey(sessionId, filePath);
  const list = waiters.get(key) ?? [];
  const next = list.shift();
  if (!next) {
    waiters.delete(key);
    return;
  }
  waiters.set(key, list);
  grantLock(sessionId, filePath, next.agentId);
  next.resolve();
}

export function isLocked(sessionId: string, filePath: string): boolean {
  return currentHolder(sessionId, filePath) !== null;
}

// Test-only escape hatch, matching the established convention elsewhere in this codebase.
export function __clearWaitersForTests(): void {
  waiters.clear();
}
