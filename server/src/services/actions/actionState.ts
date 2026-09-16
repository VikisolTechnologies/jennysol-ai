// A real clarify round-trip spans two separate chat runs (the question,
// then the user's answer) — this is what lets the second one know which
// target/slots it's completing. In-memory and per-conversation, same real
// limitation as other module-level caches in this codebase (e.g.
// ollama.ts's lastUsedAt): a server restart mid-clarify loses the pending
// state, and the next message just starts fresh rather than resuming — an
// honest, minor gap, not a silent one. A 5-minute TTL bounds how long a
// conversation stays "primed" to reinterpret an unrelated later message as
// answering a question the user may have already moved on from.
interface PendingAction {
  targetId: string;
  slots: Record<string, string>;
  expiresAt: number;
}

const PENDING_TTL_MS = 5 * 60 * 1000;
const pending = new Map<string, PendingAction>();

export function getPendingAction(conversationId: string): { targetId: string; slots: Record<string, string> } | null {
  const entry = pending.get(conversationId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pending.delete(conversationId);
    return null;
  }
  return { targetId: entry.targetId, slots: entry.slots };
}

export function setPendingAction(conversationId: string, targetId: string, slots: Record<string, string>): void {
  pending.set(conversationId, { targetId, slots, expiresAt: Date.now() + PENDING_TTL_MS });
}

export function clearPendingAction(conversationId: string): void {
  pending.delete(conversationId);
}
