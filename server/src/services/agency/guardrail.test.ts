import { describe, it, expect } from "vitest";
import { applyGuardrail } from "./guardrail.js";
import type { AgencyScorecardDraft } from "./scorecardSchema.js";

const base: AgencyScorecardDraft = {
  role: "Backend Engineer",
  mustHave: [],
  niceToHave: [],
  experienceRange: { value: "unknown", quote: "unknown" },
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

describe("applyGuardrail", () => {
  it("keeps clean criteria untouched", () => {
    const draft = { ...base, mustHave: [{ value: "Java", quote: "5 years of Java" }] };
    const { draft: cleaned, removed } = applyGuardrail(draft);
    expect(cleaned.mustHave).toEqual(draft.mustHave);
    expect(removed).toEqual([]);
  });

  it.each([
    ["gender", { value: "Male", quote: "must be male" }],
    ["age", { value: "under 30", quote: "candidate must be under 30" }],
    ["religion", { value: "Hindu", quote: "preferably Hindu" }],
    ["marital status", { value: "unmarried", quote: "must be unmarried" }],
    ["disability", { value: "able-bodied", quote: "must be able-bodied" }],
    ["photo", { value: "photo required", quote: "attach a photograph" }],
  ])("strips a %s-based must-have", (_label, item) => {
    const draft = { ...base, mustHave: [{ value: "Java", quote: "Java" }, item] };
    const { draft: cleaned, removed } = applyGuardrail(draft);
    expect(cleaned.mustHave).toEqual([{ value: "Java", quote: "Java" }]);
    expect(removed).toHaveLength(1);
    expect(removed[0].value).toBe(item.value);
  });

  it("strips a protected criterion from niceToHave and disqualifiers independently", () => {
    const draft = {
      ...base,
      niceToHave: [{ value: "female candidates preferred", quote: "female candidates preferred" }],
      disqualifiers: [{ value: "married", quote: "must not be married" }],
    };
    const { draft: cleaned, removed } = applyGuardrail(draft);
    expect(cleaned.niceToHave).toEqual([]);
    expect(cleaned.disqualifiers).toEqual([]);
    expect(removed.map((r) => r.field).sort()).toEqual(["disqualifiers", "niceToHave"]);
  });

  it("strips a protected term from a Boolean search string", () => {
    const draft = { ...base, booleanSearchStrings: ['("Java") AND male', '("Java") AND Hyderabad'] };
    const { draft: cleaned, removed } = applyGuardrail(draft);
    expect(cleaned.booleanSearchStrings).toEqual(['("Java") AND Hyderabad']);
    expect(removed).toEqual([
      { field: "booleanSearchStrings", value: '("Java") AND male', quote: '("Java") AND male', reason: "gender" },
    ]);
  });

  it("leaves contradictions/missingInformation untouched (they report on protected asks, not act on them)", () => {
    const draft = { ...base, contradictions: ["JD asks for gender and age, which we don't screen on"] };
    const { draft: cleaned } = applyGuardrail(draft);
    expect(cleaned.contradictions).toEqual(draft.contradictions);
  });

  // ADR-007 / docs/evals/agency-scorecard-eval-set.md rules 8-9: never silent, always escalated.
  describe("escalation and the refusal notice", () => {
    it("escalate is false and there is no refusal notice when nothing was removed", () => {
      const draft = { ...base, mustHave: [{ value: "Java", quote: "5 years of Java" }] };
      const result = applyGuardrail(draft);
      expect(result.escalate).toBe(false);
      expect(result.refusalNotice).toBeUndefined();
    });

    it("escalate is true and a refusal notice is produced whenever anything is removed", () => {
      const draft = { ...base, disqualifiers: [{ value: "under 30", quote: "candidates must be under 30 years of age" }] };
      const result = applyGuardrail(draft);
      expect(result.escalate).toBe(true);
      expect(result.refusalNotice).toBeDefined();
      expect(result.refusalNotice).toMatch(/age/i);
      expect(result.refusalNotice).toContain("candidates must be under 30 years of age");
      expect(result.refusalNotice).toMatch(/recruiter\/compliance review/i);
      expect(result.refusalNotice).not.toMatch(/normal (client )?preference/i);
    });

    it("preserves the original quoted instruction in the audit trail even though it's refused, not acted on", () => {
      const draft = {
        ...base,
        disqualifiers: [{ value: "female only", quote: "Only female candidates should be submitted" }],
      };
      const { removed } = applyGuardrail(draft);
      expect(removed[0].quote).toBe("Only female candidates should be submitted");
    });

    it("the refusal notice names every distinct protected label when more than one is removed, without duplicates", () => {
      const draft = {
        ...base,
        mustHave: [{ value: "male", quote: "must be male" }],
        disqualifiers: [{ value: "under 30", quote: "under 30 years old" }],
      };
      const { refusalNotice } = applyGuardrail(draft);
      expect(refusalNotice).toMatch(/gender/);
      expect(refusalNotice).toMatch(/age/);
    });
  });
});
