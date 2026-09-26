import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import { recordModelCallAudit, listModelCallAudit } from "./modelCallAudit.js";
import { createTenant, __clearAllTenantsForTests } from "./tenant.js";

describe("agency model-call audit", () => {
  afterEach(() => {
    __clearAllTenantsForTests();
  });

  it("records the policy decision and latency, scoped to its tenant", () => {
    const tenant = createTenant("Audit Test Agency");
    recordModelCallAudit({
      tenantId: tenant.id,
      dataClass: "B",
      requestedTier: "CONTROLLED_CLOUD",
      resolvedTier: "CONTROLLED_CLOUD",
      redactionOk: true,
      providerUsed: "gemini",
      latencyMs: 4200,
    });

    const entries = listModelCallAudit(tenant.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      dataClass: "B",
      requestedTier: "CONTROLLED_CLOUD",
      resolvedTier: "CONTROLLED_CLOUD",
      redactionOk: true,
      providerUsed: "gemini",
      latencyMs: 4200,
    });
  });

  it("records a refused request (resolvedTier differs from requestedTier) just as honestly as a successful one", () => {
    const tenant = createTenant("Audit Test Agency 2");
    recordModelCallAudit({
      tenantId: tenant.id,
      dataClass: "B",
      requestedTier: "CONTROLLED_CLOUD",
      resolvedTier: "refused",
      redactionOk: false,
    });

    const [entry] = listModelCallAudit(tenant.id);
    expect(entry.resolvedTier).toBe("refused");
    expect(entry.redactionOk).toBe(false);
    expect(entry.providerUsed).toBeUndefined();
  });

  it("test 9(f): the audit table has no column that could ever hold prompt content", () => {
    const cols = (db.prepare("PRAGMA table_info(agency_model_call_audit)").all() as { name: string }[]).map(
      (c) => c.name
    );
    for (const forbidden of ["prompt", "content", "text", "message", "jd", "jd_source", "requirement"]) {
      expect(cols).not.toContain(forbidden);
    }
    // The only free-text-shaped columns are enums with a fixed, small vocabulary, never raw input.
    expect(cols.sort()).toEqual(
      [
        "id",
        "tenant_id",
        "scorecard_id",
        "data_class",
        "requested_tier",
        "resolved_tier",
        "redaction_ok",
        "provider_used",
        "latency_ms",
        "created_at",
      ].sort()
    );
  });

  it("isolation: a tenant only ever sees its own audit entries", () => {
    const tenantA = createTenant("Agency A");
    const tenantB = createTenant("Agency B");
    recordModelCallAudit({ tenantId: tenantA.id, dataClass: "B", requestedTier: "CONTROLLED_CLOUD", resolvedTier: "CONTROLLED_CLOUD", redactionOk: true });
    recordModelCallAudit({ tenantId: tenantB.id, dataClass: "B", requestedTier: "CONTROLLED_CLOUD", resolvedTier: "CONTROLLED_CLOUD", redactionOk: true });

    expect(listModelCallAudit(tenantA.id)).toHaveLength(1);
    expect(listModelCallAudit(tenantB.id)).toHaveLength(1);
    expect(listModelCallAudit(tenantA.id)[0].tenantId).toBe(tenantA.id);
  });
});
