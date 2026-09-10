import { describe, it, expect, beforeEach, vi } from "vitest";
import { hasAnySearchProviderConfigured, search } from "./searchRouter.js";
import { __resetHealthForTests } from "../providerHealth.js";

const originalEnv = { ...process.env };

vi.mock("./tavily.js", () => ({
  tavilyProvider: {
    name: "tavily",
    configured: vi.fn(),
    search: vi.fn(),
  },
}));
vi.mock("./searxng.js", () => ({
  searxngProvider: {
    name: "searxng",
    configured: vi.fn(),
    search: vi.fn(),
  },
}));

import { tavilyProvider } from "./tavily.js";
import { searxngProvider } from "./searxng.js";

describe("searchRouter", () => {
  beforeEach(() => {
    __resetHealthForTests();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.TAVILY_API_KEY;
    delete process.env.SEARCH_PROVIDER_CHAIN;
    delete process.env.SEARXNG_BASE_URL;
    (searxngProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("reports nothing configured, and search() resolves to null, when no provider has credentials", async () => {
    (tavilyProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(false);
    expect(hasAnySearchProviderConfigured()).toBe(false);
    const result = await search("today's gold rate");
    expect(result).toBeNull();
    expect(tavilyProvider.search).not.toHaveBeenCalled();
  });

  it("returns results from a configured, healthy provider", async () => {
    (tavilyProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (tavilyProvider.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "Gold rate today", url: "https://example.com/gold", snippet: "₹7,200/gram", domain: "example.com" },
    ]);

    expect(hasAnySearchProviderConfigured()).toBe(true);
    const result = await search("today's gold rate");
    expect(result).toEqual({
      providerUsed: "tavily",
      results: [
        {
          title: "Gold rate today",
          url: "https://example.com/gold",
          snippet: "₹7,200/gram",
          domain: "example.com",
          provider: "tavily",
          sourceType: "web",
          freshness: "unknown",
        },
      ],
    });
  });

  it("normalizes results: stamps the answering provider, classifies a known news domain, and buckets freshness from a real publishedAt", async () => {
    (tavilyProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (tavilyProvider.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        title: "Breaking news",
        url: "https://reuters.com/a",
        snippet: "s",
        domain: "reuters.com",
        publishedAt: new Date().toISOString(),
      },
    ]);

    const result = await search("latest news");
    expect(result?.results[0]).toMatchObject({
      provider: "tavily",
      sourceType: "news",
      freshness: "today",
    });
  });

  it("never invents a publish date or freshness when the provider didn't supply one", async () => {
    (tavilyProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (tavilyProvider.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "No date", url: "https://example.com/z", snippet: "s", domain: "example.com" },
    ]);

    const result = await search("something");
    expect(result?.results[0].publishedAt).toBeUndefined();
    expect(result?.results[0].freshness).toBe("unknown");
  });

  it("returns null and records failure, without throwing, when the only configured provider errors", async () => {
    (tavilyProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (tavilyProvider.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network error"));

    const result = await search("today's gold rate");
    expect(result).toBeNull();
  });

  it("prefers searxng (free/self-hosted) over tavily when both are configured — free-first policy", async () => {
    (searxngProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (searxngProvider.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "Self-hosted result", url: "https://example.com/x", snippet: "s", domain: "example.com" },
    ]);
    (tavilyProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const result = await search("today's gold rate");
    expect(result?.providerUsed).toBe("searxng");
    expect(tavilyProvider.search).not.toHaveBeenCalled();
  });

  it("falls back to tavily when searxng is configured but unhealthy/failing", async () => {
    (searxngProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (searxngProvider.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection refused"));
    (tavilyProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (tavilyProvider.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "Fallback result", url: "https://example.com/y", snippet: "s", domain: "example.com" },
    ]);

    const result = await search("today's gold rate");
    expect(result?.providerUsed).toBe("tavily");
  });

  it("is a no-op change when SEARXNG_BASE_URL is unset — same behavior as before searxng existed", async () => {
    (tavilyProvider.configured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (tavilyProvider.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "Gold rate today", url: "https://example.com/gold", snippet: "s", domain: "example.com" },
    ]);

    const result = await search("today's gold rate");
    expect(result?.providerUsed).toBe("tavily");
    expect(searxngProvider.search).not.toHaveBeenCalled();
  });
});
