import type { ErrorKind } from "./retryClassifier.js";

// In-memory only — a single Railway instance's own recent experience with
// each provider. Not persisted (a restart is a fair reason to give every
// provider a clean slate) and not shared across instances (this app runs as
// one process; if that ever changes, this would need to move to something
// shared like Redis instead of a module-level Map).
export interface ProviderStats {
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  count503: number;
  count429: number;
  countQuota: number;
  countTimeout: number;
  countAuth: number;
  countOther: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  cooldownUntil: number | null;
}

function emptyStats(): ProviderStats {
  return {
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    count503: 0,
    count429: 0,
    countQuota: 0,
    countTimeout: 0,
    countAuth: 0,
    countOther: 0,
    lastSuccess: null,
    lastFailure: null,
    cooldownUntil: null,
  };
}

const stats = new Map<string, ProviderStats>();

// Three strikes before a *transient*-looking failure (503, timeout, a plain
// rate limit) trips the breaker — one blip shouldn't take a provider out of
// rotation, but a real outage shows up fast.
const CONSECUTIVE_FAILURES_TO_TRIP = 3;
// Short enough that a real recovery gets picked back up quickly, long
// enough not to hammer a provider that's genuinely down.
const TRANSIENT_COOLDOWN_MS = 30_000;
// An auth failure (bad/expired/revoked key) won't self-heal — retrying it
// every 30s is pure waste. This just bounds how long it stays out of
// rotation before automatically getting one more chance; the real fix is
// still someone updating the env var and redeploying.
const AUTH_COOLDOWN_MS = 60 * 60 * 1000;

function getStats(name: string): ProviderStats {
  let s = stats.get(name);
  if (!s) {
    s = emptyStats();
    stats.set(name, s);
  }
  return s;
}

// true if the provider is not in cooldown, OR its cooldown has expired —
// the latter is the "half-open" trial: the very next request through is a
// live test of whether the provider has recovered.
export function isHealthy(name: string): boolean {
  const s = getStats(name);
  return s.cooldownUntil === null || Date.now() >= s.cooldownUntil;
}

export function recordSuccess(name: string): void {
  const s = getStats(name);
  s.successCount++;
  s.consecutiveFailures = 0;
  s.lastSuccess = Date.now();
  s.cooldownUntil = null;
}

export function recordFailure(name: string, kind: ErrorKind): void {
  const s = getStats(name);
  s.failureCount++;
  s.consecutiveFailures++;
  s.lastFailure = Date.now();
  if (kind === "503") s.count503++;
  else if (kind === "429") s.count429++;
  else if (kind === "quota") s.countQuota++;
  else if (kind === "timeout") s.countTimeout++;
  else if (kind === "auth") s.countAuth++;
  else s.countOther++;

  if (kind === "auth") {
    s.cooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
    return;
  }
  if (s.consecutiveFailures >= CONSECUTIVE_FAILURES_TO_TRIP) {
    s.cooldownUntil = Date.now() + TRANSIENT_COOLDOWN_MS;
  }
}

export function getHealthSnapshot(): Record<string, ProviderStats & { healthy: boolean }> {
  const out: Record<string, ProviderStats & { healthy: boolean }> = {};
  for (const [name, s] of stats) out[name] = { ...s, healthy: isHealthy(name) };
  return out;
}

export function __resetHealthForTests(): void {
  stats.clear();
}
