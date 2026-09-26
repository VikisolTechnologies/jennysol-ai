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
    expect(removed).toEqual([{ field: "booleanSearchStrings", value: '("Java") AND male', reason: "protected attribute" }]);
  });

  it("leaves contradictions/missingInformation untouched (they report on protected asks, not act on them)", () => {
    const draft = { ...base, contradictions: ["JD asks for gender and age, which we don't screen on"] };
    const { draft: cleaned } = applyGuardrail(draft);
    expect(cleaned.contradictions).toEqual(draft.contradictions);
  });
});
