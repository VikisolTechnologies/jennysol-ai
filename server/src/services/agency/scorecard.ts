// Workflow (c) for JennySol v1 is the Agency Desk scorecard, not a developer sandbox. A recruiter
// pastes a requirement. Jenny drafts a scorecard, a search strategy, clarification/screening
// questions, and Boolean search strings — every claim cited to a phrase in the JD, missing marked
// "unknown" rather than guessed. The recruiter edits and approves before anything downstream uses
// it (agencyScorecardStore.ts). Nothing here contacts a candidate, scrapes a site, or writes to
// an ATS. Reviewed and rebuilt per docs/reviews/d27386b.md — the previous version was a regex
// stub that split lines after "must have:" and returned a hard-coded search strategy.
import { streamChatCompletion } from "../llm.js";
import { extractJson } from "../agentJsonExtract.js";
import { agencyScorecardDraftSchema, type AgencyScorecardDraft } from "./scorecardSchema.js";
import { applyGuardrail, type GuardrailRemoval } from "./guardrail.js";

export type { AgencyScorecardDraft, GuardrailRemoval };

const SYSTEM_PROMPT = `You are drafting a recruiter's screening scorecard from a pasted client job requirement.
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
- "contradictions": call out anything the JD states inconsistently (e.g. two different experience requirements).
- "missingInformation": anything a recruiter would need to ask about before searching (budget, seniority, team size, etc.) that the JD never states.
- Never draft a must-have, nice-to-have, disqualifier, or search string based on gender, age, religion, caste, marital status, disability, appearance, or name — even if the JD itself states one; note it in "contradictions" or "missingInformation" instead of turning it into a search criterion.
- clientClarificationQuestions are questions for the CLIENT about the role. screeningQuestions are questions a recruiter would ask a CANDIDATE.`;

async function askModel(requirement: string): Promise<string> {
  let text = "";
  await streamChatCompletion(
    SYSTEM_PROMPT,
    [{ role: "user", content: requirement }],
    (delta) => {
      text += delta;
    },
    undefined,
    "reasoning",
    undefined,
    "PRIVATE"
  );
  return text;
}

// One repair retry: a model that returned malformed or non-conforming JSON is told exactly what
// was wrong and asked to fix only that, rather than the caller silently falling back to a guess
// or failing the whole draft on a single hiccup.
export async function draftAgencyScorecard(requirement: string): Promise<{ draft: AgencyScorecardDraft; removed: GuardrailRemoval[] }> {
  const trimmed = requirement.trim();
  if (!trimmed) throw new Error("draftAgencyScorecard needs a requirement");

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? trimmed
        : `Your previous response was invalid: ${lastError}\n\nRe-draft the SAME job requirement below as a single valid JSON object matching the required shape exactly. Requirement:\n${trimmed}`;
    try {
      const raw = await askModel(prompt);
      const parsed = agencyScorecardDraftSchema.safeParse(extractJson(raw));
      if (!parsed.success) {
        lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        continue;
      }
      return applyGuardrail(parsed.data);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`Could not draft a valid scorecard after a repair retry: ${lastError}`);
}
