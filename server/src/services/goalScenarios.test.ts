import { describe, it, expect, afterEach } from "vitest";
import { applyPrivacyTier } from "./privacyTier.js";
import { applyGuardrail } from "./agency/guardrail.js";
import { agencyScorecardDraftSchema } from "./agency/scorecardSchema.js";
import { citedReport } from "./research/citedReport.js";

// The scorecard's actual drafting (draftAgencyScorecard) calls a real model and is covered by its
// own mocked test suite (agency/scorecard.test.ts) — these cases instead exercise the two pure,
// deterministic pieces of that pipeline (the guardrail and the output schema) that belong in this
// file's "no live model" style.
const cleanDraft = {
  role: "Backend Engineer",
  mustHave: [{ value: "Java", quote: "5 years of Java" }],
  niceToHave: [] as { value: string; quote: string }[],
  experienceRange: { value: "5+ years", quote: "5 years of Java" },
  locationOrWorkMode: { value: "unknown", quote: "unknown" },
  compensation: { value: "unknown", quote: "unknown" },
  noticePeriod: { value: "unknown", quote: "unknown" },
  disqualifiers: [] as { value: string; quote: string }[],
  contradictions: [] as string[],
  missingInformation: [] as string[],
  clientClarificationQuestions: [] as string[],
  screeningQuestions: [] as string[],
  booleanSearchStrings: [] as string[],
};

// Twenty deterministic cases. Live model runs are recorded separately in
// docs/JENNYSOL-GOAL-EVAL.md; these do not pretend to be those runs.
const cases: Array<{ name: string; run: () => void }> = [
  { name: "private shadow keeps gemini", run: () => expect(applyPrivacyTier("PRIVATE", ["gemini", "ollama"]).names).toContain("gemini") },
  { name: "private shadow names the cloud refusal", run: () => expect(applyPrivacyTier("PRIVATE", ["gemini"]).rejected).toEqual(["gemini"]) },
  { name: "public cloud refuses nobody", run: () => expect(applyPrivacyTier("PUBLIC_CLOUD", ["gemini"]).rejected).toEqual([]) },
  { name: "local tier records the same cloud refusal", run: () => expect(applyPrivacyTier("LOCAL", ["ollama", "gemini"]).rejected).toEqual(["gemini"]) },
  { name: "unset tier leaves the chain alone", run: () => expect(applyPrivacyTier(undefined, ["gemini"]).names).toEqual(["gemini"]) },
  {
    name: "enforced private drops the cloud",
    run: () => {
      process.env.PRIVACY_TIER_ENFORCE = "true";
      expect(applyPrivacyTier("PRIVATE", ["gemini", "ollama"]).names).toEqual(["ollama"]);
    },
  },
  { name: "guardrail keeps a clean must-have", run: () => expect(applyGuardrail(cleanDraft).draft.mustHave).toEqual(cleanDraft.mustHave) },
  {
    name: "guardrail strips a gender-based must-have",
    run: () => {
      const draft = { ...cleanDraft, mustHave: [...cleanDraft.mustHave, { value: "Male", quote: "must be male" }] };
      expect(applyGuardrail(draft).draft.mustHave).toEqual(cleanDraft.mustHave);
    },
  },
  {
    name: "guardrail strips an age-based disqualifier",
    run: () => {
      const draft = { ...cleanDraft, disqualifiers: [{ value: "over 40", quote: "must be over 40" }] };
      expect(applyGuardrail(draft).draft.disqualifiers).toEqual([]);
    },
  },
  {
    name: "guardrail strips a protected boolean search string",
    run: () => {
      const draft = { ...cleanDraft, booleanSearchStrings: ['("Java") AND female'] };
      expect(applyGuardrail(draft).draft.booleanSearchStrings).toEqual([]);
    },
  },
  {
    name: "guardrail reports every removal, not just a count",
    run: () => {
      const draft = { ...cleanDraft, niceToHave: [{ value: "Hindu", quote: "preferably Hindu" }] };
      expect(applyGuardrail(draft).removed).toEqual([{ field: "niceToHave", value: "Hindu", reason: "religion" }]);
    },
  },
  {
    name: "schema rejects a cited item missing its quote",
    run: () =>
      expect(
        agencyScorecardDraftSchema.safeParse({ ...cleanDraft, experienceRange: { value: "5 years" } }).success
      ).toBe(false),
  },
  { name: "schema accepts a valid full draft", run: () => expect(agencyScorecardDraftSchema.safeParse(cleanDraft).success).toBe(true) },
  { name: "cited sentence keeps its number", run: () => expect(citedReport("q", [{ title: "A", url: "https://a.example", snippet: "Fact." }]).report).toBe("Fact. [1]") },
  { name: "citation list carries the url", run: () => expect(citedReport("q", [{ title: "A", url: "https://a.example", snippet: "Fact." }]).citations[0].url).toBe("https://a.example") },
  { name: "two hits stay in order", run: () => expect(citedReport("q", [{ title: "A", url: "https://a.example", snippet: "One" }, { title: "B", url: "https://b.example", snippet: "Two" }]).report).toContain("[2]") },
  { name: "empty search writes no report", run: () => expect(citedReport("q", []).report).toBe("") },
  { name: "empty search says so", run: () => expect(citedReport("q", []).note).toMatch(/No sources/) },
  { name: "a hit without a url is dropped", run: () => expect(citedReport("q", [{ title: "A", url: "", snippet: "Fact" }]).citations).toEqual([]) },
  { name: "a hit without a snippet is dropped", run: () => expect(citedReport("q", [{ title: "A", url: "https://a.example", snippet: "" }]).report).toBe("") },
];

describe("twenty deterministic scenarios", () => {
  afterEach(() => {
    delete process.env.PRIVACY_TIER_ENFORCE;
  });

  it.each(cases)("$name", ({ run }) => {
    run();
  });
});
