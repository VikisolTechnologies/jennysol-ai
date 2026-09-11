// M9 (audit/observability, PROJECT-PROGRESS.md milestone model): a real, queryable trail of
// every product-gateway event — distinct from error_logs.ts (crashes, general server errors) and
// agent_events (a single AgentRun's own SSE replay log, unrelated to product-gateway traffic,
// which the gateway doesn't use — see routes/agentGateway.ts's own class doc). Lets the exact
// chain this milestone's acceptance criteria names —
//   USER REQUEST -> AGENT RUN -> MODEL DECISION -> TOOL INVOCATION -> ARENA AUTHORIZATION ->
//   PENDING ACTION -> APPROVAL -> ARENA MUTATION -> RESULT
// — be reconstructed after the fact from one correlationId, without ever persisting a credential.
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { redactSecrets } from "./memoryScope.js";
import type { ProductIdentity } from "./productIdentity.js";

// Every event this milestone's own acceptance criteria names, plus the two extra outcomes a real
// tool dispatch can have (success/failure) that the request list implies but doesn't spell out.
export type AuditEventType =
  | "agent_request_received"
  | "product_identity_invalid"
  | "product_identity_expired"
  | "tool_offered"
  | "tool_call_decided"
  | "scope_violation"
  | "cross_product_attempt"
  | "tool_dispatched"
  | "tool_dispatch_failed"
  | "pending_action_created"
  | "pending_action_approved"
  | "pending_action_rejected"
  | "pending_action_expired"
  | "pending_action_not_found"
  | "pending_action_identity_mismatch"
  | "provider_failure"
  | "agent_request_completed";

export interface AuditEvent {
  correlationId: string;
  type: AuditEventType;
  // Absent for identity-less failures (e.g. a token that fails verification before any product
  // can even be determined) — every other event carries a real, verified ProductIdentity.
  identity?: Pick<ProductIdentity, "product" | "externalUserId" | "tenantId">;
  toolName?: string;
  // Arbitrary structured context (args, result shape, error message) — always redacted before
  // storage, per rule 8: this table must never contain a token, secret, password, or
  // Authorization header value, however deeply nested or however the caller phrased the key.
  detail?: Record<string, unknown>;
}

export function logAuditEvent(event: AuditEvent): void {
  const safeDetail = event.detail ? redactSecrets(event.detail) : undefined;
  db.prepare(
    `INSERT INTO agent_audit_log
       (id, correlation_id, event_type, product, external_user_id, tenant_id, tool_name, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    event.correlationId,
    event.type,
    event.identity?.product ?? null,
    event.identity?.externalUserId ?? null,
    event.identity?.tenantId ?? null,
    event.toolName ?? null,
    safeDetail ? JSON.stringify(safeDetail) : null
  );
}

export interface AuditLogRow {
  id: string;
  correlationId: string;
  eventType: AuditEventType;
  product: string | null;
  externalUserId: string | null;
  tenantId: string | null;
  toolName: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

function rowToAuditLogRow(row: {
  id: string;
  correlation_id: string;
  event_type: string;
  product: string | null;
  external_user_id: string | null;
  tenant_id: string | null;
  tool_name: string | null;
  detail: string | null;
  created_at: string;
}): AuditLogRow {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    eventType: row.event_type as AuditEventType,
    product: row.product,
    externalUserId: row.external_user_id,
    tenantId: row.tenant_id,
    toolName: row.tool_name,
    detail: row.detail ? JSON.parse(row.detail) : null,
    createdAt: row.created_at,
  };
}

// M9's own "audit logging must itself respect user/tenant boundaries" rule: this is the ONLY
// read path this module exposes, and it requires the exact same identity (product +
// externalUserId + tenantId) that the events were recorded under — the same three-way comparison
// pendingActions.consumeAction uses (see that module's own M8 fix), not conversationId-only or
// correlationId-only, either of which an attacker who merely learned the id could satisfy.
export function getAuditTrailForCorrelation(
  correlationId: string,
  requesterIdentity: Pick<ProductIdentity, "product" | "externalUserId" | "tenantId">
): AuditLogRow[] {
  const rows = db
    .prepare(
      `SELECT id, correlation_id, event_type, product, external_user_id, tenant_id, tool_name, detail, created_at
       FROM agent_audit_log
       WHERE correlation_id = ? AND product = ? AND external_user_id = ? AND (tenant_id IS ? OR tenant_id = ?)
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(
      correlationId,
      requesterIdentity.product,
      requesterIdentity.externalUserId,
      requesterIdentity.tenantId ?? null,
      requesterIdentity.tenantId ?? null
    ) as Parameters<typeof rowToAuditLogRow>[0][];

  return rows.map(rowToAuditLogRow);
}

// Test-only escape hatch, matching the established convention (pendingActions.ts's own
// __clearAllPendingActionsForTests, providerHealth.ts's __resetHealthForTests) — this module's
// state lives in the real, shared SQLite db, so tests need a way to isolate their own rows rather
// than asserting against whatever earlier tests already inserted.
export function __deleteAuditEventsForCorrelationForTests(correlationId: string): void {
  db.prepare("DELETE FROM agent_audit_log WHERE correlation_id = ?").run(correlationId);
}
