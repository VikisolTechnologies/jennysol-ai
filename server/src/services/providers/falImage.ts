import type { GeneratedImage } from "../imageProviderTypes.js";

// Shared REST client for any fal.ai text-to-image model (Qwen-Image,
// Janus-Pro, and anything else added to the fal-hosted fallback chain later)
// — same "one file, same shape" reasoning as openaiCompatible.ts for chat
// providers. fal's sync endpoint (fal.run/<model-id>, as opposed to the
// queue.fal.run polling variant) blocks until the image is ready, which
// matches how routes/image.ts already awaits geminiImage.ts's generateImage
// — no queueing/polling needed on top of an already-synchronous route.
const FAL_BASE_URL = "https://fal.run";

interface FalImageResponse {
  images?: { url: string; content_type?: string }[];
}

export async function generateFalImage(modelId: string, prompt: string): Promise<GeneratedImage> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    const err = new Error("FAL_KEY is not configured") as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  const res = await fetch(`${FAL_BASE_URL}/${modelId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${apiKey}` },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`fal.ai request to ${modelId} failed (${res.status}): ${detail}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }

  const body = (await res.json()) as FalImageResponse;
  const image = body.images?.[0];
  if (!image?.url) {
    throw new Error(`fal.ai (${modelId}) didn't return an image for that prompt. Try rephrasing it.`);
  }

  // fal returns a CDN URL, not inline bytes — routes/image.ts's contract
  // (and the client, which never changed) is base64 data, same shape Gemini
  // already returns, so the bytes are fetched and re-encoded here rather
  // than pushing a URL-vs-base64 branch out to the frontend.
  const imageRes = await fetch(image.url);
  if (!imageRes.ok) {
    const err = new Error(`Failed to download the generated image from fal.ai (${imageRes.status})`) as Error & {
      status?: number;
    };
    err.status = imageRes.status;
    throw err;
  }
  const buffer = Buffer.from(await imageRes.arrayBuffer());

  return {
    mimeType: image.content_type || imageRes.headers.get("content-type") || "image/png",
    data: buffer.toString("base64"),
  };
}
