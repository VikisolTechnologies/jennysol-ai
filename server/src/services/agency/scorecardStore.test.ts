import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import {
  createDraft,
  getForTenant,
  listForTenant,
  editDraft,
  approve,
  requireApproved,
  ScorecardNotEditableError,
  ScorecardAlreadyApprovedError,
  ScorecardRequiresReviewError,
} from "./scorecardStore.js";
import { createTenant, addMember, __clearAllTenantsForTests } from "./tenant.js";
import type { AgencyScorecardDraft } from "./scorecardSchema.js";

function makeUser(): string {
  const userId = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, 'x', 'Test User')").run(
    userId,
    `${userId}@example.test`
  );
  return userId;
}

const sampleDraft: AgencyScorecardDraft = {
  role: "Backend Engineer",
  mustHave: [{ value: "Java", quote: "5 years of Java" }],
  niceToHave: [],
  experienceRange: { value: "5+ years", quote: "5 years of Java" },
  locationOrWorkMode: { value: "unknown", quote: "unknown" },
  compensation: { value: "unknown", quote: "unknown" },
  noticePeriod: { value: "unknown", quote: "unknown" },
  disqualifiers: [],
  contradictions: [],
  missingInformation: [],
  clientClarificationQuestions: [],
  screeningQuestions: [],
  booleanSearchStrings: [],
};

describe("agency scorecard store (tenant-scoped)", () => {
  const userIds: string[] = [];

  afterEach(() => {
    __clearAllTenantsForTests();
    for (const id of userIds.splice(0)) db.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades
  });

  function tenantWithMember() {
    const owner = makeUser();
    userIds.push(owner);
    const tenant = createTenant("Test Agency");
    addMember(tenant.id, owner);
    return { tenant, owner };
  }

  it("creates a draft and reads it back scoped to its tenant", () => {
    const { tenant, owner } = tenantWithMember();
    const created = createDraft(tenant.id, owner, "raw JD text", sampleDraft, [], false, undefined);
    expect(created.status).toBe("draft");
    expect(created.version).toBe(1);
    expect(created.requiresReview).toBe(false);

    expect(getForTenant(created.id, tenant.id)).not.toBeNull();
    expect(listForTenant(tenant.id).map((s) => s.id)).toEqual([created.id]);
  });

  it("isolation: a scorecard created for tenant A is invisible to tenant B, even to a real user of B", () => {
    const { tenant: tenantA, owner: ownerA } = tenantWithMember();
    const tenantB = createTenant("Agency B");
    const created = createDraft(tenantA.id, ownerA, "raw JD text", sampleDraft, [], false, undefined);

    expect(getForTenant(created.id, tenantB.id)).toBeNull();
    expect(listForTenant(tenantB.id)).toEqual([]);
    expect(() => editDraft(created.id, tenantB.id, ownerA, { compensation: { value: "10L", quote: "10L" } })).toThrow(
      /not found/i
    );
    expect(() => approve(created.id, tenantB.id, ownerA)).toThrow(/not found/i);
  });

  it("isolation: any member of the SAME tenant can read/edit a scorecard another member drafted", () => {
    const { tenant, owner: firstMember } = tenantWithMember();
    const secondMember = makeUser();
    userIds.push(secondMember);
    addMember(tenant.id, secondMember);
    const created = createDraft(tenant.id, firstMember, "raw JD text", sampleDraft, [], false, undefined);

    const edited = editDraft(created.id, tenant.id, secondMember, {
      compensation: { value: "12L", quote: "12L" },
    });
    expect(edited.scorecard.compensation.value).toBe("12L");
  });

  it("edits a draft's fields and bumps the version", () => {
    const { tenant, owner } = tenantWithMember();
    const created = createDraft(tenant.id, owner, "raw JD text", sampleDraft, [], false, undefined);

    const edited = editDraft(created.id, tenant.id, owner, {
      mustHave: [{ value: "Java", quote: "5 years of Java" }, { value: "Postgres", quote: "and Postgres" }],
    });
    expect(edited.version).toBe(2);
    expect(edited.scorecard.mustHave).toHaveLength(2);
  });

  it("refuses to edit an already-approved scorecard", () => {
    const { tenant, owner } = tenantWithMember();
    const created = createDraft(tenant.id, owner, "raw JD text", sampleDraft, [], false, undefined);
    approve(created.id, tenant.id, owner);
    expect(() => editDraft(created.id, tenant.id, owner, { compensation: { value: "10L", quote: "10L" } })).toThrow(
      ScorecardNotEditableError
    );
  });

  it("approves a draft once, and refuses a second approval", () => {
    const { tenant, owner } = tenantWithMember();
    const created = createDraft(tenant.id, owner, "raw JD text", sampleDraft, [], false, undefined);
    const approved = approve(created.id, tenant.id, owner);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).not.toBeNull();
    expect(() => approve(created.id, tenant.id, owner)).toThrow(ScorecardAlreadyApprovedError);
  });

  it("a scorecard flagged requiresReview refuses a plain approve — the reviewer must explicitly acknowledge it", () => {
    const { tenant, owner } = tenantWithMember();
    const created = createDraft(tenant.id, owner, "raw JD text", sampleDraft, [
      { field: "disqualifiers", value: "under 30", quote: "must be under 30", reason: "age" },
    ], true, "The JD contains an age-based requirement...");
    expect(created.requiresReview).toBe(true);
    expect(() => approve(created.id, tenant.id, owner)).toThrow(ScorecardRequiresReviewError);
    const approved = approve(created.id, tenant.id, owner, { reviewed: true });
    expect(approved.status).toBe("approved");
  });

  it("requireApproved refuses a draft, and succeeds once approved", () => {
    const { tenant, owner } = tenantWithMember();
    const created = createDraft(tenant.id, owner, "raw JD text", sampleDraft, [], false, undefined);
    expect(() => requireApproved(created.id, tenant.id)).toThrow(/not been approved/);
    approve(created.id, tenant.id, owner);
    expect(requireApproved(created.id, tenant.id).status).toBe("approved");
  });

  it("requireApproved is also tenant-isolated — a different tenant's approved scorecard is still invisible", () => {
    const { tenant: tenantA, owner: ownerA } = tenantWithMember();
    const tenantB = createTenant("Agency B");
    const created = createDraft(tenantA.id, ownerA, "raw JD text", sampleDraft, [], false, undefined);
    approve(created.id, tenantA.id, ownerA);
    expect(() => requireApproved(created.id, tenantB.id)).toThrow(/not found/i);
  });

  it("audits create, edit, and approve", () => {
    const { tenant, owner } = tenantWithMember();
    const created = createDraft(tenant.id, owner, "raw JD text", sampleDraft, [], false, undefined);
    editDraft(created.id, tenant.id, owner, { compensation: { value: "10L", quote: "10L" } });
    approve(created.id, tenant.id, owner);
    const actions = db
      .prepare("SELECT action FROM agency_scorecard_audit WHERE scorecard_id = ? ORDER BY created_at")
      .all(created.id) as { action: string }[];
    expect(actions.map((a) => a.action)).toEqual(["created", "edited", "approved"]);
  });
});
