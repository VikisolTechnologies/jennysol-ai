import type { LlmProvider } from "../llmProvider.js";
import { streamOpenAiCompatible } from "./openaiCompatible.js";
import { getHardwareProfile } from "../models/hardwareProfile.js";

// Ollama runs locally — this points at wherever Ollama is actually reachable
// from this server process, not at the user's own machine. Today (deployed
// on Railway) that's nowhere: Railway's "localhost" is the Railway
// container itself, which has no Ollama running and no path to reach one on
// your Mac (127.0.0.1:11434 is deliberately never exposed publicly — see
// the security notes in modelRegistry.ts's neighboring files). Local-first
// mode means running this whole server process ON the machine Ollama runs
// on (your Mac now, the dedicated Linux box later) — OLLAMA_BASE_URL only
// ever needs to change, never the code, when that machine changes.
const BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

// Concurrency gate, not a lock — this only ever affects whether *this one
// Ollama attempt* is even started; it never blocks or delays any other
// AgentRun (cloud-routed runs are untouched, and a run this gate turns away
// simply continues down the normal provider chain to the next entry). Sized
// from the active HardwareProfile so it tightens automatically on the M1
// profile and loosens on the dedicated-server profile with zero code change.
let activeRuns = 0;

export function getActiveOllamaRuns(): number {
  return activeRuns;
}

function atCapacity(): boolean {
  return activeRuns >= getHardwareProfile().maxConcurrentLocalRuns;
}

export const ollamaProvider: LlmProvider = {
  async streamChatCompletion(systemPrompt, history, onDelta, _onWebSources, opts) {
    if (atCapacity()) {
      const err = new Error(
        `ollama is at its configured concurrency limit (${getHardwareProfile().maxConcurrentLocalRuns} local run(s))`
      ) as Error & { code?: string };
      err.code = "at_capacity";
      throw err;
    }
    activeRuns++;
    try {
      await streamOpenAiCompatible(
        `${BASE_URL}/v1/chat/completions`,
        {},
        opts?.model || DEFAULT_MODEL,
        systemPrompt,
        history,
        onDelta,
        opts
      );
    } finally {
      activeRuns--;
    }
  },
};

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
}

// Real model listing (section 4: "list installed models") — used by the
// models CLI and, in the router, to avoid ever requesting a model that
// isn't actually pulled (which would otherwise surface as a confusing
// mid-stream 404 instead of a clean "not installed").
export async function listInstalledOllamaModels(): Promise<OllamaModelInfo[]> {
  const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`ollama /api/tags failed (${res.status})`);
  const data = (await res.json()) as { models?: { name: string; size: number }[] };
  return (data.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size }));
}

export async function isModelInstalled(modelId: string): Promise<boolean> {
  try {
    const models = await listInstalledOllamaModels();
    return models.some((m) => m.name === modelId);
  } catch {
    return false;
  }
}

// Most deployments of this app (this one included, on Railway) have no
// Ollama instance reachable at all — there's no cloud-hosted fallback for
// it. Rather than let every chat request pay for a doomed connection
// attempt (and the timeout that goes with it) before falling through to the
// next provider, probe reachability once in the background and cache the
// answer. Defaults to "unavailable" until proven otherwise, same reasoning
// as the Gemini grounding probe: a slow-to-discover feature beats a slow
// first message.
let available: boolean | null = null;
let lastCheckedAt = 0;
const RECHECK_INTERVAL_MS = 60_000;

async function checkNow(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    available = res.ok;
  } catch {
    available = false;
  }
}

// "Configured and worth attempting right now" — folds the reachability
// probe together with the concurrency gate above. A request turned away for
// being at-capacity is reported the same way as "not reachable" to the
// router (see modelRouter.ts's usable()/resolveChain()): skipped without
// counting against Ollama's own health, since neither case says anything
// about whether Ollama itself is actually broken.
export function isOllamaAvailable(): boolean {
  const now = Date.now();
  if (now - lastCheckedAt > RECHECK_INTERVAL_MS) {
    lastCheckedAt = now;
    void checkNow(); // refresh in the background; never block a request on this
  }
  if (atCapacity()) return false;
  return available ?? false;
}

// The module-load probe below is fire-and-forget for the router's own sake
// (a live chat request must never block on it), but that means a
// short-lived process — models-cli.ts's `health`/`benchmark` commands, or
// any test calling isOllamaAvailable() synchronously right after import —
// reliably observes `available === null` (-> reported as unreachable) even
// when Ollama is genuinely running, simply because the process asks before
// the in-flight fetch above has had a chance to resolve. Confirmed live:
// `npm run models -- health` reported "reachable: false" against an Ollama
// instance that `curl 127.0.0.1:11434/api/version` answered correctly in
// the same second. This awaits that *same* initial probe (never starts a
// second one) so a diagnostic command gets a real answer instead of a false
// negative, without changing isOllamaAvailable()'s non-blocking contract
// for the router's hot path at all.
export async function ensureOllamaChecked(): Promise<boolean> {
  await initialCheck;
  return isOllamaAvailable();
}

// lastCheckedAt is set here too (not just inside isOllamaAvailable()) —
// found via this file's own test: without it, lastCheckedAt stays 0 until
// isOllamaAvailable() itself first runs, so that very first call always saw
// "no check within RECHECK_INTERVAL_MS" and fired a second, redundant
// fetch on top of this module-load one, even though the answer it needed
// was already in flight.
lastCheckedAt = Date.now();
const initialCheck = checkNow(); // kick off an initial check at module load
