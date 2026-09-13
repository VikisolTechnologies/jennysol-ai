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
});
