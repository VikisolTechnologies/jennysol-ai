import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import {
  createDraft,
  getOwned,
  listOwned,
  editDraft,
  approve,
  requireApproved,
  ScorecardNotEditableError,
  ScorecardAlreadyApprovedError,
} from "./scorecardStore.js";
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

describe("agency scorecard store", () => {
  const userIds: string[] = [];

  afterEach(() => {
    for (const id of userIds.splice(0)) db.prepare("DELETE FROM users WHERE id = ?").run(id); // cascades
  });

  it("creates a draft and reads it back scoped to its owner", () => {
    const owner = makeUser();
    userIds.push(owner);
    const other = makeUser();
    userIds.push(other);

    const created = createDraft(owner, "raw JD text", sampleDraft, []);
    expect(created.status).toBe("draft");
    expect(created.version).toBe(1);

    expect(getOwned(created.id, owner)).not.toBeNull();
    expect(getOwned(created.id, other)).toBeNull(); // a different owner can't read it
    expect(listOwned(owner).map((s) => s.id)).toEqual([created.id]);
  });

  it("edits a draft's fields and bumps the version", () => {
    const owner = makeUser();
    userIds.push(owner);
    const created = createDraft(owner, "raw JD text", sampleDraft, []);

    const edited = editDraft(created.id, owner, {
      mustHave: [{ value: "Java", quote: "5 years of Java" }, { value: "Postgres", quote: "and Postgres" }],
    });
    expect(edited.version).toBe(2);
    expect(edited.scorecard.mustHave).toHaveLength(2);
  });

  it("refuses to edit an already-approved scorecard", () => {
    const owner = makeUser();
    userIds.push(owner);
    const created = createDraft(owner, "raw JD text", sampleDraft, []);
    approve(created.id, owner);
    expect(() => editDraft(created.id, owner, { compensation: { value: "10L", quote: "10L" } })).toThrow(
      ScorecardNotEditableError
    );
  });

  it("approves a draft once, and refuses a second approval", () => {
    const owner = makeUser();
    userIds.push(owner);
    const created = createDraft(owner, "raw JD text", sampleDraft, []);
    const approved = approve(created.id, owner);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).not.toBeNull();
    expect(() => approve(created.id, owner)).toThrow(ScorecardAlreadyApprovedError);
  });

  it("requireApproved refuses a draft, and succeeds once approved", () => {
    const owner = makeUser();
    userIds.push(owner);
    const created = createDraft(owner, "raw JD text", sampleDraft, []);
    expect(() => requireApproved(created.id, owner)).toThrow(/not been approved/);
    approve(created.id, owner);
    expect(requireApproved(created.id, owner).status).toBe("approved");
  });

  it("audits create, edit, and approve", () => {
    const owner = makeUser();
    userIds.push(owner);
    const created = createDraft(owner, "raw JD text", sampleDraft, []);
    editDraft(created.id, owner, { compensation: { value: "10L", quote: "10L" } });
    approve(created.id, owner);
    const actions = db
      .prepare("SELECT action FROM agency_scorecard_audit WHERE scorecard_id = ? ORDER BY created_at")
      .all(created.id) as { action: string }[];
    expect(actions.map((a) => a.action)).toEqual(["created", "edited", "approved"]);
  });
});
