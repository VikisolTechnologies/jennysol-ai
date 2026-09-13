import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./providers/ollama.js", () => ({
  ollamaProvider: { streamChatCompletion: vi.fn() },
  isOllamaAvailable: vi.fn(() => true),
}));
vi.mock("./modelRouter.js", () => ({
  getProviderRouteStatus: vi.fn(() => [{ name: "ollama", inActiveChain: true, configured: true, usable: true }]),
}));

import { ollamaProvider, isOllamaAvailable } from "./providers/ollama.js";
import { getProviderRouteStatus } from "./modelRouter.js";
import { maybeShadowToOllama, __testing } from "./shadowTraffic.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  process.env.LOCAL_HARDWARE_PROFILE = "m1_16gb";
  (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (getProviderRouteStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    { name: "ollama", inActiveChain: true, configured: true, usable: true },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Async flush helper — maybeShadowToOllama is deliberately fire-and-forget
// (never awaited by its caller, see chatRunner.ts), so tests need a real
// microtask/timer flush to observe its result.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("shadowTraffic sampling/gating", () => {
  it("defaults the sample rate low (5%) and honors a valid override", () => {
    expect(__testing.sampleRate()).toBe(0.05);
    process.env.SHADOW_TRAFFIC_SAMPLE_RATE = "0.2";
    expect(__testing.sampleRate()).toBe(0.2);
  });

  it("falls back to the low default on an invalid sample rate rather than shadowing everything", () => {
    process.env.SHADOW_TRAFFIC_SAMPLE_RATE = "not-a-number";
    expect(__testing.sampleRate()).toBe(0.05);
    process.env.SHADOW_TRAFFIC_SAMPLE_RATE = "5"; // out of [0,1] range
    expect(__testing.sampleRate()).toBe(0.05);
  });

  it("is enabled only when ollama is in the active chain", () => {
    expect(__testing.enabled()).toBe(true);
    (getProviderRouteStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: "ollama", inActiveChain: false, configured: false, usable: false },
    ]);
    expect(__testing.enabled()).toBe(false);
  });

  it("respects an explicit SHADOW_TRAFFIC_ENABLED=false override", () => {
    process.env.SHADOW_TRAFFIC_ENABLED = "false";
    expect(__testing.enabled()).toBe(false);
  });
});

describe("maybeShadowToOllama", () => {
  it("never shadows a request that Ollama itself already served — that would be redundant", async () => {
    process.env.SHADOW_TRAFFIC_SAMPLE_RATE = "1"; // always sample, to isolate this specific guard
    maybeShadowToOllama("sys", [], "general", { provider: "ollama", totalMs: 100 });
    await flush();
    expect(ollamaProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("skips entirely when Ollama isn't in the active chain, regardless of sample rate", async () => {
    process.env.SHADOW_TRAFFIC_SAMPLE_RATE = "1";
    (getProviderRouteStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: "ollama", inActiveChain: false, configured: false, usable: false },
    ]);
    maybeShadowToOllama("sys", [], "general", { provider: "gemini", totalMs: 100 });
    await flush();
    expect(ollamaProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("skips when Ollama isn't currently reachable", async () => {
    process.env.SHADOW_TRAFFIC_SAMPLE_RATE = "1";
    (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    maybeShadowToOllama("sys", [], "general", { provider: "gemini", totalMs: 100 });
    await flush();
    expect(ollamaProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("respects the sample rate — never fires at rate 0", async () => {
    process.env.SHADOW_TRAFFIC_SAMPLE_RATE = "0";
    maybeShadowToOllama("sys", [], "general", { provider: "gemini", totalMs: 100 });
    await flush();
    expect(ollamaProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("fires a real shadow request (discarding its output) and logs success against the served comparison", async () => {
    process.env.SHADOW_TRAFFIC_SAMPLE_RATE = "1"; // always sample, deterministic for this test
    (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    maybeShadowToOllama("sys", [{ role: "user", content: "hi" }], "general", { provider: "gemini", totalMs: 850 });
    await flush();

    expect(ollamaProvider.streamChatCompletion).toHaveBeenCalledTimes(1);
    const [, , onDelta] = (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mock.calls[0];
    onDelta("some output"); // the shadow's own output — must be silently discarded, not asserted anywhere
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: "shadow_traffic", shadowOk: true, servedProvider: "gemini", servedTotalMs: 850 });
  });

  it("logs a shadow failure distinctly without throwing or affecting the caller", async () => {
    process.env.SHADOW_TRAFFIC_SAMPLE_RATE = "1";
    (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(() => maybeShadowToOllama("sys", [], "general", { provider: "gemini", totalMs: 500 })).not.toThrow();
    await flush();

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: "shadow_traffic", shadowOk: false, shadowErrorKind: "timeout" });
  });
});
