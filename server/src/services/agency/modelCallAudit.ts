// ADR-007 §9(f)/§12 step 5: one audit record per model call for agency traffic — provider, data
// class, redaction result, the policy decision (requested vs. resolved tier), model latency.
// Deliberately NO prompt/content field exists anywhere in this file's types or SQL — there is no
// column here a caller could even attempt to put prompt text into.
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";

export type DataClass = "A" | "B" | "C";

export interface ModelCallAuditEntry {
  tenantId: string;
  scorecardId?: string;
  dataClass: DataClass;
  requestedTier: string;
  resolvedTier: string;
  redactionOk: boolean;
  providerUsed?: string;
  latencyMs?: number;
}

export function recordModelCallAudit(entry: ModelCallAuditEntry): void {
  db.prepare(
    `INSERT INTO agency_model_call_audit
       (id, tenant_id, scorecard_id, data_class, requested_tier, resolved_tier, redaction_ok, provider_used, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    entry.tenantId,
    entry.scorecardId ?? null,
    entry.dataClass,
    entry.requestedTier,
    entry.resolvedTier,
    entry.redactionOk ? 1 : 0,
    entry.providerUsed ?? null,
    entry.latencyMs ?? null
  );
}

export interface StoredModelCallAudit extends ModelCallAuditEntry {
  id: string;
  createdAt: string;
}

interface Row {
  id: string;
  tenant_id: string;
  scorecard_id: string | null;
  data_class: string;
  requested_tier: string;
  resolved_tier: string;
  redaction_ok: number;
  provider_used: string | null;
  latency_ms: number | null;
  created_at: string;
}

export function listModelCallAudit(tenantId: string): StoredModelCallAudit[] {
  const rows = db
    .prepare("SELECT * FROM agency_model_call_audit WHERE tenant_id = ? ORDER BY created_at DESC")
    .all(tenantId) as Row[];
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    scorecardId: r.scorecard_id ?? undefined,
    dataClass: r.data_class as DataClass,
    requestedTier: r.requested_tier,
    resolvedTier: r.resolved_tier,
    redactionOk: r.redaction_ok === 1,
    providerUsed: r.provider_used ?? undefined,
    latencyMs: r.latency_ms ?? undefined,
    createdAt: r.created_at,
  }));
}
