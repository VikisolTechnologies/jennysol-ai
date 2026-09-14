// JENNYSOL-VISION-AND-IMAGERY.md Part A.3: the real vision capability, routed by task type.
// Deliberately a new, small, separate function rather than an extension of modelRouter.ts's
// routeChatCompletion()/streamOpenAiCompatible() — those already carry real complexity (hedging,
// tool-calling, cancellation) built for a genuinely different shape (streaming text-only chat across
// multiple competing providers). There is exactly one vision-capable provider today (local Ollama, no
// cloud vision fallback wired up anywhere in this codebase) — nothing to hedge against yet, so adding
// hedging machinery here would be complexity with no real behavior behind it. Same treatment as every
// other provider where it actually applies: the shared local-concurrency gate (ollama.ts, not a
// second independent counter — see that file's own comment on why), the shared circuit breaker
// (providerHealth.ts), and real metrics (requestMetrics.ts).
import { isOllamaAvailable, tryAcquireLocalRunSlot, releaseLocalRunSlot } from "./ollama.js";
import { isHealthy, recordSuccess, recordFailure } from "../providerHealth.js";
import { classifyError } from "../retryClassifier.js";
import { recordRequest } from "../requestMetrics.js";
import { getHardwareProfile } from "../models/hardwareProfile.js";

const BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
// JENNY_VISION_MODEL_EVALUATION.md's real, measured recommendation — 100% structured-JSON
// reliability, fits this Mac's real memory budget (3.57GB resident, verified via /api/ps),
// Apache 2.0. Overridable for the future GPU server profile without a code change.
const DEFAULT_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "qwen3-vl:4b";
const PROVIDER_NAME = "ollama-vision";

export class VisionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionUnavailableError";
  }
}

export interface DescribeImageResult {
  content: string;
  model: string;
  totalMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

// Real, direct call to Ollama's native /api/chat (not the OpenAI-compatible endpoint
// streamOpenAiCompatible uses for text) — this is the endpoint JENNY_VISION_MODEL_EVALUATION.md's
// real evaluation actually exercised; images are plain base64 strings on the message, no data-URI
// prefix, confirmed against Ollama's own API docs during that evaluation.
export async function describeImage(
  prompt: string,
  imagesBase64: string[],
  taskCapability: "vision" = "vision"
): Promise<DescribeImageResult> {
  if (!isOllamaAvailable()) {
    throw new VisionUnavailableError("Ollama is not reachable — vision capability requires the local model server");
  }
  if (!isHealthy(PROVIDER_NAME)) {
    throw new VisionUnavailableError("ollama-vision is in cooldown after recent failures");
  }
  if (!tryAcquireLocalRunSlot()) {
    const err = new VisionUnavailableError(
      `ollama is at its configured concurrency limit (${getHardwareProfile().maxConcurrentLocalRuns} local run(s)) — vision shares the same local-inference slot as chat`
    );
    recordFailure(PROVIDER_NAME, "at_capacity");
    throw err;
  }

  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_VISION_MODEL,
        messages: [{ role: "user", content: prompt, images: imagesBase64 }],
        stream: false,
      }),
    });
    const totalMs = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama vision request failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      error?: string;
      message?: { content?: string };
      model?: string;
      done?: boolean;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    // A real Ollama server bug this session's own evaluation found (JENNY_VISION_MODEL_EVALUATION.md
    // — a genuine GPU OOM manifesting as a 200 response with empty/zero-valued fields, not a normal
    // error) — treated as a real failure here rather than silently returning empty content.
    if (data.error) throw new Error(`Ollama reported an error: ${data.error}`);
    const content = data.message?.content;
    if (!content) {
      throw new Error(
        `Ollama returned no content (model=${data.model || "<empty>"}, done=${data.done}) — likely a local resource failure (see JENNY_VISION_MODEL_EVALUATION.md's real GPU-OOM finding for this exact shape)`
      );
    }
    recordSuccess(PROVIDER_NAME);
    recordRequest({
      timestamp: start,
      provider: PROVIDER_NAME,
      model: DEFAULT_VISION_MODEL,
      taskCapability,
      fellBack: false,
      firstTokenMs: null, // non-streaming call — no meaningful first-token distinct from total
      totalMs,
      promptTokens: data.prompt_eval_count ?? null,
      completionTokens: data.eval_count ?? null,
      tokensEstimated: false,
      wasWarm: null,
      outcome: "success",
    });
    return {
      content,
      model: DEFAULT_VISION_MODEL,
      totalMs,
      promptTokens: data.prompt_eval_count ?? null,
      completionTokens: data.eval_count ?? null,
    };
  } catch (err) {
    const kind = classifyError(err);
    recordFailure(PROVIDER_NAME, kind);
    recordRequest({
      timestamp: start,
      provider: PROVIDER_NAME,
      model: DEFAULT_VISION_MODEL,
      taskCapability,
      fellBack: false,
      firstTokenMs: null,
      totalMs: Date.now() - start,
      promptTokens: null,
      completionTokens: null,
      tokensEstimated: null,
      wasWarm: null,
      outcome: "error",
      errorKind: kind,
    });
    throw err;
  } finally {
    releaseLocalRunSlot();
  }
}
