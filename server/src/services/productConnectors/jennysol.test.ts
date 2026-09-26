import { describe, it, expect, vi } from "vitest";

vi.mock("../llm.js", () => ({ streamChatCompletion: vi.fn() }));

const { jennysolConnector } = await import("./jennysol.js");
const { streamChatCompletion } = await import("../llm.js");
const mockStream = vi.mocked(streamChatCompletion);

import type { ProductIdentity } from "../productIdentity.js";

const identity: ProductIdentity = { product: "jennysol", externalUserId: "u1", scope: [] };

const validDraft = {
  role: "Senior Backend Engineer",
  mustHave: [{ value: "Node.js", quote: "Node.js" }],
  niceToHave: [{ value: "Kubernetes", quote: "Kubernetes a plus" }],
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

describe("jennysolConnector — jennysol.draftAgencyScorecard", () => {
  it("is registered as a low-risk READ tool", () => {
    const tool = jennysolConnector.getTools().find((t) => t.name === "jennysol.draftAgencyScorecard");
    expect(tool).toBeDefined();
    expect(tool?.tier).toBe("READ");
    expect(tool?.risk).toBe("low");
  });

  it("drafts a scorecard from a pasted requirement and always defers to the recruiter", async () => {
    mockStream.mockImplementationOnce(async (_sys, _hist, onDelta) => {
      onDelta(JSON.stringify(validDraft));
      return { providerUsed: "gemini", fellBack: false };
    });
    const tool = jennysolConnector.getTools().find((t) => t.name === "jennysol.draftAgencyScorecard")!;
    const result = (await tool.execute(identity, {
      requirement: "Senior Backend Engineer\nMust-have: Node.js\nNice-to-have: Kubernetes",
    })) as { draft: typeof validDraft; removed: unknown[] };

    expect(result.draft.role).toBe("Senior Backend Engineer");
    expect(result.draft.mustHave).toEqual(validDraft.mustHave);
    expect(result.removed).toEqual([]);
  });

  it("rejects an empty requirement rather than drafting a scorecard from nothing", async () => {
    const tool = jennysolConnector.getTools().find((t) => t.name === "jennysol.draftAgencyScorecard")!;
    await expect(tool.execute(identity, { requirement: "  " })).rejects.toThrow(/requirement/);
    expect(mockStream).not.toHaveBeenCalled();
  });
});
