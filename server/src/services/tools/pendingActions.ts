// M7 (approval-controlled write tools, PROJECT-PROGRESS.md milestone model), per ADR-004: a
// model-requested WRITE tool call is never dispatched immediately. It becomes a PendingAction the
// gateway route hands back to the caller (Arena's own frontend renders this as an approval card —
// see the existing, previously-dormant IntentCardView.tsx); only an explicit, separate approval
// request executes it, exactly once, via ToolRegistry.dispatch().
//
// A plain in-process Map, same pattern already established elsewhere in this codebase for
// single-instance state (providerHealth.ts's health-stats map, runBus.ts's per-runId map) — real
// for this app's actual deployment (one Railway instance), not a permanent architecture decision.
import { randomUUID } from "node:crypto";
import type { ProductIdentity } from "../productIdentity.js";

export interface PendingAction {
  id: string;
  identity: ProductIdentity;
  toolName: string;
  args: Record<string, unknown>;
  createdAt: number;
}

export class PendingActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingActionError";
  }
}

// Mirrors serviceToken.ts's own MAX_TOKEN_TTL_SECONDS (300s) — a pending action outlives the
// service token that proposed it by design margin, but not by much: the whole point is a user
// approves within the same short interaction, not hours later with a stale token.
const ACTION_TTL_MS = 5 * 60 * 1000;

const pending = new Map<string, PendingAction>();

export function proposeAction(identity: ProductIdentity, toolName: string, args: Record<string, unknown>): PendingAction {
  const action: PendingAction = { id: randomUUID(), identity, toolName, args, createdAt: Date.now() };
  pending.set(action.id, action);
  return action;
}

// Single-use by construction: removes the action from the map before returning it, so a second
// call with the same id — whether approving twice, rejecting twice, or approve-then-reject —
// always fails rather than silently no-op'ing or executing the underlying tool a second time.
// Also independently re-verifies the requester is the exact same identity that proposed it —
// never trust that only the right person could have learned this id.
export function consumeAction(actionId: string, requesterIdentity: ProductIdentity): PendingAction {
  const action = pending.get(actionId);
  if (!action) {
    throw new PendingActionError("No such pending action (already used, rejected, or expired)");
  }
  pending.delete(actionId);

  if (Date.now() - action.createdAt > ACTION_TTL_MS) {
    throw new PendingActionError("This action has expired — ask again");
  }
  if (action.identity.product !== requesterIdentity.product || action.identity.externalUserId !== requesterIdentity.externalUserId) {
    throw new PendingActionError("This action does not belong to the requesting identity");
  }
  return action;
}

// Test-only escape hatch — mirrors providerHealth.ts's own __resetHealthForTests() convention,
// so tests don't leak pending actions across cases via this module's shared in-process map.
export function __clearAllPendingActionsForTests(): void {
  pending.clear();
}
