// Every query here is scoped by owner_user_id — the same tenant-isolation pattern
// conversationStore.ts uses. A scorecard id alone is never sufficient; the caller's userId
// (set by requireAuth from a verified session) must match the row's owner too.
import { randomUUID, createHash } from "node:crypto";
import { db } from "../../db/index.js";
import type { AgencyScorecardDraft } from "./scorecardSchema.js";
import type { GuardrailRemoval } from "./guardrail.js";

export type ScorecardStatus = "draft" | "approved";

export interface StoredScorecard {
  id: string;
  ownerUserId: string;
  status: ScorecardStatus;
  version: number;
  jdSource: string;
  scorecard: AgencyScorecardDraft;
  guardrailRemoved: GuardrailRemoval[];
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
}

interface Row {
  id: string;
  owner_user_id: string;
  status: string;
  version: number;
  jd_hash: string;
  jd_source: string;
  scorecard: string;
  guardrail_removed: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

function fromRow(row: Row): StoredScorecard {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    status: row.status as ScorecardStatus,
    version: row.version,
    jdSource: row.jd_source,
    scorecard: JSON.parse(row.scorecard) as AgencyScorecardDraft,
    guardrailRemoved: JSON.parse(row.guardrail_removed) as GuardrailRemoval[],
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
  ownerUserId: string,
  jdSource: string,
  scorecard: AgencyScorecardDraft,
  guardrailRemoved: GuardrailRemoval[]
): StoredScorecard {
  const id = randomUUID();
  const jdHash = createHash("sha256").update(jdSource).digest("hex");
  db.prepare(
    `INSERT INTO agency_scorecards (id, owner_user_id, status, version, jd_hash, jd_source, scorecard, guardrail_removed)
     VALUES (?, ?, 'draft', 1, ?, ?, ?, ?)`
  ).run(id, ownerUserId, jdHash, jdSource, JSON.stringify(scorecard), JSON.stringify(guardrailRemoved));
  audit(id, ownerUserId, "created");
  return getOwned(id, ownerUserId)!;
}

export function getOwned(id: string, ownerUserId: string): StoredScorecard | null {
  const row = db
    .prepare("SELECT * FROM agency_scorecards WHERE id = ? AND owner_user_id = ?")
    .get(id, ownerUserId) as Row | undefined;
  return row ? fromRow(row) : null;
}

export function listOwned(ownerUserId: string): StoredScorecard[] {
  const rows = db
    .prepare("SELECT * FROM agency_scorecards WHERE owner_user_id = ? ORDER BY updated_at DESC")
    .all(ownerUserId) as Row[];
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
  ownerUserId: string,
  patch: Partial<Pick<AgencyScorecardDraft, "mustHave" | "niceToHave" | "experienceRange" | "locationOrWorkMode" | "compensation" | "noticePeriod" | "disqualifiers" | "clientClarificationQuestions" | "screeningQuestions" | "booleanSearchStrings">>
): StoredScorecard {
  const existing = getOwned(id, ownerUserId);
  if (!existing) throw new Error("Scorecard not found");
  if (existing.status !== "draft") throw new ScorecardNotEditableError();
  const merged: AgencyScorecardDraft = { ...existing.scorecard, ...patch };
  db.prepare(
    "UPDATE agency_scorecards SET scorecard = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?"
  ).run(JSON.stringify(merged), id, ownerUserId);
  audit(id, ownerUserId, "edited");
  return getOwned(id, ownerUserId)!;
}

export class ScorecardAlreadyApprovedError extends Error {
  constructor() {
    super("This scorecard is already approved");
    this.name = "ScorecardAlreadyApprovedError";
  }
}

export function approve(id: string, ownerUserId: string): StoredScorecard {
  const existing = getOwned(id, ownerUserId);
  if (!existing) throw new Error("Scorecard not found");
  if (existing.status === "approved") throw new ScorecardAlreadyApprovedError();
  db.prepare(
    "UPDATE agency_scorecards SET status = 'approved', approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?"
  ).run(id, ownerUserId);
  audit(id, ownerUserId, "approved");
  return getOwned(id, ownerUserId)!;
}

// The enforcement point for "only an approved scorecard can be used later" — every future
// caller (a chat tool, a candidate-matching step) must go through this rather than reading
// agency_scorecards directly, so a draft can never be silently used as if it were final.
export function requireApproved(id: string, ownerUserId: string): StoredScorecard {
  const existing = getOwned(id, ownerUserId);
  if (!existing) throw new Error("Scorecard not found");
  if (existing.status !== "approved") throw new Error("This scorecard has not been approved yet");
  return existing;
}
