// Workflow (c): paste JD -> draft -> edit fields -> approve. Every route below is scoped to
// req.userId (see agencyScorecardStore.ts) — a scorecard id alone is never sufficient. Synthetic/
// public JDs only for now, per docs/reviews/d27386b.md's data rule (no real client JD or
// candidate data until the founder decides where agency data is processed) — this route doesn't
// enforce that itself (it can't tell a real JD from a synthetic one), it's a product/process rule
// documented in JENNYSOL-EVAL-RESULTS.md and BLOCKERS.md.
import { Router } from "express";
import { z } from "zod";
import { zodErrorMessage } from "../utils/zodError.js";
import { draftAgencyScorecard } from "../services/agency/scorecard.js";
import {
  createDraft,
  getOwned,
  listOwned,
  editDraft,
  approve,
  ScorecardNotEditableError,
  ScorecardAlreadyApprovedError,
} from "../services/agency/scorecardStore.js";

export const agencyScorecardsRouter = Router();

agencyScorecardsRouter.get("/", (req, res) => {
  res.json({ scorecards: listOwned(req.userId!) });
});

agencyScorecardsRouter.get("/:id", (req, res) => {
  const scorecard = getOwned(req.params.id, req.userId!);
  if (!scorecard) {
    res.status(404).json({ error: "Scorecard not found" });
    return;
  }
  res.json({ scorecard });
});

const createSchema = z.object({
  requirement: z.string().trim().min(1, "Paste a job requirement first").max(20_000),
});

agencyScorecardsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  try {
    const { draft, removed } = await draftAgencyScorecard(parsed.data.requirement);
    const stored = createDraft(req.userId!, parsed.data.requirement, draft, removed);
    res.status(201).json({ scorecard: stored });
  } catch (err) {
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
  try {
    const updated = editDraft(req.params.id, req.userId!, parsed.data);
    res.json({ scorecard: updated });
  } catch (err) {
    if (err instanceof ScorecardNotEditableError) {
      res.status(409).json({ error: err.message });
      return;
    }
    res.status(404).json({ error: err instanceof Error ? err.message : "Scorecard not found" });
  }
});

agencyScorecardsRouter.post("/:id/approve", (req, res) => {
  try {
    const approved = approve(req.params.id, req.userId!);
    res.json({ scorecard: approved });
  } catch (err) {
    if (err instanceof ScorecardAlreadyApprovedError) {
      res.status(409).json({ error: err.message });
      return;
    }
    res.status(404).json({ error: err instanceof Error ? err.message : "Scorecard not found" });
  }
});
