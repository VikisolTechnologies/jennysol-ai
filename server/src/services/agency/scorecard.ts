// Workflow (c) for JennySol v1 is the Agency Desk scorecard, not a developer sandbox. A recruiter
// pastes a requirement. Jenny drafts a scorecard, a search strategy, clarification/screening
// questions, and Boolean search strings — every claim cited to a phrase in the JD, missing marked
// "unknown" rather than guessed. The recruiter edits and approves before anything downstream uses
// it (scorecardStore.ts). Nothing here contacts a candidate, scrapes a site, or writes to an ATS.
//
// Rebuilt again per ADR-007 (docs/architecture/ADR-007-agency-desk-privacy.md) and
// docs/reviews/d27386b.md's 18:55 addendum: a JD is Class B (minimized) data, never sent
// anywhere before deterministic redaction (redaction.ts) succeeds, and only ever reaches the
// paid-Gemini CONTROLLED_CLOUD tier — never Ollama, never any other cloud adapter — with
// enforcement forced on regardless of the global watch-only flag (privacyTier.ts's
// `forceEnforce`). A tenant whose kill switch is on, or whose setting is still the
// `private_only` default, never reaches the model at all: there is no private processor for
// agency data yet (BLOCKERS.md), so that path fails honestly rather than silently falling back.
import { streamChatCompletion } from "../llm.js";
import { extractJson } from "../agentJsonExtract.js";
import { agencyScorecardDraftSchema, type AgencyScorecardDraft } from "./scorecardSchema.js";
import { applyGuardrail, type GuardrailRemoval } from "./guardrail.js";
import { redactJd, type RedactionResult } from "./redaction.js";
import { resolveProcessingTier, type AgencyTenant } from "./tenant.js";
import { recordModelCallAudit } from "./modelCallAudit.js";

export type { AgencyScorecardDraft, GuardrailRemoval };

export class ScorecardProcessingRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScorecardProcessingRefusedError";
  }
}

const SYSTEM_PROMPT = `You are drafting a recruiter's screening scorecard from a pasted client job requirement. The requirement below has already had contact details and the client's name removed by a separate, deterministic step — do not try to guess or reconstruct them.
You are not contacting anyone, not searching anything, not writing to any system — only drafting a document a human recruiter will edit and approve.

Respond with ONLY a single JSON object, no prose before or after, matching exactly this shape:
{
  "role": string,
  "mustHave": [{ "value": string, "quote": string }],
  "niceToHave": [{ "value": string, "quote": string }],
  "experienceRange": { "value": string, "quote": string },
  "locationOrWorkMode": { "value": string, "quote": string },
  "compensation": { "value": string, "quote": string },
  "noticePeriod": { "value": string, "quote": string },
  "disqualifiers": [{ "value": string, "quote": string }],
  "contradictions": [string],
  "missingInformation": [string],
  "clientClarificationQuestions": [string],
  "screeningQuestions": [string],
  "booleanSearchStrings": [string]
}

Rules:
- "quote" must be the exact phrase from the JD that a field's "value" came from. If the JD does not state something, set both "value" and "quote" to "unknown" rather than inferring or guessing.
- Extract only information supported by the JD — never invent a requirement.
- Treat a weak word like "preferred" as a nice-to-have, never as a mandatory must-have.
- "contradictions": call out anything the JD states inconsistently (e.g. two different experience or notice-period requirements).
- "missingInformation": anything a recruiter would need to ask about before searching (budget, seniority, team size, etc.) that the JD never states. Compensation and notice period are "unknown" whenever the JD doesn't state them — never inferred from role, title or location.
- Never draft a must-have, nice-to-have, disqualifier, or search string based on gender, age, religion, caste, marital status, disability, appearance, or name — even if the JD itself states one as a requirement; instead note the exact instruction in "contradictions" or "missingInformation" so a human sees it, and still extract every other legitimate requirement normally.
- clientClarificationQuestions are questions for the CLIENT about the role. screeningQuestions are questions a recruiter would ask a CANDIDATE.`;

async function askModel(requirement: string): Promise<{ text: string; providerUsed?: string }> {
  let text = "";
  const result = await streamChatCompletion(
    SYSTEM_PROMPT,
    [{ role: "user", content: requirement }],
    (delta) => {
      text += delta;
    },
    undefined,
    "reasoning",
    undefined,
    "CONTROLLED_CLOUD",
    true // ADR-007 §2: agency traffic is never watch-only, whatever PRIVACY_TIER_ENFORCE says.
  );
  return { text, providerUsed: result.providerUsed };
}

export interface DraftAgencyScorecardResult {
  draft: AgencyScorecardDraft;
  removed: GuardrailRemoval[];
  escalate: boolean;
  refusalNotice?: string;
  redaction: RedactionResult;
  providerUsed?: string;
  latencyMs: number;
}

// One repair retry: a model that returned malformed or non-conforming JSON is told exactly what
// was wrong and asked to fix only that, rather than the caller silently falling back to a guess
// or failing the whole draft on a single hiccup.
export async function draftAgencyScorecard(
  tenant: AgencyTenant,
  requirement: string,
  scorecardId?: string
): Promise<DraftAgencyScorecardResult> {
  const trimmed = requirement.trim();
  if (!trimmed) throw new Error("draftAgencyScorecard needs a requirement");

  const redaction = redactJd(trimmed);
  const resolvedTier = redaction.ok ? resolveProcessingTier(tenant) : "PRIVATE_ONLY";
  const startedAt = Date.now();

  if (resolvedTier !== "CONTROLLED_CLOUD") {
    recordModelCallAudit({
      tenantId: tenant.id,
      scorecardId,
      dataClass: "B",
      requestedTier: "CONTROLLED_CLOUD",
      resolvedTier: "refused",
      redactionOk: redaction.ok,
    });
    throw new ScorecardProcessingRefusedError(
      !redaction.ok
        ? "This JD couldn't be safely redacted (an email, URL, or contact detail may still be present), so it was not sent anywhere. Remove contact details and try again."
        : "Cloud processing isn't enabled for this agency, and there is no private processor available for agency data yet. Nothing was sent anywhere."
    );
  }

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? redaction.redacted
        : `Your previous response was invalid: ${lastError}\n\nRe-draft the SAME job requirement below as a single valid JSON object matching the required shape exactly. Requirement:\n${redaction.redacted}`;
    try {
      const { text, providerUsed } = await askModel(prompt);
      const parsed = agencyScorecardDraftSchema.safeParse(extractJson(text));
      if (!parsed.success) {
        lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        continue;
      }
      const guarded = applyGuardrail(parsed.data);
      const latencyMs = Date.now() - startedAt;
      recordModelCallAudit({
        tenantId: tenant.id,
        scorecardId,
        dataClass: "B",
        requestedTier: "CONTROLLED_CLOUD",
        resolvedTier: "CONTROLLED_CLOUD",
        redactionOk: true,
        providerUsed,
        latencyMs,
      });
      return { ...guarded, redaction, providerUsed, latencyMs };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  recordModelCallAudit({
    tenantId: tenant.id,
    scorecardId,
    dataClass: "B",
    requestedTier: "CONTROLLED_CLOUD",
    resolvedTier: "error",
    redactionOk: true,
    latencyMs: Date.now() - startedAt,
  });
  throw new Error(`Could not draft a valid scorecard after a repair retry: ${lastError}`);
}
