import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import {
  createTenant,
  addMember,
  isMember,
  requireMembership,
  listTenantsForUser,
  setDataProcessingSetting,
  setCloudProcessingDisabled,
  resolveProcessingTier,
  __clearAllTenantsForTests,
} from "./tenant.js";

function makeUser(): string {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

describe("agency tenant model", () => {
  const userIds: string[] = [];

  beforeEach(() => {
    delete process.env.AGENCY_CLOUD_DISABLED;
  });

  afterEach(() => {
    __clearAllTenantsForTests();
    for (const id of userIds.splice(0)) db.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades
  });

  it("a new tenant defaults to private_only and not cloud-disabled", () => {
    const tenant = createTenant("Northstar Staffing");
    expect(tenant.dataProcessingSetting).toBe("private_only");
    expect(tenant.cloudProcessingDisabled).toBe(false);
    expect(resolveProcessingTier(tenant)).toBe("PRIVATE_ONLY");
  });

  it("isolation: a user who is a member of tenant A is not a member of tenant B", () => {
    const userA = makeUser();
    userIds.push(userA);
    const tenantA = createTenant("Agency A");
    const tenantB = createTenant("Agency B");
    addMember(tenantA.id, userA);

    expect(isMember(tenantA.id, userA)).toBe(true);
    expect(isMember(tenantB.id, userA)).toBe(false);
    expect(() => requireMembership(tenantB.id, userA)).toThrow(/Not a member/);
    expect(listTenantsForUser(userA).map((t) => t.id)).toEqual([tenantA.id]);
  });

  it("isolation: requireMembership refuses a tenant id that doesn't exist at all", () => {
    const user = makeUser();
    userIds.push(user);
    expect(() => requireMembership(randomUUID(), user)).toThrow(/Not a member/);
  });

  it("opting in: setDataProcessingSetting must be explicit before CONTROLLED_CLOUD is ever resolved", () => {
    const tenant = createTenant("Agency C");
    expect(resolveProcessingTier(tenant)).toBe("PRIVATE_ONLY");
    setDataProcessingSetting(tenant.id, "private_plus_controlled_cloud");
    const updated = { ...tenant, dataProcessingSetting: "private_plus_controlled_cloud" as const };
    expect(resolveProcessingTier(updated)).toBe("CONTROLLED_CLOUD");
  });

  it("per-agency kill switch collapses to PRIVATE_ONLY even when the tenant setting allows cloud", () => {
    const tenant = createTenant("Agency D");
    setDataProcessingSetting(tenant.id, "private_plus_controlled_cloud");
    setCloudProcessingDisabled(tenant.id, true);
    const updated = {
      ...tenant,
      dataProcessingSetting: "private_plus_controlled_cloud" as const,
      cloudProcessingDisabled: true,
    };
    expect(resolveProcessingTier(updated)).toBe("PRIVATE_ONLY");
  });

  it("global kill switch (AGENCY_CLOUD_DISABLED) collapses every tenant to PRIVATE_ONLY, whatever their own setting is", () => {
    process.env.AGENCY_CLOUD_DISABLED = "true";
    const tenant = {
      id: "x",
      name: "Agency E",
      dataProcessingSetting: "private_plus_controlled_cloud" as const,
      cloudProcessingDisabled: false,
      createdAt: "",
    };
    expect(resolveProcessingTier(tenant)).toBe("PRIVATE_ONLY");
  });
});
