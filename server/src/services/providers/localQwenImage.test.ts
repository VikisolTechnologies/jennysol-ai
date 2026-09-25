import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { generateLocalQwenImage, isLocalQwenImageConfigured } from "./localQwenImage.js";
import { classifyError, affectsProviderHealth } from "../retryClassifier.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.LOCAL_IMAGE_BASE_URL = "http://100.64.0.1:8789";
  process.env.LOCAL_IMAGE_WORKER_TOKEN = "t".repeat(40);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localQwenImage", () => {
  it("is configured only when both the worker URL and token are set", () => {
    expect(isLocalQwenImageConfigured()).toBe(true);
    delete process.env.LOCAL_IMAGE_WORKER_TOKEN;
    expect(isLocalQwenImageConfigured()).toBe(false);
  });

  it("posts the prompt with the bearer token and returns the worker's image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ mimeType: "image/png", data: "AAAA", totalMs: 1 }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const image = await generateLocalQwenImage("a cat");

    expect(image).toEqual({ mimeType: "image/png", data: "AAAA" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://100.64.0.1:8789/generate");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${"t".repeat(40)}`);
    expect(JSON.parse(init.body as string)).toEqual({ prompt: "a cat" });
  });

  it("reports a busy worker as at_capacity so it never counts against the worker's health", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"busy"}', { status: 409 })));

    const err = await generateLocalQwenImage("a cat").catch((e) => e);

    expect(classifyError(err)).toBe("at_capacity");
    expect(affectsProviderHealth(classifyError(err))).toBe(false);
  });

  it("reports a rejected token as an auth failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 })));

    const err = await generateLocalQwenImage("a cat").catch((e) => e);

    expect(classifyError(err)).toBe("auth");
  });
});
