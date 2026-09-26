// ADR-007 §9/§12 step 3: the agency tenant model. A scorecard belongs to a tenant (an agency),
// not just to the user who happened to draft it — any member can read/edit/approve it, but a
// member of a DIFFERENT tenant must never be able to, whatever their own user id is. This file is
// the one place that decision is made; scorecardStore.ts and the routes never re-derive it.
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";

export type DataProcessingSetting = "private_only" | "private_plus_controlled_cloud";

export interface AgencyTenant {
  id: string;
  name: string;
  dataProcessingSetting: DataProcessingSetting;
  cloudProcessingDisabled: boolean;
  createdAt: string;
}

interface TenantRow {
  id: string;
  name: string;
  data_processing_setting: string;
  cloud_processing_disabled: number;
  created_at: string;
}

function fromRow(row: TenantRow): AgencyTenant {
  return {
    id: row.id,
    name: row.name,
    dataProcessingSetting: row.data_processing_setting as DataProcessingSetting,
    cloudProcessingDisabled: row.cloud_processing_disabled === 1,
    createdAt: row.created_at,
  };
}

// Defaults to 'private_only' at the DB level too (db/index.ts's own DEFAULT) — passed explicitly
// here anyway so a caller reading this function never has to go check the schema to know a new
// agency starts locked to private processing until someone deliberately opts it in.
export function createTenant(name: string): AgencyTenant {
  const id = randomUUID();
  db.prepare("INSERT INTO agency_tenants (id, name, data_processing_setting, cloud_processing_disabled) VALUES (?, ?, 'private_only', 0)").run(
    id,
    name
  );
  return getTenant(id)!;
}

export function getTenant(id: string): AgencyTenant | null {
  const row = db.prepare("SELECT * FROM agency_tenants WHERE id = ?").get(id) as TenantRow | undefined;
  return row ? fromRow(row) : null;
}

export function addMember(tenantId: string, userId: string, role: "owner" | "member" = "member"): void {
  db.prepare("INSERT OR REPLACE INTO agency_tenant_members (tenant_id, user_id, role) VALUES (?, ?, ?)").run(
    tenantId,
    userId,
    role
  );
}

export function isMember(tenantId: string, userId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM agency_tenant_members WHERE tenant_id = ? AND user_id = ?")
    .get(tenantId, userId);
  return !!row;
}

// The isolation boundary a caller actually uses: given a user, which tenant may they act as for
// this request. Never trusts a client-supplied tenantId alone — this is the one function that
// turns "I am user X, acting for tenant Y" into a real yes/no.
export function requireMembership(tenantId: string, userId: string): AgencyTenant {
  const tenant = getTenant(tenantId);
  if (!tenant || !isMember(tenantId, userId)) {
    throw new Error("Not a member of this agency tenant");
  }
  return tenant;
}

export function listTenantsForUser(userId: string): AgencyTenant[] {
  const rows = db
    .prepare(
      `SELECT t.* FROM agency_tenants t
       JOIN agency_tenant_members m ON m.tenant_id = t.id
       WHERE m.user_id = ?
       ORDER BY t.created_at ASC`
    )
    .all(userId) as TenantRow[];
  return rows.map(fromRow);
}

export function setDataProcessingSetting(tenantId: string, setting: DataProcessingSetting): void {
  db.prepare("UPDATE agency_tenants SET data_processing_setting = ? WHERE id = ?").run(setting, tenantId);
}

export function setCloudProcessingDisabled(tenantId: string, disabled: boolean): void {
  db.prepare("UPDATE agency_tenants SET cloud_processing_disabled = ? WHERE id = ?").run(disabled ? 1 : 0, tenantId);
}

function globalCloudKillSwitchOn(): boolean {
  return process.env.AGENCY_CLOUD_DISABLED === "true";
}

export type ResolvedProcessingTier = "CONTROLLED_CLOUD" | "PRIVATE_ONLY";

// ADR-007 §4/§9: three independent gates, ANY of which collapses the request to private-only —
// never the model, never a per-call flag, always this deterministic check. There is no "escalate
// once local fails" path anywhere downstream of this: if this returns PRIVATE_ONLY and no private
// processor exists (true for agency data today — see BLOCKERS.md), the caller fails honestly.
export function resolveProcessingTier(tenant: AgencyTenant): ResolvedProcessingTier {
  if (globalCloudKillSwitchOn()) return "PRIVATE_ONLY";
  if (tenant.cloudProcessingDisabled) return "PRIVATE_ONLY";
  if (tenant.dataProcessingSetting !== "private_plus_controlled_cloud") return "PRIVATE_ONLY";
  return "CONTROLLED_CLOUD";
}

export function __clearAllTenantsForTests(): void {
  db.exec("DELETE FROM agency_tenant_members; DELETE FROM agency_tenants;");
}
