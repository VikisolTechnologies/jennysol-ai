import "dotenv/config";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { missingLocalImageFiles, resolveLocalImageConfig, runLocalImage } from "./services/localImage/sdCli.js";

// Runs on the Mac next to Ollama, as its own LaunchAgent
// (deploy/macos/in.vikisol.jennysol-image-worker.plist). The main API
// (Railway today) reaches it the same way it reaches Ollama, over the
// tailnet — see providers/localQwenImage.ts for the client side.
const HOST = process.env.LOCAL_IMAGE_WORKER_HOST || "127.0.0.1";
const PORT = Number(process.env.LOCAL_IMAGE_WORKER_PORT) || 8789;
const TOKEN = process.env.LOCAL_IMAGE_WORKER_TOKEN || "";
const TIMEOUT_MS = Number(process.env.LOCAL_IMAGE_GENERATION_TIMEOUT_MS) || 10 * 60 * 1000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

// The tailnet ACL is unverified (LOCAL-INFRA.md), so network reachability
// alone must never be enough to spend ~10 minutes of this Mac's GPU.
if (TOKEN.length < 32) {
  console.error("[image-worker] LOCAL_IMAGE_WORKER_TOKEN must be set to a random string of at least 32 characters.");
  process.exit(1);
}

function authorized(header: string | undefined): boolean {
  const given = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// The image model plus its text encoder peak at ~4.4-5.4GB (measured), on a
// Mac whose whole budget is 10GB — a resident 5GB Ollama chat model at the
// same time means heavy swapping or a Metal out-of-memory failure. Best-effort: if Ollama is unreachable
// there's nothing resident to evict anyway.
async function unloadOllamaModels(): Promise<void> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const { models = [] } = (await res.json()) as { models?: { name: string }[] };
    await Promise.all(
      models.map((m) =>
        fetch(`${OLLAMA_BASE_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: m.name, keep_alive: 0 }),
          signal: AbortSignal.timeout(10_000),
        }).catch(() => undefined)
      )
    );
  } catch {
    // unreachable Ollama — nothing to unload
  }
}

const requestSchema = z.object({ prompt: z.string().trim().min(1).max(2000) });

let busy = false;

const app = express();
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req, res) => {
  const missing = missingLocalImageFiles(resolveLocalImageConfig());
  res.json({ ok: missing.length === 0, busy, missingFiles: missing.length });
});

app.post("/generate", async (req, res) => {
  if (!authorized(req.header("authorization"))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "prompt must be 1-2000 characters" });
    return;
  }
  // One image at a time: two concurrent runs would need ~20GB on a 16GB Mac.
  if (busy) {
    res.status(409).json({ error: "busy" });
    return;
  }
  const missing = missingLocalImageFiles(resolveLocalImageConfig());
  if (missing.length > 0) {
    res.status(503).json({ error: "model files missing on this machine" });
    return;
  }

  busy = true;
  const startedAt = Date.now();
  try {
    await unloadOllamaModels();
    const png = await runLocalImage(parsed.data.prompt, TIMEOUT_MS);
    const totalMs = Date.now() - startedAt;
    console.log(JSON.stringify({ event: "local_image", ok: true, totalMs, bytes: png.length }));
    res.json({ mimeType: "image/png", data: png.toString("base64"), totalMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "local_image", ok: false, totalMs: Date.now() - startedAt, error: message }));
    res.status(500).json({ error: "generation failed" });
  } finally {
    busy = false;
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[image-worker] listening on http://${HOST}:${PORT}`);
});
