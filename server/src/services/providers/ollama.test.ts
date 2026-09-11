import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// ollama.ts fires a real fetch at module load (the "initial check" the rest
// of this file is about) and keeps its reachability state in module-level
// variables — vi.resetModules() + a fresh dynamic import per test is what
// gives each test its own clean instance of that state instead of leaking
// across tests via Node's module cache.
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureOllamaChecked", () => {
  it("awaits the real module-load probe instead of returning a stale/default false", async () => {
    // A deliberately-controlled, not-yet-resolved fetch — this is what
    // makes the pre-fix race (isOllamaAvailable() reads `available` before
    // the module-load probe has settled) reproducible deterministically,
    // instead of depending on real timing the way the original live bug
    // (`npm run models -- health` reporting false against a genuinely
    // reachable Ollama) did.
    let resolveFetch!: (res: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));

    const { ensureOllamaChecked, isOllamaAvailable } = await import("./ollama.js");

    // The module-load probe is still in flight — isOllamaAvailable()'s
    // non-blocking snapshot correctly (if unhelpfully, for a one-shot
    // caller) reports false here.
    expect(isOllamaAvailable()).toBe(false);

    const resultPromise = ensureOllamaChecked();
    resolveFetch(new Response(null, { status: 200 }));
    const result = await resultPromise;

    expect(result).toBe(true);
    expect(isOllamaAvailable()).toBe(true);
  });

  it("reports false when the probe genuinely fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );

    const { ensureOllamaChecked } = await import("./ollama.js");

    expect(await ensureOllamaChecked()).toBe(false);
  });

  it("never issues a second fetch beyond the one module-load probe", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { ensureOllamaChecked } = await import("./ollama.js");
    await ensureOllamaChecked();
    await ensureOllamaChecked();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
