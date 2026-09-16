import { findActionTarget, matchesAnyTrigger } from "./actionRegistry.js";
import { parseActionIntent } from "./intentParser.js";
import { getPendingAction, setPendingAction, clearPendingAction } from "./actionState.js";

export interface ActionResolution {
  kind: "clarify" | "resolved";
  text: string;
}

// JENNYSOL-MOBILE-AND-ACTIONS.md Part A.1's model: VOICE -> INTENT + SLOTS
// -> CLARIFY -> RESOLVE -> HANDOFF -> USER COMPLETES. Called from
// chatRunner.ts before any normal LLM chat completion, same cheap-check-
// first pattern as identity.ts/dateTime.ts in that same file. Returns null
// (never throws) for a message that isn't a real action request, so the
// caller's only job is "if this returns something, that's the whole
// response; otherwise proceed exactly as before."
export async function tryResolveAction(conversationId: string, message: string): Promise<ActionResolution | null> {
  const pending = getPendingAction(conversationId);
  if (!pending && !matchesAnyTrigger(message)) return null;

  const parsed = await parseActionIntent(message, pending?.targetId, pending?.slots);
  if (!parsed) {
    // A pending clarify that this message didn't answer (or extend) gets
    // cleared rather than left alive — the user may have simply moved on
    // to something unrelated, and re-checking every subsequent message
    // against a stale, forgotten question would be the wrong default.
    if (pending) clearPendingAction(conversationId);
    return null;
  }

  const target = findActionTarget(parsed.targetId);
  if (!target) return null;

  if (parsed.missingRequiredSlots.length > 0) {
    setPendingAction(conversationId, parsed.targetId, parsed.slots);
    const missing = target.slots.find((s) => s.name === parsed.missingRequiredSlots[0]);
    return { kind: "clarify", text: `What's ${missing?.description ?? "missing"}?` };
  }

  clearPendingAction(conversationId);
  const url = target.webUrl(parsed.slots);
  return {
    kind: "resolved",
    text: `Here's ${target.label}: [Open ${target.label}](${url})\n\nI can't complete this for you — you'll finish it yourself once it opens.`,
  };
}
