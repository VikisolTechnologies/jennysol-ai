import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./providers/geminiImage.js", () => ({ generateImage: vi.fn() }));
vi.mock("./providers/falImage.js", () => ({ generateFalImage: vi.fn() }));
vi.mock("./providers/localQwenImage.js", () => ({
  generateLocalQwenImage: vi.fn(),
  isLocalQwenImageConfigured: vi.fn(() => false),
}));
vi.mock("./providers/ollama.js", () => ({
  tryAcquireLocalRunSlot: vi.fn(() => true),
  releaseLocalRunSlot: vi.fn(),
}));

import { generateImage as generateGeminiImage } from "./providers/geminiImage.js";
import { generateFalImage } from "./providers/falImage.js";
import { generateLocalQwenImage, isLocalQwenImageConfigured } from "./providers/localQwenImage.js";
import { tryAcquireLocalRunSlot, releaseLocalRunSlot } from "./providers/ollama.js";
import {
  routeImageGeneration,
  hasAnyConfiguredImageProvider,
  hasWorkingImageProvider,
  getImageProviderRouteStatus,
  AllImageProvidersUnavailableError,
} from "./imageRouter.js";
import { __resetHealthForTests } from "./providerHealth.js";

function errWithStatus(status: number, message = "err"): Error & { status: number } {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const originalEnv = { ...process.env };

describe("routeImageGeneration", () => {
  beforeEach(() => {
    __resetHealthForTests();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.IMAGE_PROVIDER_CHAIN;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.FAL_KEY = "test-fal-key";
    mocked(isLocalQwenImageConfigured).mockReturnValue(false);
    mocked(tryAcquireLocalRunSlot).mockReturnValue(true);
  });

  it("uses Gemini on the happy path when no local worker is configured, and doesn't call that a fallback", async () => {
    mocked(generateGeminiImage).mockResolvedValue({ mimeType: "image/png", data: "abc" });

    const result = await routeImageGeneration("a cat");

    expect(result).toMatchObject({ providerUsed: "gemini", fellBack: false, attempts: [] });
    expect(result.image).toEqual({ mimeType: "image/png", data: "abc" });
    expect(generateFalImage).not.toHaveBeenCalled();
  });

  it("tries the free local Qwen-Image-2.1 worker first when it's configured, holding the shared local-run slot", async () => {
    mocked(isLocalQwenImageConfigured).mockReturnValue(true);
    mocked(generateLocalQwenImage).mockResolvedValue({ mimeType: "image/png", data: "local-bytes" });

    const result = await routeImageGeneration("a cat");

    expect(result).toMatchObject({ providerUsed: "qwen-local", fellBack: false });
    expect(generateGeminiImage).not.toHaveBeenCalled();
    expect(tryAcquireLocalRunSlot).toHaveBeenCalledTimes(1);
    expect(releaseLocalRunSlot).toHaveBeenCalledTimes(1);
  });

  it("releases the local-run slot even when the local worker fails, then falls back to Gemini", async () => {
    mocked(isLocalQwenImageConfigured).mockReturnValue(true);
    mocked(generateLocalQwenImage).mockRejectedValue(errWithStatus(500, "generation failed"));
    mocked(generateGeminiImage).mockResolvedValue({ mimeType: "image/png", data: "gemini-bytes" });

    const result = await routeImageGeneration("a cat");

    expect(result).toMatchObject({ providerUsed: "gemini", fellBack: true });
    expect(releaseLocalRunSlot).toHaveBeenCalledTimes(1);
  });

  it("skips the local worker without calling it when chat already holds the local-run slot", async () => {
    mocked(isLocalQwenImageConfigured).mockReturnValue(true);
    mocked(tryAcquireLocalRunSlot).mockReturnValue(false);
    mocked(generateGeminiImage).mockResolvedValue({ mimeType: "image/png", data: "gemini-bytes" });

    const result = await routeImageGeneration("a cat");

    expect(result.providerUsed).toBe("gemini");
    expect(generateLocalQwenImage).not.toHaveBeenCalled();
    expect(releaseLocalRunSlot).not.toHaveBeenCalled();
  });

  it("never trips the local breaker for busy/at-capacity skips", async () => {
    mocked(isLocalQwenImageConfigured).mockReturnValue(true);
    const busy = Object.assign(new Error("busy"), { code: "at_capacity" });
    mocked(generateLocalQwenImage).mockRejectedValue(busy);
    mocked(generateGeminiImage).mockResolvedValue({ mimeType: "image/png", data: "g" });

    for (let i = 0; i < 5; i++) await routeImageGeneration("a cat");

    expect(getImageProviderRouteStatus().find((s) => s.name === "qwen-local")!.usable).toBe(true);
  });

  it("falls back to Qwen-Image on fal.ai when Gemini fails", async () => {
    mocked(generateGeminiImage).mockRejectedValue(errWithStatus(429, "limit: 0, FreeTier"));
    mocked(generateFalImage).mockResolvedValue({ mimeType: "image/png", data: "qwen-bytes" });

    const result = await routeImageGeneration("a cat");

    expect(result.providerUsed).toBe("qwen-fal");
    expect(result.fellBack).toBe(true);
    expect(generateFalImage).toHaveBeenCalledWith("fal-ai/qwen-image", "a cat");
  });

  it("falls back to Janus-Pro when both Gemini and Qwen-Image on fal.ai fail", async () => {
    mocked(generateGeminiImage).mockRejectedValue(errWithStatus(503, "gemini down"));
    mocked(generateFalImage)
      .mockRejectedValueOnce(errWithStatus(503, "qwen down"))
      .mockResolvedValueOnce({ mimeType: "image/png", data: "janus-bytes" });

    const result = await routeImageGeneration("a cat");

    expect(result.providerUsed).toBe("janus");
    expect(result.attempts.map((a) => a.name)).toEqual(["gemini", "qwen-fal"]);
    expect(generateFalImage).toHaveBeenNthCalledWith(1, "fal-ai/qwen-image", "a cat");
    expect(generateFalImage).toHaveBeenNthCalledWith(2, "fal-ai/janus-pro-7b", "a cat");
  });

  it("throws AllImageProvidersUnavailableError with every attempt's reason when all of them fail", async () => {
    mocked(isLocalQwenImageConfigured).mockReturnValue(true);
    mocked(generateLocalQwenImage).mockRejectedValue(errWithStatus(500, "local failed"));
    mocked(generateGeminiImage).mockRejectedValue(errWithStatus(503, "gemini down"));
    mocked(generateFalImage).mockRejectedValue(errWithStatus(503, "fal down"));

    const err = await routeImageGeneration("a cat").catch((e) => e);

    expect(err).toBeInstanceOf(AllImageProvidersUnavailableError);
    expect((err as AllImageProvidersUnavailableError).attempts.map((a) => a.name)).toEqual([
      "qwen-local",
      "gemini",
      "qwen-fal",
      "janus",
    ]);
  });

  it("skips an unconfigured provider without calling it", async () => {
    delete process.env.FAL_KEY;
    mocked(generateGeminiImage).mockRejectedValue(errWithStatus(503, "gemini down"));

    await expect(routeImageGeneration("a cat")).rejects.toBeInstanceOf(AllImageProvidersUnavailableError);
    expect(generateFalImage).not.toHaveBeenCalled();
  });

  it("respects IMAGE_PROVIDER_CHAIN ordering", async () => {
    process.env.IMAGE_PROVIDER_CHAIN = "qwen-fal,gemini,janus";
    mocked(generateFalImage).mockResolvedValue({ mimeType: "image/png", data: "qwen-bytes" });

    const result = await routeImageGeneration("a cat");

    expect(result.providerUsed).toBe("qwen-fal");
    expect(generateGeminiImage).not.toHaveBeenCalled();
  });

  it("trips the circuit breaker after repeated Gemini failures, then skips it on the next call", async () => {
    mocked(generateGeminiImage).mockRejectedValue(errWithStatus(503, "gemini down"));
    mocked(generateFalImage).mockResolvedValue({ mimeType: "image/png", data: "qwen-bytes" });

    await routeImageGeneration("a");
    await routeImageGeneration("b");
    await routeImageGeneration("c"); // third consecutive failure trips the breaker
    mocked(generateGeminiImage).mockClear();

    const result = await routeImageGeneration("d");
    expect(generateGeminiImage).not.toHaveBeenCalled();
    expect(result.attempts[0]).toMatchObject({ name: "gemini", reason: expect.stringContaining("cooldown") });
  });

  it("hasAnyConfiguredImageProvider reflects live configuration", () => {
    expect(hasAnyConfiguredImageProvider()).toBe(true);
    delete process.env.GEMINI_API_KEY;
    delete process.env.FAL_KEY;
    expect(hasAnyConfiguredImageProvider()).toBe(false);
    mocked(isLocalQwenImageConfigured).mockReturnValue(true);
    expect(hasAnyConfiguredImageProvider()).toBe(true);
  });

  it("hasWorkingImageProvider ignores quota-blocked Gemini on its own", () => {
    delete process.env.FAL_KEY;
    expect(hasWorkingImageProvider()).toBe(false);
    mocked(isLocalQwenImageConfigured).mockReturnValue(true);
    expect(hasWorkingImageProvider()).toBe(true);
    mocked(isLocalQwenImageConfigured).mockReturnValue(false);
    process.env.FAL_KEY = "k";
    expect(hasWorkingImageProvider()).toBe(true);
  });

  it("getImageProviderRouteStatus reports every registry entry with live configured/usable state", () => {
    const status = getImageProviderRouteStatus();
    expect(status.map((s) => s.name)).toEqual(["qwen-local", "gemini", "qwen-fal", "janus"]);
    expect(status.every((s) => s.inActiveChain)).toBe(true);
    expect(status.find((s) => s.name === "qwen-local")).toMatchObject({ configured: false, usable: false });
    expect(status.find((s) => s.name === "gemini")).toMatchObject({ configured: true, usable: true });
  });
});
