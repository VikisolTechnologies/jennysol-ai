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

describe("wasModelWarm", () => {
  it("reports cold for a model never used, then warm immediately after a real request", async () => {
    const encoder = new TextEncoder();
    const chatStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        url.includes("/api/tags")
          ? Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }))
          : Promise.resolve(new Response(chatStream, { status: 200 }))
      )
    );

    const { ollamaProvider, wasModelWarm } = await import("./ollama.js");

    expect(wasModelWarm("qwen3:8b")).toBe(false);

    await ollamaProvider.streamChatCompletion("sys", [], () => {}, undefined, { model: "qwen3:8b" });

    expect(wasModelWarm("qwen3:8b")).toBe(true);
    // A different, never-requested model stays cold — this isn't a global flag.
    expect(wasModelWarm("qwen3:4b")).toBe(false);
  });
});
