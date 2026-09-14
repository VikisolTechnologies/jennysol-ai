import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// Same convention as ollama.test.ts: ollama.ts fires a real fetch at module load, so each test needs
// its own clean module instance via vi.resetModules() + a fresh dynamic import, with fetch stubbed
// before that import ever happens.
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function mockOllamaOk(content: string) {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/api/tags")) return new Response(null, { status: 200 });
    if (url.endsWith("/api/chat")) {
      return new Response(
        JSON.stringify({ model: "qwen3-vl:4b", message: { role: "assistant", content }, done: true, prompt_eval_count: 900, eval_count: 40 }),
        { status: 200 }
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

describe("describeImage — JENNYSOL-VISION-AND-IMAGERY.md Part A.3", () => {
  it("sends the real image and always uses the dedicated vision model, never a general-purpose one", async () => {
    const fetchMock = mockOllamaOk('{"defects":[]}');
    vi.stubGlobal("fetch", fetchMock);

    const { describeImage } = await import("./ollamaVision.js");
    const result = await describeImage("describe this", ["ZmFrZS1pbWFnZS1kYXRh"], "vision");

    expect(result.content).toBe('{"defects":[]}');
    expect(result.model).toBe("qwen3-vl:4b");

    const chatCall = fetchMock.mock.calls.find(([url]) => (url as string).endsWith("/api/chat"))!;
    const body = JSON.parse(chatCall[1].body as string);
    // The real assertion this stage's own brief asks for: an image task reaches the real vision
    // model and never a text-only general model, regardless of what else is registered.
    expect(body.model).toBe("qwen3-vl:4b");
    expect(body.model).not.toBe("qwen3:8b");
    expect(body.messages[0].images).toEqual(["ZmFrZS1pbWFnZS1kYXRh"]);
    expect(body.stream).toBe(false);
  });

  it("throws VisionUnavailableError when Ollama isn't reachable, rather than a raw fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const { describeImage, VisionUnavailableError } = await import("./ollamaVision.js");
    await expect(describeImage("x", ["img"])).rejects.toThrow(VisionUnavailableError);
  });

  // A real Ollama server bug this session's own evaluation found (JENNY_VISION_MODEL_EVALUATION.md):
  // a genuine GPU OOM can manifest as a 200 response with empty/zero-valued fields, not a normal
  // {error: "..."} shape. This must be treated as a real failure, never silently returned as success
  // with empty content.
  it("treats an empty-content 200 response as a real failure, not a silent empty success", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) return new Response(null, { status: 200 });
      return new Response(JSON.stringify({ model: "", message: { role: "", content: "" }, done: false }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { describeImage } = await import("./ollamaVision.js");
    await expect(describeImage("x", ["img"])).rejects.toThrow(/no content/i);
  });

  it("shares the same local-concurrency gate as text chat — a vision call is refused while a text call holds the slot", async () => {
    vi.stubGlobal("fetch", mockOllamaOk("{}"));
    const { tryAcquireLocalRunSlot, releaseLocalRunSlot } = await import("./ollama.js");
    const { describeImage, VisionUnavailableError } = await import("./ollamaVision.js");

    // Simulates a real text chat request already occupying this Mac's one local-inference slot
    // (HardwareProfile.maxConcurrentLocalRuns) — the exact shared resource whose real violation
    // produced the GPU OOM this session's own vision evaluation found.
    const acquired = tryAcquireLocalRunSlot();
    expect(acquired).toBe(true);
    try {
      await expect(describeImage("x", ["img"])).rejects.toThrow(VisionUnavailableError);
    } finally {
      releaseLocalRunSlot();
    }

    // Once released, a vision call succeeds normally — proving the refusal above was really about
    // the shared slot, not some other failure.
    await expect(describeImage("x", ["img"])).resolves.toBeTruthy();
  });
});
