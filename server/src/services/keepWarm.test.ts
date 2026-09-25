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
import { isHealthy, recordFailure, __resetHealthForTests } from "./providerHealth.js";
import { __testing } from "./keepWarm.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  // Deterministic regardless of the machine actually running this test —
  // pickOllamaModel's real pick for "general" depends on which entries fit
  // the active hardware profile.
  process.env.LOCAL_HARDWARE_PROFILE = "m1_16gb";
  (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (getProviderRouteStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    { name: "ollama", inActiveChain: true, configured: true, usable: true },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("keepWarm.enabled", () => {
  it("is enabled when ollama is in the active provider chain", () => {
    expect(__testing.enabled()).toBe(true);
  });

  it("is disabled when ollama isn't in the active chain (e.g. Railway, no local Ollama)", () => {
    (getProviderRouteStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: "ollama", inActiveChain: false, configured: false, usable: false },
    ]);
    expect(__testing.enabled()).toBe(false);
  });

  it("respects an explicit OLLAMA_KEEP_WARM_ENABLED=false override", () => {
    process.env.OLLAMA_KEEP_WARM_ENABLED = "false";
    expect(__testing.enabled()).toBe(false);
  });
});

describe("keepWarm.tick", () => {
  it("sends a minimal request to the real primary local model and logs success", async () => {
    (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await __testing.tick();

    expect(ollamaProvider.streamChatCompletion).toHaveBeenCalledTimes(1);
    const [, , , , opts] = (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.model).toBe("qwen3:8b"); // the real registry pick for "general", not invented
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: "keep_warm", ok: true, model: "qwen3:8b" });
  });

  it("logs a failure distinctly, tagged as keep_warm, when the ping fails", async () => {
    (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await __testing.tick();

    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: "keep_warm", ok: false, error: "ECONNREFUSED" });
  });

  it("does nothing when Ollama isn't in the active chain — no request, no log", async () => {
    (getProviderRouteStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: "ollama", inActiveChain: false, configured: false, usable: false },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await __testing.tick();

    expect(ollamaProvider.streamChatCompletion).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("does nothing when Ollama is in the chain but not currently reachable", async () => {
    (isOllamaAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await __testing.tick();

    expect(ollamaProvider.streamChatCompletion).not.toHaveBeenCalled();
  });

  // Phase 2.5: keep-warm IS the background circuit-breaker probe — its own
  // real results must drive the same breaker real user requests do.
  it("is the background probe that clears an open circuit breaker on a real successful ping", async () => {
    __resetHealthForTests();
    recordFailure("ollama", "auth"); // trips the breaker
    expect(isHealthy("ollama")).toBe(false);
    (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await __testing.tick();

    expect(isHealthy("ollama")).toBe(true);
  });

  it("feeds a real ping failure into the same breaker real user requests use", async () => {
    __resetHealthForTests();
    const err = Object.assign(new Error("nope"), { status: 401 });
    (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await __testing.tick();

    expect(isHealthy("ollama")).toBe(false); // auth-kind failure trips on the first occurrence
  });
});

describe("keepWarm.capabilities (opt-in multi-model warming)", () => {
  it("defaults to exactly today's single-model behavior when unset", () => {
    delete process.env.OLLAMA_KEEP_WARM_CAPABILITIES;
    expect(__testing.capabilities()).toEqual(["general"]);
  });

  it("warms every configured capability's model, in sequence, on one tick", async () => {
    process.env.OLLAMA_KEEP_WARM_CAPABILITIES = "general,coding,reasoning";
    (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await __testing.tick();

    expect(ollamaProvider.streamChatCompletion).toHaveBeenCalledTimes(3);
    const modelsUsed = (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[4].model);
    expect(modelsUsed).toEqual(["qwen3:8b", "qwen2.5-coder:7b", "deepseek-r1:7b"]);
  });

  it("ignores an invalid capability name rather than silently pinging nothing", () => {
    process.env.OLLAMA_KEEP_WARM_CAPABILITIES = "not-a-real-capability";
    expect(__testing.capabilities()).toEqual(["general"]);
  });

  it("a failure warming one capability doesn't stop the rest from being tried", async () => {
    process.env.OLLAMA_KEEP_WARM_CAPABILITIES = "general,coding";
    (ollamaProvider.streamChatCompletion as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await __testing.tick();

    expect(ollamaProvider.streamChatCompletion).toHaveBeenCalledTimes(2);
  });
});
