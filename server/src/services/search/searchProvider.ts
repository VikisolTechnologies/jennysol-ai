// Mirrors llmProvider.ts's shape deliberately — same reasoning applies here:
// the app should never be hardwired to one search vendor's request/response
// shape. Anything that can answer search(query) and report configured()
// plugs into searchRouter.ts's chain the same way deepseek.ts or ollama.ts
// plug into modelRouter.ts's — adding a second search provider later is a
// new file implementing this interface plus one line in the registry, not a
// redesign.
export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  domain?: string;
  // Everything below is optional and additive (2026-09-10, current-info
  // pipeline hardening) — a provider that doesn't supply a real value for
  // one simply omits it; nothing here is ever invented downstream.
  // Real published date, only when the provider actually returned one.
  publishedAt?: string;
  modifiedAt?: string;
  // Which SearchProvider produced this result — stamped by searchRouter.ts,
  // not the provider itself, so every result is labeled consistently
  // regardless of which adapter answered.
  provider?: string;
  // Coarse, domain-based classification ("news" | "reference" | "web") —
  // a detectable signal, not a learned/invented judgment. See
  // search/normalize.ts.
  sourceType?: string;
  // 0-1 relevance score, only when the provider actually returns one
  // (e.g. Tavily's own ranking score) — never computed locally.
  relevance?: number;
  // Coarse age bucket ("today" | "this_week" | "this_month" | "older" |
  // "unknown") derived from publishedAt when present. See search/normalize.ts.
  freshness?: string;
}

export interface SearchOptions {
  signal?: AbortSignal;
  maxResults?: number;
}

export interface SearchProvider {
  name: string;
  // Has what it needs to even attempt a search right now (an API key) — not
  // the same thing as healthy, which means it has what it needs but has
  // been failing (see providerHealth.ts, reused as-is for search providers).
  configured(): boolean;
  search(query: string, opts?: SearchOptions): Promise<SearchResultItem[]>;
}
