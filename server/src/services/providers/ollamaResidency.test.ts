import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../modelRouter.js", () => ({
  getProviderRouteStatus: vi.fn(() => [{ name: "ollama", inActiveChain: true, configured: true, usable: true }]),
}));

import { getProviderRouteStatus } from "../modelRouter.js";
import { db } from "../../db/index.js";

function psResponse(models: { name: string; expires_at: string; size_vram?: number }[]) {
  return new Response(JSON.stringify({ models }), { status: 200 });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  (getProviderRouteStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    { name: "ollama", inActiveChain: true, configured: true, usable: true },
  ]);
  db.exec("DELETE FROM ollama_evictions");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pollOllamaResidencyOnce", () => {
  it("does not record an eviction the first time a model is ever seen (nothing to compare against yet)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(psResponse([{ name: "qwen3:8b", expires_at: new Date(Date.now() + 60_000).toISOString() }]))
    );
    const { pollOllamaResidencyOnce, getEvictionsToday } = await import("./ollamaResidency.js");
    await pollOllamaResidencyOnce();
    expect(getEvictionsToday()).toBe(0);
  });

  it("records a real eviction when a model disappears before its own reported expiry", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { pollOllamaResidencyOnce, getEvictionsToday } = await import("./ollamaResidency.js");

    // Poll 1: qwen3:8b resident, genuinely not due to expire for another
    // full minute — this is what makes its disappearance next poll a real
    // eviction rather than a normal, expected idle unload.
    fetchMock.mockResolvedValueOnce(
      psResponse([{ name: "qwen3:8b", expires_at: new Date(Date.now() + 60_000).toISOString() }])
    );
    await pollOllamaResidencyOnce();
    expect(getEvictionsToday()).toBe(0);

    // Poll 2: qwen3:8b is gone, replaced by qwen3-vl:4b — exactly the real,
    // measured sequence JENNY_VISION_MODEL_EVALUATION.md's eviction-policy
    // section documents (a vision call evicting the resident chat model).
    fetchMock.mockResolvedValueOnce(
      psResponse([{ name: "qwen3-vl:4b", expires_at: new Date(Date.now() + 60_000).toISOString() }])
    );
    await pollOllamaResidencyOnce();
    expect(getEvictionsToday()).toBe(1);
  });

  it("does not record an eviction when a model disappears after its own reported expiry (a normal idle unload)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { pollOllamaResidencyOnce, getEvictionsToday } = await import("./ollamaResidency.js");

    // Already-expired by the time it's first observed — a real model that
    // simply timed out naturally, not one an eviction cut short.
    fetchMock.mockResolvedValueOnce(
      psResponse([{ name: "qwen3:8b", expires_at: new Date(Date.now() - 1000).toISOString() }])
    );
    await pollOllamaResidencyOnce();

    fetchMock.mockResolvedValueOnce(psResponse([]));
    await pollOllamaResidencyOnce();

    expect(getEvictionsToday()).toBe(0);
  });

  it("does nothing when ollama isn't in the active provider chain", async () => {
    (getProviderRouteStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: "ollama", inActiveChain: false, configured: false, usable: false },
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { pollOllamaResidencyOnce } = await import("./ollamaResidency.js");
    await pollOllamaResidencyOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves prior residency state untouched on a failed poll, rather than treating unreachable as evicted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { pollOllamaResidencyOnce, getEvictionsToday } = await import("./ollamaResidency.js");

    fetchMock.mockResolvedValueOnce(
      psResponse([{ name: "qwen3:8b", expires_at: new Date(Date.now() + 60_000).toISOString() }])
    );
    await pollOllamaResidencyOnce();

    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await pollOllamaResidencyOnce();

    expect(getEvictionsToday()).toBe(0);
  });
});

describe("getResidentModels", () => {
  it("maps ollama's real /api/ps shape to this app's own type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        psResponse([{ name: "qwen3:8b", expires_at: "2026-09-16T12:00:00Z", size_vram: 5295172484 }])
      )
    );
    const { getResidentModels } = await import("./ollamaResidency.js");
    const result = await getResidentModels();
    expect(result).toEqual([{ name: "qwen3:8b", sizeVramBytes: 5295172484, expiresAt: "2026-09-16T12:00:00Z" }]);
  });
});
