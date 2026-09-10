import { describe, it, expect, vi, beforeEach } from "vitest";

// Focused on the 2026-09-10 current-info pipeline hardening: freshness/
// source-type metadata must actually reach the text the model sees (not
// just exist as unused fields on an object), and the persona must actually
// instruct the model what to do when sources disagree — see llm.ts.
vi.mock("./embeddings.js", () => ({ embed: vi.fn(async () => new Float32Array([1, 0, 0])) }));
vi.mock("./vectorStore.js", () => ({
  searchSimilarChunks: vi.fn(() => []),
  userHasDocuments: vi.fn(() => false),
}));
vi.mock("./conversationStore.js", () => ({
  getConversationSummary: vi.fn(() => ({ summary: "", throughIndex: 0 })),
  saveConversationSummary: vi.fn(),
}));
vi.mock("./search/searchRouter.js", () => ({
  hasAnySearchProviderConfigured: vi.fn(() => true),
  search: vi.fn(),
}));
vi.mock("./weather/weatherIntent.js", () => ({
  isWeatherQuestion: vi.fn(() => false),
  extractLocationFromMessage: vi.fn(() => null),
}));

import { buildContext } from "./contextManager.js";
import { buildSystemPrompt } from "./llm.js";
import { search as runWebSearch } from "./search/searchRouter.js";

describe("current-info pipeline — freshness/source metadata reaches the model", () => {
  beforeEach(() => {
    vi.mocked(runWebSearch).mockReset();
  });

  it("surfaces sourceType, publish date, and freshness inline in the injected web chunk text", async () => {
    vi.mocked(runWebSearch).mockResolvedValue({
      providerUsed: "tavily",
      results: [
        {
          title: "OpenAI announces new model",
          url: "https://techcrunch.com/a",
          snippet: "details...",
          domain: "techcrunch.com",
          provider: "tavily",
          sourceType: "news",
          publishedAt: "2026-09-09",
          freshness: "this_week",
        },
      ],
    });

    const context = await buildContext("user-1", "conv-1", "What is the latest OpenAI model?", []);
    expect(context.webChunks).toHaveLength(1);
    expect(context.webChunks[0]).toContain("news");
    expect(context.webChunks[0]).toContain("2026-09-09");
    expect(context.webChunks[0]).toContain("this_week");

    expect(context.webSources[0]).toMatchObject({
      provider: "tavily",
      sourceType: "news",
      freshness: "this_week",
      publishedAt: "2026-09-09",
    });
  });

  it("does not inject a bracketed metadata tag at all when a result has none of it (never fabricated)", async () => {
    vi.mocked(runWebSearch).mockResolvedValue({
      providerUsed: "tavily",
      results: [{ title: "T", url: "https://example.com/x", snippet: "s", domain: "example.com" }],
    });

    const context = await buildContext("user-1", "conv-1", "What is the current price of Bitcoin?", []);
    expect(context.webChunks[0]).not.toMatch(/\[.*\]/);
  });
});

describe("system prompt — conflicting-sources instruction", () => {
  it("instructs the model to name a disagreement rather than silently pick a side, only when web results exist", () => {
    const withResults = buildSystemPrompt({
      documentChunks: [],
      webChunks: ["[W1] Some result (https://a.test): text"],
    });
    expect(withResults.toLowerCase()).toContain("conflict");

    const withoutResults = buildSystemPrompt({ documentChunks: [], webChunks: [] });
    expect(withoutResults).not.toContain("[W1]");
  });
});
