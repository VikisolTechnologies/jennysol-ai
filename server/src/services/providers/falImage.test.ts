import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { generateFalImage } from "./falImage.js";

const originalEnv = { ...process.env };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function imageBytesResponse(bytes: Uint8Array, contentType = "image/png"): Response {
  return new Response(bytes, { status: 200, headers: { "Content-Type": contentType } });
}

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.FAL_KEY = "test-fal-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateFalImage", () => {
  it("throws (with status 401) when FAL_KEY isn't configured, without making a request", async () => {
    delete process.env.FAL_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateFalImage("fal-ai/qwen-image", "a cat")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the prompt to fal.run/<modelId> with a Key auth header, then fetches and base64-encodes the returned image", async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ images: [{ url: "https://fal.media/files/abc.png", content_type: "image/png" }] }))
      .mockResolvedValueOnce(imageBytesResponse(imageBytes));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateFalImage("fal-ai/qwen-image", "a cat riding a bike");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://fal.run/fal-ai/qwen-image",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Key test-fal-key" }),
      })
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ prompt: "a cat riding a bike" });

    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://fal.media/files/abc.png");
    expect(result.mimeType).toBe("image/png");
    expect(Buffer.from(result.data, "base64")).toEqual(Buffer.from(imageBytes));
  });

  it("throws with the response status when the fal.ai request itself fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("server error", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateFalImage("fal-ai/qwen-image", "a cat")).rejects.toMatchObject({ status: 503 });
  });

  it("throws a clear error when fal.ai returns no image (e.g. a content-policy block)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ images: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateFalImage("fal-ai/janus-pro-7b", "a cat")).rejects.toThrow(/didn't return an image/i);
  });

  it("throws with the download response status when the image URL itself fails to fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ images: [{ url: "https://fal.media/files/gone.png" }] }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateFalImage("fal-ai/qwen-image", "a cat")).rejects.toMatchObject({ status: 404 });
  });
});
