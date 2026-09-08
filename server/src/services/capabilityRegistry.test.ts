import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./modelRouter.js", () => ({ hasAnyConfiguredProvider: vi.fn() }));
vi.mock("./providers/ollama.js", () => ({ isOllamaAvailable: vi.fn() }));
vi.mock("./search/searchRouter.js", () => ({ hasAnySearchProviderConfigured: vi.fn() }));

import { hasAnyConfiguredProvider } from "./modelRouter.js";
import { isOllamaAvailable } from "./providers/ollama.js";
import { hasAnySearchProviderConfigured } from "./search/searchRouter.js";
import { getCapabilityRegistry } from "./capabilityRegistry.js";

const originalEnv = { ...process.env };

describe("capabilityRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.SEARXNG_BASE_URL;
    (hasAnyConfiguredProvider as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isOllamaAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (hasAnySearchProviderConfigured as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("returns exactly one entry per required capability id, no duplicates", () => {
    const registry = getCapabilityRegistry();
    const ids = registry.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of [
      "TEXT_GENERATION",
      "CURRENT_DATE",
      "CURRENT_TIME",
      "TIMEZONE",
      "WEATHER",
      "WEB_SEARCH",
      "CURRENT_INFORMATION",
      "IMAGE_GENERATION",
      "VISION",
      "EMBEDDINGS",
      "RAG",
      "SPEECH_TO_TEXT",
      "TEXT_TO_SPEECH",
      "COMPUTER_CONTROL",
    ]) {
      expect(ids).toContain(required);
    }
  });

  it("never includes a raw secret value anywhere in the output", () => {
    process.env.GEMINI_API_KEY = "AIzaSyTHIS_IS_A_FAKE_TEST_KEY_VALUE";
    process.env.TAVILY_API_KEY = "tvly-THIS_IS_A_FAKE_TEST_KEY_VALUE";
    const registry = getCapabilityRegistry();
    const serialized = JSON.stringify(registry);
    expect(serialized).not.toContain("AIzaSyTHIS_IS_A_FAKE_TEST_KEY_VALUE");
    expect(serialized).not.toContain("tvly-THIS_IS_A_FAKE_TEST_KEY_VALUE");
  });

  it("weather, date, time, timezone, embeddings, and RAG are always available — no key needed", () => {
    const registry = getCapabilityRegistry();
    for (const id of ["CURRENT_DATE", "CURRENT_TIME", "TIMEZONE", "WEATHER", "EMBEDDINGS", "RAG"] as const) {
      const entry = registry.find((c) => c.id === id)!;
      expect(entry.available).toBe(true);
      expect(entry.requiresKey).toBe(false);
      expect(entry.free).toBe(true);
    }
  });

  it("reports WEB_SEARCH and CURRENT_INFORMATION as unavailable when no search provider is configured", () => {
    const registry = getCapabilityRegistry();
    expect(registry.find((c) => c.id === "WEB_SEARCH")!.available).toBe(false);
    expect(registry.find((c) => c.id === "CURRENT_INFORMATION")!.available).toBe(false);
  });

  it("reports WEB_SEARCH available once a search provider is configured", () => {
    (hasAnySearchProviderConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    process.env.TAVILY_API_KEY = "set";
    const registry = getCapabilityRegistry();
    expect(registry.find((c) => c.id === "WEB_SEARCH")!.available).toBe(true);
    expect(registry.find((c) => c.id === "WEB_SEARCH")!.provider).toBe("tavily");
  });

  it("reports IMAGE_GENERATION as configured-but-unavailable when a Gemini key exists (the real production state)", () => {
    process.env.GEMINI_API_KEY = "set";
    const registry = getCapabilityRegistry();
    const image = registry.find((c) => c.id === "IMAGE_GENERATION")!;
    expect(image.configured).toBe(true);
    expect(image.available).toBe(false);
    expect(image.detail).toMatch(/zero-quota/i);
  });

  it("reports VISION and COMPUTER_CONTROL as not implemented", () => {
    const registry = getCapabilityRegistry();
    expect(registry.find((c) => c.id === "VISION")!.implemented).toBe(false);
    expect(registry.find((c) => c.id === "COMPUTER_CONTROL")!.implemented).toBe(false);
  });
});
