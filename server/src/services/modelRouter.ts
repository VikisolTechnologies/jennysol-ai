import type { ChatTurn, LlmProvider, TokenUsage, ToolCallHandler, ToolDefinition, WebSource } from "./llmProvider.js";
import { geminiProvider } from "./providers/gemini.js";
import { deepseekProvider } from "./providers/deepseek.js";
import { ollamaProvider, isOllamaAvailable, wasModelWarm } from "./providers/ollama.js";
import { isHealthy, recordSuccess, recordFailure } from "./providerHealth.js";
import { classifyError, affectsProviderHealth, type ErrorKind } from "./retryClassifier.js";
import { pickOllamaModel, type TaskCapability } from "./models/modelRegistry.js";

interface ProviderEntry {
  name: string;
  provider: LlmProvider;
  // Whether this provider has what it needs to even attempt a request right
  // now — a missing API key or an unreachable Ollama instance, not the same
  // thing as "unhealthy" (which means it has what it needs but has been
  // failing).
  configured: () => boolean;
}

// Adding a new provider is: one file implementing LlmProvider (see
// deepseek.ts for the ~15-line pattern most OpenAI-compatible APIs need),
// one entry here, done — nothing else in the router, chatRunner, or the
// routes needs to change. This is what "not a redesign later" means in
// practice for OpenAI/Anthropic/etc. once real credentials for them exist.
const REGISTRY: ProviderEntry[] = [
  { name: "gemini", provider: geminiProvider, configured: () => !!process.env.GEMINI_API_KEY },
  { name: "deepseek", provider: deepseekProvider, configured: () => !!process.env.DEEPSEEK_API_KEY },
  { name: "ollama", provider: ollamaProvider, configured: isOllamaAvailable },
];

// LLM_PROVIDER_CHAIN="gemini,deepseek,ollama" for an explicit ordered
// fallback chain — order is preference (strongest/most capable/cheapest
// first), each entry only ever attempted if it's actually configured *and*
// currently healthy (see isHealthy/usable below), so this reacts to live
// state rather than blindly walking a fixed list. Falls back to the
// single-provider LLM_PROVIDER env var (still works exactly as before if
// that's all that's set), then to Gemini alone. Ollama is deliberately never
// in the *implicit* default chain — it's opt-in via LLM_PROVIDER_CHAIN,
// since sending it a request in an environment where nobody's running it
// wastes a health-check interval for nothing; once listed, it's a fully
// first-class entry, not a placeholder — same LlmProvider interface, same
// failover/health treatment as every other provider.
//
// This is deliberately an ordered preference list rather than a per-request
// scoring system (task complexity, cost, latency, etc.) — with only two real
// cloud providers configured today and no signal to meaningfully distinguish
// "better at coding" or "better at reasoning" between them, building that
// scoring now would be speculative complexity with nothing real to act on.
// What *is* real and implemented: live health (isHealthy), fast per-entry
// timeouts so an unhealthy entry doesn't stall the whole chain (see
// firstTokenTimeoutMs below), and automatic cooldown/recovery. Extending
// this to genuine capability-based selection (e.g. once a coding-specialized
// or vision-specialized provider exists) means adding a filter here, not a
// rewrite — resolveChain and usable() are the only two functions that would
// need to know about it.
// DEPLOYMENT_MODE=local's one real effect: when nobody has set an explicit
// chain, prefer trying Ollama first — this is what "local-first" means in
// practice for a request that doesn't otherwise care which brain answers.
// Ollama being unconfigured/unreachable (checked live via isOllamaAvailable,
// same as any other entry) just means the very next entry in this default
// gets tried instead, same as any other fallback. DEPLOYMENT_MODE=cloud (the
// actual Railway setting) keeps today's plain "gemini" default untouched.
function defaultChainFor(deploymentMode: string | undefined): string {
  return deploymentMode === "local" ? "ollama,gemini,deepseek" : "gemini";
}

function resolveChain(): ProviderEntry[] {
  const configuredNames = (
    process.env.LLM_PROVIDER_CHAIN ||
    process.env.LLM_PROVIDER ||
    defaultChainFor(process.env.DEPLOYMENT_MODE)
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const chain: ProviderEntry[] = [];
  for (const name of configuredNames) {
    const entry = REGISTRY.find((e) => e.name === name);
    if (entry && !seen.has(name)) {
      chain.push(entry);
      seen.add(name);
    }
  }
  return chain.length > 0 ? chain : [REGISTRY[0]];
}

function usable(e: ProviderEntry): boolean {
  return e.configured() && isHealthy(e.name);
}

export function hasAnyConfiguredProvider(): boolean {
  return resolveChain().some((e) => e.configured());
}

// Safe, secret-free summary of the router's live state — every entry in the
// registry (not just the ones in the active chain), so an operator can see
// *why* a provider isn't in rotation (never in the configured
// LLM_PROVIDER_CHAIN at all, vs. configured but currently unhealthy). Feeds
// routes/admin.ts's provider-health endpoint; never exposes a key value,
// only booleans/names/counts already safe by construction (configured() and
// getHealthSnapshot() never touch the key's actual value).
export interface ProviderRouteStatus {
  name: string;
  inActiveChain: boolean;
  configured: boolean;
  usable: boolean;
}

export function getProviderRouteStatus(): ProviderRouteStatus[] {
  const chain = resolveChain();
  const chainNames = new Set(chain.map((e) => e.name));
  return REGISTRY.map((e) => ({
    name: e.name,
    inActiveChain: chainNames.has(e.name),
    configured: e.configured(),
    usable: usable(e),
  }));
}

export class AllProvidersUnavailableError extends Error {
  constructor(public attempts: { name: string; reason: string }[]) {
    super("All configured AI providers are currently unavailable");
    this.name = "AllProvidersUnavailableError";
  }
}

export interface RouteResult {
  providerUsed: string;
  // Only meaningful for Ollama today — cloud providers each have one fixed
  // model already surfaced via their own env vars, not worth duplicating
  // here. Set from the same registry pick actually sent to the provider,
  // never guessed after the fact.
  model?: string;
  fellBack: boolean;
  firstTokenMs?: number;
  totalMs?: number;
  hedged?: boolean;
  taskCapability: TaskCapability;
  // Every provider tried/skipped before the one that actually answered —
  // "what failed above it," not just whether this was a fallback.
  attempts: { name: string; reason: string }[];
  usage?: TokenUsage;
  // Ollama only — best-effort per providers/ollama.ts's wasModelWarm().
  wasWarm?: boolean;
}

// A provider that never starts responding is a worse failure mode than one
// that's just slow to finish generating — once real output has started
// streaming to the user, the router can't safely fail over anyway (see the
// "already streamed" guard below), so the one moment that matters for
// failover speed is time-to-first-token. This bounds how long a single
// attempt is allowed to produce nothing before the router gives up on it and
// moves to the next provider in the chain — "aggressive failure detection"
// per the architecture spec, rather than waiting on a provider's own
// (sometimes very long, e.g. Gemini's ~15-17s to return a 429 on a rejected
// tool) native timeout.
//
// Deliberately shorter for a fallback entry than for the primary: with a
// real second provider now configured, serializing full-length timeouts
// across every entry in the chain (e.g. 15s + 15s + 15s before a user sees
// anything) would make a real outage feel far worse than it needs to. The
// primary gets a fair, full budget; a plain chat completion from a fallback
// provider (no grounding-tool overhead) has no legitimate reason to take
// nearly as long, so it's held to a tighter one and failed past quickly if
// it's also struggling.
// Read per-call rather than frozen at module load — this is what a real
// Railway deployment updates via an env var + redeploy anyway, and reading
// it live (instead of baking it into a module-level constant) is what makes
// it possible to unit-test both values without spawning a second process.
function firstTokenTimeoutMs(isPrimary: boolean): number {
  if (isPrimary) return Number(process.env.LLM_FIRST_TOKEN_TIMEOUT_MS) || 10_000;
  return Number(process.env.LLM_FALLBACK_FIRST_TOKEN_TIMEOUT_MS) || 6_000;
}

// Hedging is off by default: it only ever does anything useful once a
// second real provider is actually configured (today's production is
// Gemini-only, so this is inert there), and racing two providers has a real
// cost — see JENNY_IMPLEMENTATION_STATUS.md for why the default is
// conservative. LLM_HEDGE_DELAY_MS should stay comfortably above normal
// first-token latency (observed ~1-2s for Gemini) so hedging only fires on
// genuine slowness, not on every ordinary request.
function hedgeEnabled(): boolean {
  return process.env.LLM_HEDGE_ENABLED === "true";
}
function hedgeDelayMs(): number {
  return Number(process.env.LLM_HEDGE_DELAY_MS) || 4_000;
}

interface AttemptOutcome {
  deltasSent: number;
  firstTokenMs: number | null;
  usage?: TokenUsage;
}

// Runs one provider attempt with a first-token deadline. Resolves/rejects
// exactly once; if the provider settles after the deadline already fired,
// that late result is silently discarded (the caller has moved on).
function attemptWithTimeout(
  entry: ProviderEntry,
  systemPrompt: string,
  history: ChatTurn[],
  onDelta: (text: string) => void,
  onWebSources: ((s: WebSource[]) => void) | undefined,
  timeoutMs: number,
  model?: string,
  outerSignal?: AbortSignal,
  // M6 (Arena connector gateway, PROJECT-PROGRESS.md milestone model): threads M1's tool-calling
  // capability through the router — every real caller (chatRunner.ts, the new agent gateway)
  // goes through routeChatCompletion/attemptWithTimeout, not gemini.ts's streamChatCompletion
  // directly, so M1's own tests (which called the provider directly) never actually proved a
  // real request could reach this capability until this parameter existed. Only Gemini currently
  // implements tool calling (see gemini.ts); other providers simply ignore these fields.
  tools?: ToolDefinition[],
  onToolCall?: ToolCallHandler
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const startedAt = Date.now();
  let deltasSent = 0;
  let firstTokenMs: number | null = null;
  let usage: TokenUsage | undefined;
  let settled = false;

  return new Promise<AttemptOutcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (firstTokenMs === null && !settled) {
        settled = true;
        controller.abort();
        const err = new Error(`${entry.name} timed out waiting for first token (${timeoutMs}ms)`) as Error & {
          code?: string;
        };
        err.code = "timeout";
        reject(err);
      }
    }, timeoutMs);

    // Run-scoped cancellation (see runCancellation.ts / chatRunner.ts) — a
    // *different* signal from the timeout controller above, so cancelling
    // this run is distinguishable from the router's own "gave up waiting"
    // timeout: the catch block in routeChatCompletion below stops the whole
    // fallback chain for "cancelled" instead of trying the next provider.
    if (outerSignal) {
      if (outerSignal.aborted) {
        settled = true;
        clearTimeout(timer);
        controller.abort();
        const err = new Error("run cancelled") as Error & { code?: string };
        err.code = "cancelled";
        reject(err);
      } else {
        outerSignal.addEventListener(
          "abort",
          () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              controller.abort();
              const err = new Error("run cancelled") as Error & { code?: string };
              err.code = "cancelled";
              reject(err);
            }
          },
          { once: true }
        );
      }
    }

    const wrappedOnDelta = (text: string) => {
      if (firstTokenMs === null) {
        firstTokenMs = Date.now() - startedAt;
        clearTimeout(timer);
      }
      deltasSent++;
      if (!settled) onDelta(text);
    };

    entry.provider
      .streamChatCompletion(systemPrompt, history, wrappedOnDelta, onWebSources, {
        signal: controller.signal,
        model,
        tools,
        onToolCall,
        onUsage: (u) => {
          usage = u;
        },
      })
      .then(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ deltasSent, firstTokenMs, usage });
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(Object.assign(err instanceof Error ? err : new Error(String(err)), { __deltasSent: deltasSent }));
        }
        // else: settled via timeout already: this late rejection (often the
        // AbortError caused by our own controller.abort() above) is expected
        // and intentionally ignored.
      });
  });
}

function errorKind(err: unknown): ErrorKind {
  const code = (err as { code?: string })?.code;
  return code === "timeout" ? "timeout" : classifyError(err);
}

// Races `primary` against `secondary`, starting `secondary` only if
// `primary` hasn't produced a first token within `hedgeDelayMs`. Whichever
// produces a first token first "wins" and its stream is what the caller
// sees; the loser is aborted client-side (best-effort — see the note on
// AbortSignal in gemini.ts: this stops us from waiting on or relaying the
// loser's output, but per the provider SDKs' own documentation does not
// guarantee the upstream request itself is cancelled/unbilled).
// Resolves the instant a winner's first token arrives — deliberately does
// NOT wait for that winning arm to finish generating, and does NOT wait for
// the losing arm at all. Waiting on either would defeat hedging's entire
// purpose (perceived latency): if the winner is fast but the loser takes
// longer to error out or finish, blocking the return on both settling would
// make a "successful" hedge no faster than not hedging at all. The losing
// arm keeps running (best-effort aborted, see the AbortSignal caveat on
// gemini.ts) purely to update provider health bookkeeping in the
// background; its output is discarded, never awaited.
//
// Known limitation: if the WINNING arm fails partway through, after having
// already streamed some of its reply, that failure has no way to propagate
// back through this function's already-resolved promise — this mirrors the
// non-hedge path's "don't stitch two providers' output together" guard
// conceptually, but here the failure is currently swallowed rather than
// surfaced to the caller. This only matters once hedging is enabled with a
// second real provider configured (today's production is Gemini-only, so
// it's inert) and is documented rather than silently shipped as if solved —
// see JENNY_IMPLEMENTATION_STATUS.md.
function runHedgedPair(
  primary: ProviderEntry,
  secondary: ProviderEntry,
  systemPrompt: string,
  history: ChatTurn[],
  onDelta: (text: string) => void,
  onWebSources: ((s: WebSource[]) => void) | undefined,
  hedgeDelayMs: number,
  taskCapability: TaskCapability
): Promise<{ result: RouteResult | null; attempts: { name: string; reason: string }[] }> {
  const routeStart = Date.now();
  const attempts: { name: string; reason: string }[] = [];
  const controllers = new Map<string, AbortController>();

  return new Promise((resolvePair) => {
    let winner: string | null = null;
    let armsStarted = 1;
    let armsSettled = 0;
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    function finish(outcome: { result: RouteResult | null; attempts: typeof attempts }) {
      if (finished) return;
      finished = true;
      if (hedgeTimer) clearTimeout(hedgeTimer);
      resolvePair(outcome);
    }

    function abortOthers(winnerName: string) {
      for (const [name, c] of controllers) if (name !== winnerName) c.abort();
    }

    function startArm(entry: ProviderEntry, isSecondary: boolean) {
      const controller = new AbortController();
      controllers.set(entry.name, controller);
      const wrappedOnDelta = (text: string) => {
        if (winner === null) {
          winner = entry.name;
          abortOthers(entry.name);
          console.log(
            `[router] ${entry.name} won hedge race` +
              (isSecondary ? ` (hedged after ${hedgeDelayMs}ms against ${primary.name})` : "")
          );
          finish({
            // Hedging is off by default and doesn't do per-request model
            // selection or usage capture the way the sequential path does
            // (see this function's own doc comment on known limitations) —
            // taskCapability/attempts are real, usage/wasWarm are simply
            // not collected on this path.
            result: {
              providerUsed: entry.name,
              fellBack: entry.name !== primary.name,
              totalMs: Date.now() - routeStart,
              hedged: isSecondary,
              taskCapability,
              attempts: [...attempts],
            },
            attempts,
          });
        }
        if (winner !== entry.name) return; // lost the race after starting — discard
        onDelta(text);
      };
      entry.provider
        .streamChatCompletion(systemPrompt, history, wrappedOnDelta, onWebSources, { signal: controller.signal })
        .then(() => {
          if (winner === entry.name) recordSuccess(entry.name);
        })
        .catch((error) => {
          const kind = errorKind(error);
          if (affectsProviderHealth(kind)) recordFailure(entry.name, kind);
          if (winner === null) {
            attempts.push({ name: entry.name, reason: kind });
            armsSettled++;
            if (armsSettled >= armsStarted) finish({ result: null, attempts });
          }
          // else: this arm lost the race and failed afterward — expected,
          // not logged as a real failure (see function-level comment).
        });
    }

    startArm(primary, false);
    hedgeTimer = setTimeout(() => {
      if (winner === null) {
        armsStarted = 2;
        startArm(secondary, true);
      }
    }, hedgeDelayMs);
  });
}

export async function routeChatCompletion(
  systemPrompt: string,
  history: ChatTurn[],
  onDelta: (text: string) => void,
  onWebSources?: (sources: WebSource[]) => void,
  taskCapability: TaskCapability = "general",
  // Run-scoped cancellation (see chatRunner.ts/runCancellation.ts) — distinct
  // from the per-attempt AbortController attemptWithTimeout creates for its
  // own first-token deadline. Not currently wired into the hedging path
  // (runHedgedPair) — hedging is off by default, and this is a documented
  // gap rather than a silent one.
  outerSignal?: AbortSignal,
  // M6: same tools/onToolCall threading as attemptWithTimeout above — deliberately not wired
  // into runHedgedPair (hedging is off by default and inert with today's single-configured-
  // provider deployments, so adding tool support to a disabled code path has no real benefit
  // yet). A tool-bearing request explicitly skips the hedge branch below and always takes the
  // sequential attemptWithTimeout path instead, so tool-calling is never silently dropped if
  // hedging happens to be enabled.
  tools?: ToolDefinition[],
  onToolCall?: ToolCallHandler
): Promise<RouteResult> {
  const chain = resolveChain();
  const attempts: { name: string; reason: string }[] = [];
  const routeStart = Date.now();
  const consumedByHedge = new Set<string>();

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    if (consumedByHedge.has(entry.name)) continue;

    if (!entry.configured()) {
      attempts.push({ name: entry.name, reason: "not configured" });
      continue;
    }
    if (!isHealthy(entry.name)) {
      attempts.push({ name: entry.name, reason: "in cooldown" });
      continue;
    }

    // M6: runHedgedPair never learned to carry tools/onToolCall (see this function's own doc
    // comment above) — rather than silently dropping tool-calling capability whenever hedging
    // happens to be enabled, a tool-bearing request skips the hedge branch entirely and always
    // takes the sequential path below, which does thread tools through correctly.
    if (hedgeEnabled() && i === 0 && !tools?.length) {
      const hedgeTarget = chain.slice(1).find(usable);
      if (hedgeTarget) {
        const { result, attempts: hedgeAttempts } = await runHedgedPair(
          entry,
          hedgeTarget,
          systemPrompt,
          history,
          onDelta,
          onWebSources,
          hedgeDelayMs(),
          taskCapability
        );
        consumedByHedge.add(entry.name);
        consumedByHedge.add(hedgeTarget.name);
        if (result) return result;
        attempts.push(...hedgeAttempts);
        continue;
      }
    }

    // Only Ollama's own request needs a chosen model — cloud entries each
    // have one fixed model already baked into their own provider file, and
    // pickOllamaModel is a no-op call for them (result simply unused below).
    const model = entry.name === "ollama" ? pickOllamaModel(taskCapability)?.modelId : undefined;
    // Checked *before* the attempt (attemptWithTimeout/ollama.ts's own
    // markModelUsed would otherwise make every request "warm" by the time
    // anything could ask) — best-effort per wasModelWarm()'s own caveats.
    const wasWarm = entry.name === "ollama" && model ? wasModelWarm(model) : undefined;

    try {
      const { deltasSent, firstTokenMs, usage } = await attemptWithTimeout(
        entry,
        systemPrompt,
        history,
        onDelta,
        onWebSources,
        firstTokenTimeoutMs(i === 0),
        model,
        outerSignal,
        tools,
        onToolCall
      );
      recordSuccess(entry.name);
      console.log(
        `[router] ${entry.name} ok${model ? ` model=${model}` : ""}${
          i > 0 ? ` (fell back from: ${attempts.map((a) => a.name).join(", ")})` : ""
        }${firstTokenMs !== null ? ` firstTokenMs=${firstTokenMs}` : ""}`
      );
      return {
        providerUsed: entry.name,
        model,
        fellBack: i > 0,
        firstTokenMs: firstTokenMs ?? undefined,
        totalMs: Date.now() - routeStart,
        hedged: false,
        taskCapability,
        attempts: [...attempts],
        usage,
        wasWarm,
      };
    } catch (err) {
      const deltasSentHere = (err as { __deltasSent?: number })?.__deltasSent ?? 0;
      const kind = errorKind(err);

      // Cancellation stops the whole chain, full stop — it's never a signal
      // to try the next provider (the user asked this run to stop, not
      // "find me a different brain"), never counts against the entry's
      // health, and is never wrapped in AllProvidersUnavailableError (the
      // caller — chatRunner.ts — checks err.code === "cancelled" and marks
      // the run cancelled, not failed).
      if (kind === "cancelled") throw err;

      // A "timeout" here isn't a signal the provider actually failed — it's
      // us choosing to stop waiting (see attemptWithTimeout). Measured live
      // against real Gemini: with only one provider configured (today's
      // actual production setup), letting that count toward the circuit
      // breaker meant a burst of merely-slow-but-would-have-succeeded
      // responses could trip it and lock out the ONLY provider for a full
      // 30s cooldown with nothing to fail over to — strictly worse than not
      // timing out at all. A real 503/429/quota/auth failure is a genuine
      // signal about the provider regardless of what else is configured, so
      // those always count; a self-imposed timeout only counts when there's
      // actually somewhere else to send the next request.
      const hasFallbackLeft = kind !== "timeout" || chain.slice(i + 1).some(usable);
      if (affectsProviderHealth(kind) && hasFallbackLeft) recordFailure(entry.name, kind);
      attempts.push({ name: entry.name, reason: kind });
      console.error(`[router] ${entry.name} failed (${kind}):`, err instanceof Error ? err.message : err);

      // Already streamed part of a reply from this provider before it died —
      // don't silently hand the rest to a different provider. That would
      // stitch two providers' output together into one reply, or send a
      // second independent answer after a partial one the user already saw.
      // Surface the failure instead; the client shows what streamed so far.
      if (deltasSentHere > 0) throw err;
    }
  }

  throw new AllProvidersUnavailableError(attempts);
}
