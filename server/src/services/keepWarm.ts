import { ollamaProvider, isOllamaAvailable } from "./providers/ollama.js";
import { pickOllamaModel, type TaskCapability } from "./models/modelRegistry.js";
import { getProviderRouteStatus } from "./modelRouter.js";
import { recordSuccess, recordFailure } from "./providerHealth.js";
import { classifyError, affectsProviderHealth } from "./retryClassifier.js";

// JENNYSOL-LOCAL-CUTOVER.md Phase 2.1: a real cold-load measurement this
// session found ~2.2s just to load a model into memory — real risk against
// the 2.5s local first-token budget (Phase 2.3) without this. Interval is
// deliberately shorter than ollama.ts's own WARM_WINDOW_MS (5 min default)
// so a healthy Mac never actually goes cold between pings.
const DEFAULT_INTERVAL_MS = 4 * 60 * 1000;

function intervalMs(): number {
  return Number(process.env.OLLAMA_KEEP_WARM_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
}

function enabled(): boolean {
  if (process.env.OLLAMA_KEEP_WARM_ENABLED === "false") return false;
  // No point pinging a provider that isn't even in the active chain — most
  // deployments (Railway today) have no reachable Ollama at all, and this
  // would just be a pointless network attempt every tick.
  return getProviderRouteStatus().find((p) => p.name === "ollama")?.inActiveChain ?? false;
}

// JENNYSOL-CURRENT-STATE.md STEP 3 finding: keeping only "general" (qwen3:8b)
// warm leaves coding/reasoning requests to pay a real cold-load cost the
// first time they land after an idle stretch (measured live: 5.5-8.9s cold
// for qwen2.5-coder:7b/deepseek-r1:7b). Warming more than one model at once
// is a real memory trade-off on a 16GB box, so this stays opt-in via env var
// rather than a new default — an operator who's watched their own traffic
// pattern and knows it's mostly reasoning-heavy, say, can list that instead
// of (or alongside) "general". Unset/invalid entries fall back to exactly
// today's single-model behavior, never silently pinging nothing.
const DEFAULT_CAPABILITIES: TaskCapability[] = ["general"];
const VALID_CAPABILITIES = new Set<TaskCapability>([
  "general",
  "coding",
  "reasoning",
  "currentInfoSummarization",
  "embedding",
  "trivial",
  "vision",
]);

function capabilities(): TaskCapability[] {
  const raw = process.env.OLLAMA_KEEP_WARM_CAPABILITIES;
  if (!raw) return DEFAULT_CAPABILITIES;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is TaskCapability => VALID_CAPABILITIES.has(s as TaskCapability));
  return parsed.length > 0 ? parsed : DEFAULT_CAPABILITIES;
}

// One capability's ping — same success/failure handling as before this
// change, just factored out so tick() can run it for each configured
// capability in turn (sequentially, not in parallel: this Mac allows only
// one concurrent local run, so pinging multiple models at once would just
// have them queue behind each other for no benefit, or worse, contend with
// a real in-flight user request — see ollama.ts's own concurrency gate).
async function pingOne(capability: TaskCapability): Promise<void> {
  const model = pickOllamaModel(capability)?.modelId;
  if (!model) return;

  const startedAt = Date.now();
  try {
    await ollamaProvider.streamChatCompletion(
      "You are a helpful assistant.",
      [{ role: "user", content: "hi" }],
      () => {}, // output discarded — this exists purely to keep the model resident
      undefined,
      { model }
    );
    // Deliberately a distinct event name from "chat_timing" (chatRunner.ts)
    // — this must never be mistaken for real user traffic in
    // requestMetrics.ts's fallback/error-rate numbers. It also never calls
    // recordRequest() at all (only chatRunner.ts does), so it structurally
    // cannot pollute those numbers regardless of the log tag.
    console.log(JSON.stringify({ event: "keep_warm", capability, model, ok: true, totalMs: Date.now() - startedAt }));
    // Phase 2.5: this IS the background circuit-breaker probe — a real
    // successful ping clears an open breaker without a real user request
    // having to be the one that discovers recovery (and pays for it).
    recordSuccess("ollama");
  } catch (err) {
    // The earliest real signal that this Mac (or the tunnel to it) has
    // dropped off — surfaced as its own log line specifically so it's easy
    // to alert on separately from real user-facing failures.
    console.warn(
      JSON.stringify({
        event: "keep_warm",
        capability,
        model,
        ok: false,
        totalMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    // Same classification real user-request failures go through — an
    // at_capacity bump from colliding with real concurrent traffic (this
    // Mac allows only 1 concurrent local run) correctly does NOT count
    // against health, same as it wouldn't for a real request.
    const kind = classifyError(err);
    if (affectsProviderHealth(kind)) recordFailure("ollama", kind);
  }
}

async function tick(): Promise<void> {
  if (!enabled()) return;
  if (!isOllamaAvailable()) {
    // Not logged as a failure — isOllamaAvailable() already does its own
    // background reachability probing/logging. A keep-warm tick that finds
    // Ollama unreachable isn't new information, just not-yet-relevant.
    return;
  }
  for (const capability of capabilities()) {
    await pingOne(capability);
  }
}

let started = false;

export function startKeepWarm(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    void tick();
  }, intervalMs());
}

export const __testing = { tick, pingOne, enabled, intervalMs, capabilities };
