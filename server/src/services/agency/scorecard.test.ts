import { describe, it, expect, vi, beforeEach } from "vitest";
import { draftAgencyScorecard } from "./scorecard.js";

vi.mock("../llm.js", () => ({ streamChatCompletion: vi.fn() }));

const { streamChatCompletion } = await import("../llm.js");
const mockStream = vi.mocked(streamChatCompletion);

function respondWith(json: unknown) {
  mockStream.mockImplementationOnce(async (_sys, _hist, onDelta) => {
    onDelta(JSON.stringify(json));
    return { providerUsed: "gemini", fellBack: false };
  });
}

const validDraft = {
  role: "Senior Backend Engineer",
  mustHave: [{ value: "Java", quote: "5+ years of Java" }],
  niceToHave: [{ value: "Kafka", quote: "Kafka experience a plus" }],
  experienceRange: { value: "5+ years", quote: "5+ years of Java" },
  locationOrWorkMode: { value: "Hyderabad", quote: "based in Hyderabad" },
  compensation: { value: "unknown", quote: "unknown" },
  noticePeriod: { value: "unknown", quote: "unknown" },
  disqualifiers: [],
  contradictions: [],
  missingInformation: ["Budget range was not stated"],
  clientClarificationQuestions: ["What is the budget for this role?"],
  screeningQuestions: ["How many years of production Java experience do you have?"],
  booleanSearchStrings: ['("Java" AND "Postgres") AND Hyderabad'],
};

describe("draftAgencyScorecard", () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  it("parses a valid model draft into a structured scorecard", async () => {
    respondWith(validDraft);
    const { draft, removed } = await draftAgencyScorecard(
      "Senior Backend Engineer, Hyderabad. 5+ years of Java, Postgres. Kafka experience a plus."
    );
    expect(draft.role).toBe("Senior Backend Engineer");
    expect(draft.mustHave).toEqual(validDraft.mustHave);
    expect(removed).toEqual([]);
  });

  it("strips a protected-attribute criterion the model drafted anyway", async () => {
    respondWith({
      ...validDraft,
      mustHave: [...validDraft.mustHave, { value: "Male", quote: "must be male" }],
    });
    const { draft, removed } = await draftAgencyScorecard("Some requirement that mentions gender");
    expect(draft.mustHave.map((m) => m.value)).toEqual(["Java"]);
    expect(removed).toEqual([{ field: "mustHave", value: "Male", reason: "gender" }]);
  });

  it("retries once with a repair prompt when the model returns invalid JSON, then succeeds", async () => {
    mockStream.mockImplementationOnce(async (_sys, _hist, onDelta) => {
      onDelta("not json at all");
      return { providerUsed: "gemini", fellBack: false };
    });
    respondWith(validDraft);
    const { draft } = await draftAgencyScorecard("Senior Backend Engineer");
    expect(draft.role).toBe("Senior Backend Engineer");
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("throws a real error after the repair retry also fails", async () => {
    mockStream.mockImplementation(async (_sys, _hist, onDelta) => {
      onDelta("still not json");
      return { providerUsed: "gemini", fellBack: false };
    });
    await expect(draftAgencyScorecard("Senior Backend Engineer")).rejects.toThrow(/repair retry/);
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty requirement without calling the model", async () => {
    await expect(draftAgencyScorecard("  ")).rejects.toThrow(/requirement/);
    expect(mockStream).not.toHaveBeenCalled();
  });
});
