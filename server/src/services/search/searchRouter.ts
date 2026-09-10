import { tavilyProvider } from "./tavily.js";
import { searxngProvider } from "./searxng.js";
import type { SearchProvider, SearchResultItem } from "./searchProvider.js";
import { normalizeResults } from "./normalize.js";
import { isHealthy, recordSuccess, recordFailure } from "../providerHealth.js";
import { classifyError, affectsProviderHealth } from "../retryClassifier.js";

// Same ordered-chain-with-health-gating shape as modelRouter.ts's REGISTRY —
// deliberately, so this reads the same way to anyone already familiar with
// how model fallback works here. Add a second search provider by
// implementing SearchProvider (see searchProvider.ts) and adding it here;
// SEARCH_PROVIDER_CHAIN then controls preference order without a code change.
const REGISTRY: SearchProvider[] = [searxngProvider, tavilyProvider];

// providerHealth.ts's stats map is a single shared namespace keyed by plain
// string name — prefixed here so a search provider and an LLM provider that
// happen to share a name (unlikely today, cheap to guard against) never
// collide in cooldown bookkeeping.
function healthKey(name: string): string {
  return `search:${name}`;
}

// searxng first: free-first policy — a self-hosted, no-per-query-cost
// provider is preferred whenever it's actually configured (inert otherwise,
// since searxngProvider.configured() is false without SEARXNG_BASE_URL set,
// so this default is a no-op change until someone stands one up).
function resolveChain(): SearchProvider[] {
  const configuredNames = (process.env.SEARCH_PROVIDER_CHAIN || "searxng,tavily")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const chain: SearchProvider[] = [];
  for (const name of configuredNames) {
    const entry = REGISTRY.find((p) => p.name === name);
    if (entry && !seen.has(name)) {
      chain.push(entry);
      seen.add(name);
    }
  }
  return chain;
}

// Whether *any* search provider has credentials configured at all — the
// static, request-independent signal contextManager.ts and gemini.ts use to
// decide whether the universal search-then-route path is active, or whether
// to fall back to Gemini's own native grounding tool (see gemini.ts).
export function hasAnySearchProviderConfigured(): boolean {
  return resolveChain().some((p) => p.configured());
}

export interface SearchOutcome {
  providerUsed: string;
  results: SearchResultItem[];
}

// Tries each configured, healthy provider in order; returns null only if
// every configured provider failed or none is configured — the caller
// (contextManager.ts) treats that as "no current-info source available" and
// instructs the model to say so honestly rather than guessing.
export async function search(query: string, opts?: { signal?: AbortSignal }): Promise<SearchOutcome | null> {
  for (const provider of resolveChain()) {
    if (!provider.configured()) continue;
    if (!isHealthy(healthKey(provider.name))) continue;

    try {
      const rawResults = await provider.search(query, { signal: opts?.signal });
      const results = normalizeResults(rawResults, provider.name);
      recordSuccess(healthKey(provider.name));
      return { providerUsed: provider.name, results };
    } catch (err) {
      const kind = classifyError(err);
      if (affectsProviderHealth(kind)) recordFailure(healthKey(provider.name), kind);
      console.error(`[search] ${provider.name} failed (${kind}):`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}
