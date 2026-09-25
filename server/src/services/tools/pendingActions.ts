// Durable, identity-bound, single-use proposals. Consuming a proposal commits before an
// external call: an ambiguous network failure must be reconciled, never blindly retried.
import { randomUUID } from "node:crypto";
import type { ProductIdentity } from "../productIdentity.js";
import { db } from "../../db/index.js";

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
export const ACTION_TTL_MS = 5 * 60 * 1000;

db.exec(`CREATE TABLE IF NOT EXISTS product_pending_actions (
  id TEXT PRIMARY KEY,
  identity_json TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);

export function proposeAction(identity: ProductIdentity, toolName: string, args: Record<string, unknown>): PendingAction {
  const action: PendingAction = { id: randomUUID(), identity, toolName, args, createdAt: Date.now() };
  db.prepare("INSERT INTO product_pending_actions (id, identity_json, tool_name, args_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(action.id, JSON.stringify(identity), toolName, JSON.stringify(args), action.createdAt);
  // Bound abandoned proposals without depending on a process-local timer.
  db.prepare("DELETE FROM product_pending_actions WHERE created_at < ?").run(Date.now() - ACTION_TTL_MS * 2);
  return action;
}

// Single-use by construction: removes the action from the map before returning it, so a second
// call with the same id — whether approving twice, rejecting twice, or approve-then-reject —
// always fails rather than silently no-op'ing or executing the underlying tool a second time.
// Also independently re-verifies the requester is the exact same identity that proposed it —
// never trust that only the right person could have learned this id.
//
// M8: compares tenantId too, not just product+externalUserId. Arena's own externalUserId is a
// globally-unique User.id UUID today, so this specific collision can't happen there in practice
// — but ProductIdentity models tenantId as a real, independent dimension of identity (per
// ADR-003), and this function's job is to enforce the identity contract as written, not to rely
// on one product's current UUID-generation strategy happening to make the gap unreachable. A
// future product (or connector bug) whose externalUserId is only unique *within* a tenant must
// not be able to cross a tenant boundary just because this check forgot to look.
export function consumeAction(actionId: string, requesterIdentity: ProductIdentity): PendingAction {
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM product_pending_actions WHERE id = ?").get(actionId) as
      { id: string; identity_json: string; tool_name: string; args_json: string; created_at: number } | undefined;
    if (!row) throw new PendingActionError("No such pending action (already used, rejected, or expired)");
    const action: PendingAction = {
      id: row.id, identity: JSON.parse(row.identity_json), toolName: row.tool_name,
      args: JSON.parse(row.args_json), createdAt: row.created_at,
    };
    if (action.identity.product !== requesterIdentity.product ||
        action.identity.externalUserId !== requesterIdentity.externalUserId ||
        action.identity.tenantId !== requesterIdentity.tenantId) {
      throw new PendingActionError("This action does not belong to the requesting identity");
    }
    if (Date.now() - action.createdAt >= ACTION_TTL_MS) {
      throw new PendingActionError("This action has expired — ask again");
    }
    db.prepare("DELETE FROM product_pending_actions WHERE id = ?").run(actionId);
    return action;
  }).immediate();
}

// Test-only escape hatch — mirrors providerHealth.ts's own __resetHealthForTests() convention,
// so tests don't leak pending actions across cases via this module's shared in-process map.
export function __clearAllPendingActionsForTests(): void {
  db.prepare("DELETE FROM product_pending_actions").run();
}
