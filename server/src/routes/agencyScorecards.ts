// Workflow (c): paste JD -> draft -> edit fields -> approve. Every route below requires the
// caller to be a member of the tenant it names (agency/tenant.ts's requireMembership) — a
// scorecard id alone is never sufficient, and neither is a tenant id alone. Synthetic/public JDs
// only for now, per the data rule (no real client JD or candidate data until Stage 2's
// conditions in ADR-007 §6 are met) — this route can't tell a real JD from a synthetic one
// itself, that's a product/process rule documented in JENNYSOL-EVAL-RESULTS.md and BLOCKERS.md.
import { Router } from "express";
import { z } from "zod";
import { zodErrorMessage } from "../utils/zodError.js";
import { draftAgencyScorecard, ScorecardProcessingRefusedError } from "../services/agency/scorecard.js";
import { requireMembership } from "../services/agency/tenant.js";
import {
  createDraft,
  getForTenant,
  listForTenant,
  editDraft,
  approve,
  ScorecardNotEditableError,
  ScorecardAlreadyApprovedError,
  ScorecardRequiresReviewError,
} from "../services/agency/scorecardStore.js";

export const agencyScorecardsRouter = Router();

function tenantIdFrom(req: { query: unknown; body: unknown }): string {
  const q = req.query as Record<string, unknown>;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const id = typeof b.tenantId === "string" ? b.tenantId : typeof q.tenantId === "string" ? q.tenantId : "";
  return id;
}

function requireTenant(req: { userId?: string; query: unknown; body: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }): string | null {
  const tenantId = tenantIdFrom(req);
  if (!tenantId) {
    res.status(400).json({ error: "tenantId is required" });
    return null;
  }
  try {
    requireMembership(tenantId, req.userId!);
    return tenantId;
  } catch {
    // Same shape whether the tenant doesn't exist or the user isn't a member of it — never
    // reveal which, to a caller who could otherwise probe for real tenant ids.
    res.status(404).json({ error: "Not a member of this agency tenant" });
    return null;
  }
}

agencyScorecardsRouter.get("/", (req, res) => {
  const tenantId = requireTenant(req, res);
  if (!tenantId) return;
  res.json({ scorecards: listForTenant(tenantId) });
});

agencyScorecardsRouter.get("/:id", (req, res) => {
  const tenantId = requireTenant(req, res);
  if (!tenantId) return;
  const scorecard = getForTenant(req.params.id, tenantId);
  if (!scorecard) {
    res.status(404).json({ error: "Scorecard not found" });
    return;
  }
  res.json({ scorecard });
});

const createSchema = z.object({
  tenantId: z.string().min(1),
  requirement: z.string().trim().min(1, "Paste a job requirement first").max(20_000),
});

agencyScorecardsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  let tenant;
  try {
    tenant = requireMembership(parsed.data.tenantId, req.userId!);
  } catch {
    res.status(404).json({ error: "Not a member of this agency tenant" });
    return;
  }
  try {
    const { draft, removed, escalate, refusalNotice } = await draftAgencyScorecard(tenant, parsed.data.requirement);
    const stored = createDraft(tenant.id, req.userId!, parsed.data.requirement, draft, removed, escalate, refusalNotice);
    res.status(201).json({ scorecard: stored });
  } catch (err) {
    if (err instanceof ScorecardProcessingRefusedError) {
      res.status(422).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: err instanceof Error ? err.message : "Could not draft a scorecard" });
  }
});

const editableFields = z
  .object({
    mustHave: z.array(z.object({ value: z.string(), quote: z.string() })),
    niceToHave: z.array(z.object({ value: z.string(), quote: z.string() })),
    experienceRange: z.object({ value: z.string(), quote: z.string() }),
    locationOrWorkMode: z.object({ value: z.string(), quote: z.string() }),
    compensation: z.object({ value: z.string(), quote: z.string() }),
    noticePeriod: z.object({ value: z.string(), quote: z.string() }),
    disqualifiers: z.array(z.object({ value: z.string(), quote: z.string() })),
    clientClarificationQuestions: z.array(z.string()),
    screeningQuestions: z.array(z.string()),
    booleanSearchStrings: z.array(z.string()),
  })
  .partial();

agencyScorecardsRouter.patch("/:id", (req, res) => {
  const parsed = editableFields.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  const tenantId = requireTenant(req, res);
  if (!tenantId) return;
  try {
    const updated = editDraft(req.params.id, tenantId, req.userId!, parsed.data);
    res.json({ scorecard: updated });
  } catch (err) {
    if (err instanceof ScorecardNotEditableError) {
      res.status(409).json({ error: err.message });
      return;
    }
    res.status(404).json({ error: err instanceof Error ? err.message : "Scorecard not found" });
  }
});

const approveSchema = z.object({ reviewed: z.boolean().optional() });

agencyScorecardsRouter.post("/:id/approve", (req, res) => {
  const parsed = approveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  const tenantId = requireTenant(req, res);
  if (!tenantId) return;
  try {
    const approved = approve(req.params.id, tenantId, req.userId!, { reviewed: parsed.data.reviewed });
    res.json({ scorecard: approved });
  } catch (err) {
    if (err instanceof ScorecardAlreadyApprovedError || err instanceof ScorecardRequiresReviewError) {
      res.status(409).json({ error: err.message, code: err instanceof ScorecardRequiresReviewError ? "requires_review" : "already_approved" });
      return;
    }
    res.status(404).json({ error: err instanceof Error ? err.message : "Scorecard not found" });
  }
});
