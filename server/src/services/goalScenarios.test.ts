import { describe, it, expect, afterEach } from "vitest";
import { applyPrivacyTier } from "./privacyTier.js";
import { draftAgencyScorecard } from "./agency/scorecard.js";
import { citedReport } from "./research/citedReport.js";

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
  { name: "scorecard keeps must-haves", run: () => expect(draftAgencyScorecard("Role\nMust-have: Java, SQL").mustHave).toEqual(["Java", "SQL"]) },
  { name: "scorecard keeps nice-to-haves", run: () => expect(draftAgencyScorecard("Role\nNice-to-have: Kafka").niceToHave).toEqual(["Kafka"]) },
  { name: "scorecard asks when must-haves are missing", run: () => expect(draftAgencyScorecard("Just a title").mustHave[0]).toMatch(/hiring manager/) },
  { name: "scorecard leaves the decision with the recruiter", run: () => expect(draftAgencyScorecard("Role").recruiterDecides).toBe(true) },
  { name: "search strategy starts in the agency database", run: () => expect(draftAgencyScorecard("Role").searchStrategy[0]).toMatch(/own database/) },
  { name: "search strategy refuses protected attributes", run: () => expect(draftAgencyScorecard("Role").searchStrategy.join(" ")).toMatch(/protected attributes/) },
  { name: "role title is the first line", run: () => expect(draftAgencyScorecard("Platform engineer\nMust-have: Go").role).toBe("Platform engineer") },
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
