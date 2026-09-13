import type { ChatTurn } from "./llmProvider.js";
import { ollamaProvider, isOllamaAvailable } from "./providers/ollama.js";
import { pickOllamaModel, type TaskCapability } from "./models/modelRegistry.js";
import { getProviderRouteStatus } from "./modelRouter.js";
import { classifyError } from "./retryClassifier.js";

// JENNYSOL-LOCAL-CUTOVER.md Phase 5: "the canary and task-class expansion
// need an observation window with real traffic, which cannot be compressed
// into a single run" — this is deliberately ONLY the shadow half. A copy of
// a small share of real requests goes to Ollama, in parallel, with its
// result discarded — never shown to the user, never affecting what they
// actually see. Purely for collecting real latency/error-rate evidence
// about whether Ollama could have served this same request, before ever
// letting it actually decide a real response (that's the canary, a
// separate, later decision).
const DEFAULT_SAMPLE_RATE = 0.05;

function sampleRate(): number {
  const raw = Number(process.env.SHADOW_TRAFFIC_SAMPLE_RATE);
  if (Number.isNaN(raw) || raw < 0 || raw > 1) return DEFAULT_SAMPLE_RATE;
  return raw;
}

function enabled(): boolean {
  if (process.env.SHADOW_TRAFFIC_ENABLED === "false") return false;
  return getProviderRouteStatus().find((p) => p.name === "ollama")?.inActiveChain ?? false;
}

export interface ServedResult {
  provider: string;
  totalMs: number | null;
}

// Fire-and-forget by design — called after the real response has already
// been sent to the user (see chatRunner.ts), so nothing here can add
// perceived latency or affect what they see, no matter how long it takes
// or whether it fails.
export function maybeShadowToOllama(
  systemPrompt: string,
  history: ChatTurn[],
  taskCapability: TaskCapability,
  served: ServedResult
): void {
  // Shadowing Ollama against itself would be redundant — the whole point
  // is "how would Ollama have done on a request that was actually served
  // by something else."
  if (served.provider === "ollama") return;
  if (!enabled()) return;
  if (!isOllamaAvailable()) return;
  if (Math.random() >= sampleRate()) return;

  const model = pickOllamaModel(taskCapability)?.modelId;
  if (!model) return;

  const startedAt = Date.now();
  void ollamaProvider
    .streamChatCompletion(systemPrompt, history, () => {}, undefined, { model })
    .then(() => {
      console.log(
        JSON.stringify({
          event: "shadow_traffic",
          taskCapability,
          model,
          shadowOk: true,
          shadowTotalMs: Date.now() - startedAt,
          servedProvider: served.provider,
          servedTotalMs: served.totalMs,
        })
      );
    })
    .catch((err) => {
      console.log(
        JSON.stringify({
          event: "shadow_traffic",
          taskCapability,
          model,
          shadowOk: false,
          shadowErrorKind: classifyError(err),
          shadowTotalMs: Date.now() - startedAt,
          servedProvider: served.provider,
          servedTotalMs: served.totalMs,
        })
      );
    });
}

export const __testing = { enabled, sampleRate };
