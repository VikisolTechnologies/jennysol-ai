// Every query here is scoped by tenant_id — ADR-007 §9/§12 step 3's isolation boundary. A
// scorecard belongs to the agency (the tenant), not to whichever member happened to draft it: any
// member of that tenant can read/edit/approve it, but a member of a DIFFERENT tenant must never
// be able to, whatever their own user id is (agency/tenant.ts's requireMembership() is the one
// place that's checked before any of these functions are ever called with a real request).
import { randomUUID, createHash } from "node:crypto";
import { db } from "../../db/index.js";
import type { AgencyScorecardDraft } from "./scorecardSchema.js";
import type { GuardrailRemoval } from "./guardrail.js";

export type ScorecardStatus = "draft" | "approved";

export interface StoredScorecard {
  id: string;
  tenantId: string;
  ownerUserId: string;
  status: ScorecardStatus;
  version: number;
  jdSource: string;
  scorecard: AgencyScorecardDraft;
  guardrailRemoved: GuardrailRemoval[];
  requiresReview: boolean;
  refusalNotice: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
}

interface Row {
  id: string;
  tenant_id: string | null;
  owner_user_id: string;
  status: string;
  version: number;
  jd_hash: string;
  jd_source: string;
  scorecard: string;
  guardrail_removed: string;
  requires_review: number;
  refusal_notice: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

function fromRow(row: Row): StoredScorecard {
  return {
    id: row.id,
    tenantId: row.tenant_id ?? "",
    ownerUserId: row.owner_user_id,
    status: row.status as ScorecardStatus,
    version: row.version,
    jdSource: row.jd_source,
    scorecard: JSON.parse(row.scorecard) as AgencyScorecardDraft,
    guardrailRemoved: JSON.parse(row.guardrail_removed) as GuardrailRemoval[],
    requiresReview: row.requires_review === 1,
    refusalNotice: row.refusal_notice,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
  };
}

function audit(scorecardId: string, actorUserId: string, action: string): void {
  db.prepare("INSERT INTO agency_scorecard_audit (id, scorecard_id, actor_user_id, action) VALUES (?, ?, ?, ?)").run(
    randomUUID(),
    scorecardId,
    actorUserId,
    action
  );
}

export function createDraft(
  tenantId: string,
  ownerUserId: string,
  jdSource: string,
  scorecard: AgencyScorecardDraft,
  guardrailRemoved: GuardrailRemoval[],
  requiresReview: boolean,
  refusalNotice: string | undefined
): StoredScorecard {
  const id = randomUUID();
  const jdHash = createHash("sha256").update(jdSource).digest("hex");
  db.prepare(
    `INSERT INTO agency_scorecards
       (id, tenant_id, owner_user_id, status, version, jd_hash, jd_source, scorecard, guardrail_removed, requires_review, refusal_notice)
     VALUES (?, ?, ?, 'draft', 1, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    tenantId,
    ownerUserId,
    jdHash,
    jdSource,
    JSON.stringify(scorecard),
    JSON.stringify(guardrailRemoved),
    requiresReview ? 1 : 0,
    refusalNotice ?? null
  );
  audit(id, ownerUserId, "created");
  return getForTenant(id, tenantId)!;
}

export function getForTenant(id: string, tenantId: string): StoredScorecard | null {
  const row = db.prepare("SELECT * FROM agency_scorecards WHERE id = ? AND tenant_id = ?").get(id, tenantId) as
    | Row
    | undefined;
  return row ? fromRow(row) : null;
}

export function listForTenant(tenantId: string): StoredScorecard[] {
  const rows = db
    .prepare("SELECT * FROM agency_scorecards WHERE tenant_id = ? ORDER BY updated_at DESC")
    .all(tenantId) as Row[];
  return rows.map(fromRow);
}

export class ScorecardNotEditableError extends Error {
  constructor() {
    super("Only a draft scorecard can be edited");
    this.name = "ScorecardNotEditableError";
  }
}

// Only fields the recruiter is meant to hand-edit are accepted here — contradictions,
// missingInformation, and the guardrail-removed list are the model's/guardrail's own record of
// what happened and aren't user-editable through this path.
export function editDraft(
  id: string,
  tenantId: string,
  actorUserId: string,
  patch: Partial<Pick<AgencyScorecardDraft, "mustHave" | "niceToHave" | "experienceRange" | "locationOrWorkMode" | "compensation" | "noticePeriod" | "disqualifiers" | "clientClarificationQuestions" | "screeningQuestions" | "booleanSearchStrings">>
): StoredScorecard {
  const existing = getForTenant(id, tenantId);
  if (!existing) throw new Error("Scorecard not found");
  if (existing.status !== "draft") throw new ScorecardNotEditableError();
  const merged: AgencyScorecardDraft = { ...existing.scorecard, ...patch };
  db.prepare(
    "UPDATE agency_scorecards SET scorecard = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?"
  ).run(JSON.stringify(merged), id, tenantId);
  audit(id, actorUserId, "edited");
  return getForTenant(id, tenantId)!;
}

export class ScorecardAlreadyApprovedError extends Error {
  constructor() {
    super("This scorecard is already approved");
    this.name = "ScorecardAlreadyApprovedError";
  }
}

export class ScorecardRequiresReviewError extends Error {
  constructor() {
    super("This scorecard flagged a protected-attribute requirement and needs compliance review before it can be approved");
    this.name = "ScorecardRequiresReviewError";
  }
}

export function approve(id: string, tenantId: string, actorUserId: string, opts: { reviewed?: boolean } = {}): StoredScorecard {
  const existing = getForTenant(id, tenantId);
  if (!existing) throw new Error("Scorecard not found");
  if (existing.status === "approved") throw new ScorecardAlreadyApprovedError();
  // eval rule 9 / ADR-007: a flagged scorecard doesn't quietly approve like any other — the actor
  // must explicitly acknowledge the review (opts.reviewed), not just click the same Approve button.
  if (existing.requiresReview && !opts.reviewed) throw new ScorecardRequiresReviewError();
  db.prepare(
    "UPDATE agency_scorecards SET status = 'approved', approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND tenant_id = ?"
  ).run(id, tenantId);
  audit(id, actorUserId, existing.requiresReview ? "approved_after_review" : "approved");
  return getForTenant(id, tenantId)!;
}

// The enforcement point for "only an approved scorecard can be used later" — every future
// caller (a chat tool, a candidate-matching step) must go through this rather than reading
// agency_scorecards directly, so a draft can never be silently used as if it were final.
export function requireApproved(id: string, tenantId: string): StoredScorecard {
  const existing = getForTenant(id, tenantId);
  if (!existing) throw new Error("Scorecard not found");
  if (existing.status !== "approved") throw new Error("This scorecard has not been approved yet");
  return existing;
}
