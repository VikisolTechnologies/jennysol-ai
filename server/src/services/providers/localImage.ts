import type { GeneratedImage } from "../imageProviderTypes.js";

// Client for localImageWorker.ts, which draws images on the Mac —
// free per image, same idea as Ollama for chat. From Railway this goes over
// the tailnet via railtail, exactly like OLLAMA_BASE_URL does.
export function isLocalImageConfigured(): boolean {
  return !!process.env.LOCAL_IMAGE_BASE_URL && !!process.env.LOCAL_IMAGE_WORKER_TOKEN;
}

// Slightly above the worker's own sd-cli timeout so the worker gets to
// report its failure instead of us abandoning a request it's still running.
function timeoutMs(): number {
  return Number(process.env.LOCAL_IMAGE_REQUEST_TIMEOUT_MS) || 11 * 60 * 1000;
}

export async function generateLocalImage(prompt: string): Promise<GeneratedImage> {
  const res = await fetch(`${process.env.LOCAL_IMAGE_BASE_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LOCAL_IMAGE_WORKER_TOKEN}`,
    },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(timeoutMs()),
  });

  if (res.status === 409) {
    // Worker is already drawing another image — says nothing about its
    // health, so classifyError treats it like Ollama's own concurrency gate.
    const err = new Error("local image worker is busy with another image") as Error & { code?: string };
    err.code = "at_capacity";
    throw err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`local image worker failed (${res.status}): ${detail}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const body = (await res.json()) as { mimeType?: string; data?: string };
  if (!body.data) throw new Error("local image worker returned no image data");
  return { mimeType: body.mimeType || "image/png", data: body.data };
}
