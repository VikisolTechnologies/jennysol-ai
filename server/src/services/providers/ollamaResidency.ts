import { db } from "../../db/index.js";
import { getProviderRouteStatus } from "../modelRouter.js";

// Same base URL as ollama.ts — deliberately not imported from there to
// avoid a circular import (ollama.ts has no reason to know about residency
// polling), matching that file's own real-topology comment on BASE_URL.
const BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

export interface ResidentModel {
  name: string;
  sizeVramBytes: number;
  expiresAt: string;
}

interface PsModel {
  name: string;
  size_vram?: number;
  size?: number;
  expires_at?: string;
}

async function fetchPs(): Promise<PsModel[]> {
  // Ollama's real /api/ps — confirmed live on this deployment's own Mac
  // (`curl http://100.70.199.75:11434/api/ps`) to report exactly the
  // currently-loaded model(s) with a real `expires_at`, correcting an
  // earlier, stale comment elsewhere in this codebase (ollama.ts's
  // wasModelWarm) claiming "Ollama exposes no API for this" — it does, this
  // just hadn't been used yet. Same 6000ms margin as ollama.ts's own
  // checkNow() for the real relayed round-trip this deployment's topology
  // needs (Railway -> Tailscale -> railtail -> this Mac).
  const res = await fetch(`${BASE_URL}/api/ps`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`ollama /api/ps failed (${res.status})`);
  const data = (await res.json()) as { models?: PsModel[] };
  return data.models ?? [];
}

// On-demand, live snapshot for the admin Providers screen — always a fresh
// /api/ps call (not the poller's own cached state below) so what an admin
// sees on load is never staler than this one request's own round trip.
export async function getResidentModels(): Promise<ResidentModel[]> {
  const models = await fetchPs();
  return models.map((m) => ({
    name: m.name,
    sizeVramBytes: m.size_vram ?? m.size ?? 0,
    expiresAt: m.expires_at ?? "",
  }));
}

const insertEviction = db.prepare("INSERT INTO ollama_evictions (model, replaced_by) VALUES (?, ?)");
const countEvictionsTodayStmt = db.prepare(
  "SELECT COUNT(*) AS c FROM ollama_evictions WHERE evicted_at >= date('now')"
);

// UTC day boundary (SQLite's date('now') is UTC) — documented rather than
// silently assumed, since "today" for a founder in a different timezone
// than this Mac's system clock could otherwise read as off-by-some-hours
// without an obvious reason why.
export function getEvictionsToday(): number {
  return (countEvictionsTodayStmt.get() as { c: number }).c;
}

// Poll-to-poll residency snapshot, name -> its own last-reported expires_at
// (epoch ms). Module-level and intentionally not persisted: it exists only
// to detect a *transition* between two consecutive polls, not as a source
// of truth about current residency (getResidentModels() above is that,
// queried fresh every time) — resetting to empty on a server restart just
// means the very first poll after boot can't yet tell an eviction from a
// cold start, which corrects itself one poll later.
let lastKnown = new Map<string, number>();

// A model can stop appearing in /api/ps for two genuinely different real
// reasons: it simply reached its own previously-reported expires_at (normal
// idle unload, not an eviction), or it vanished *before* that time because
// something else needed the memory (a real eviction — the exact mechanism
// JENNY_VISION_MODEL_EVALUATION.md's eviction-policy section root-caused to
// OLLAMA_MAX_LOADED_MODELS). Comparing against each model's own previously
// observed expires_at is what tells these apart from outside the process
// that's actually doing the unloading — there is no other real signal this
// server can see (it cannot read this Mac's local Ollama server log; it
// only ever reaches it through the network).
export async function pollOllamaResidencyOnce(): Promise<void> {
  if (!(getProviderRouteStatus().find((p) => p.name === "ollama")?.inActiveChain ?? false)) return;

  let models: PsModel[];
  try {
    models = await fetchPs();
  } catch {
    // Unreachable this tick — not itself eviction evidence, and ollama.ts's
    // own checkNow()/keepWarm.ts already track plain reachability. Leaving
    // lastKnown as-is means the next successful poll compares against the
    // last time this actually saw the Mac, which is the honest comparison.
    return;
  }

  const nowMs = Date.now();
  const currentNames = new Set(models.map((m) => m.name));
  const newlyAppeared = models.map((m) => m.name).filter((name) => !lastKnown.has(name));

  for (const [name, expiresAtMs] of lastKnown) {
    if (currentNames.has(name)) continue;
    if (nowMs < expiresAtMs) {
      insertEviction.run(name, newlyAppeared[0] ?? null);
    }
  }

  lastKnown = new Map(
    models.map((m) => [m.name, m.expires_at ? new Date(m.expires_at).getTime() : nowMs])
  );
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
let started = false;

export function startOllamaResidencyPolling(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    void pollOllamaResidencyOnce();
  }, Number(process.env.OLLAMA_RESIDENCY_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS);
}

export const __testing = { pollOllamaResidencyOnce, resetLastKnown: () => (lastKnown = new Map()) };
