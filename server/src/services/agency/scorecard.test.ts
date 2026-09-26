import { describe, it, expect } from "vitest";
import { draftAgencyScorecard } from "./scorecard.js";

describe("agency scorecard", () => {
  it("turns a requirement into a scorecard and a search strategy the recruiter still decides", () => {
    const card = draftAgencyScorecard(
      "Senior backend engineer, Hyderabad\nMust-have: Java, Postgres, 5 years\nNice-to-have: Kafka"
    );
    expect(card.role).toContain("Senior backend");
    expect(card.mustHave).toEqual(["Java", "Postgres", "5 years"]);
    expect(card.niceToHave).toEqual(["Kafka"]);
    expect(card.searchStrategy[0]).toMatch(/own database/);
    expect(card.recruiterDecides).toBe(true);
  });
});
