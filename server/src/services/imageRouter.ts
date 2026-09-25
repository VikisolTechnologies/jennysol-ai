import type { GeneratedImage } from "./imageProviderTypes.js";
import { generateImage as generateGeminiImage } from "./providers/geminiImage.js";
import { generateFalImage } from "./providers/falImage.js";
import { generateLocalImage, isLocalImageConfigured } from "./providers/localImage.js";
import { tryAcquireLocalRunSlot, releaseLocalRunSlot } from "./providers/ollama.js";
import { isHealthy, recordSuccess, recordFailure } from "./providerHealth.js";
import { classifyError, affectsProviderHealth } from "./retryClassifier.js";

// Same ordered-fallback-chain shape as modelRouter.ts's chat REGISTRY, kept
// as a separate registry (not merged into it) because image generation has
// no capability classification, no streaming, and no hedging — reusing that
// machinery here would drag along chat-only concepts that don't apply.
// health keys are prefixed "image:" so a chat-provider failure (e.g.
// "gemini" going unhealthy for text) never trips the image breaker for the
// same-named provider, and vice versa — they hit different endpoints/quotas
// entirely despite sharing a provider name.
interface ImageProviderEntry {
  name: string;
  healthKey: string;
  generate: (prompt: string) => Promise<GeneratedImage>;
  configured: () => boolean;
}

// fal's model catalog/slugs can change — these are the ids fal.ai lists for
// Qwen-Image and DeepSeek's Janus-Pro-7B as of this integration. Override via
// env if fal renames/reorganizes either one.
const QWEN_IMAGE_MODEL = process.env.FAL_QWEN_IMAGE_MODEL || "fal-ai/qwen-image";
const JANUS_PRO_MODEL = process.env.FAL_JANUS_PRO_MODEL || "fal-ai/janus-pro-7b";

// The Mac's image worker and Ollama chat share one physical GPU/memory
// budget, so a local image holds the same single local-run slot Ollama chat
// uses. While it's held, chat skips Ollama for the cloud chain instead of
// reloading a 5GB model mid-generation (and keep-warm pings skip too).
async function generateWithLocalSlot(prompt: string): Promise<GeneratedImage> {
  if (!tryAcquireLocalRunSlot()) {
    const err = new Error("local inference slot is in use") as Error & { code?: string };
    err.code = "at_capacity";
    throw err;
  }
  try {
    return await generateLocalImage(prompt);
  } finally {
    releaseLocalRunSlot();
  }
}

const REGISTRY: ImageProviderEntry[] = [
  {
    name: "local",
    healthKey: "image:local",
    generate: generateWithLocalSlot,
    configured: isLocalImageConfigured,
  },
  {
    name: "gemini",
    healthKey: "image:gemini",
    generate: generateGeminiImage,
    configured: () => !!process.env.GEMINI_API_KEY,
  },
  {
    name: "qwen-fal",
    healthKey: "image:qwen-fal",
    generate: (prompt) => generateFalImage(QWEN_IMAGE_MODEL, prompt),
    configured: () => !!process.env.FAL_KEY,
  },
  {
    name: "janus",
    healthKey: "image:janus",
    generate: (prompt) => generateFalImage(JANUS_PRO_MODEL, prompt),
    configured: () => !!process.env.FAL_KEY,
  },
];

// Free first: the Mac's local worker (localImageWorker.ts), then Gemini,
// then the paid fal.ai models. An entry that isn't configured is skipped
// instantly, so listing local first costs nothing without a worker.
function resolveChain(): ImageProviderEntry[] {
  const names = (process.env.IMAGE_PROVIDER_CHAIN || "local,gemini,qwen-fal,janus")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const chain: ImageProviderEntry[] = [];
  for (const name of names) {
    const entry = REGISTRY.find((e) => e.name === name);
    if (entry && !seen.has(name)) {
      chain.push(entry);
      seen.add(name);
    }
  }
  return chain.length > 0 ? chain : [REGISTRY[0]];
}

export function hasAnyConfiguredImageProvider(): boolean {
  return resolveChain().some((e) => e.configured());
}

// Whether the chain has a provider that can actually produce an image today.
// Gemini alone doesn't count: the production key's image quota is zero
// (capabilityRegistry.ts's IMAGE_GENERATION), so "configured" isn't "works".
export function hasWorkingImageProvider(): boolean {
  return resolveChain().some((e) => e.name !== "gemini" && e.configured());
}

export interface ImageProviderRouteStatus {
  name: string;
  inActiveChain: boolean;
  configured: boolean;
  usable: boolean;
}

export function getImageProviderRouteStatus(): ImageProviderRouteStatus[] {
  const chain = resolveChain();
  const chainNames = new Set(chain.map((e) => e.name));
  return REGISTRY.map((e) => ({
    name: e.name,
    inActiveChain: chainNames.has(e.name),
    configured: e.configured(),
    usable: e.configured() && isHealthy(e.healthKey),
  }));
}

export class AllImageProvidersUnavailableError extends Error {
  constructor(public attempts: { name: string; reason: string }[]) {
    super("All configured image providers are currently unavailable");
    this.name = "AllImageProvidersUnavailableError";
  }
}

export interface ImageRouteResult {
  providerUsed: string;
  image: GeneratedImage;
  fellBack: boolean;
  attempts: { name: string; reason: string }[];
}

export async function routeImageGeneration(prompt: string): Promise<ImageRouteResult> {
  const chain = resolveChain();
  const attempts: { name: string; reason: string }[] = [];

  for (const entry of chain) {
    if (!entry.configured()) continue;
    if (!isHealthy(entry.healthKey)) {
      attempts.push({ name: entry.name, reason: "in cooldown after recent failures" });
      continue;
    }
    try {
      const image = await entry.generate(prompt);
      recordSuccess(entry.healthKey);
      return { providerUsed: entry.name, image, fellBack: attempts.length > 0, attempts };
    } catch (err) {
      const kind = classifyError(err);
      if (affectsProviderHealth(kind)) recordFailure(entry.healthKey, kind);
      const detail = err instanceof Error ? err.message : String(err);
      attempts.push({ name: entry.name, reason: detail });
    }
  }

  throw new AllImageProvidersUnavailableError(attempts);
}
