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
