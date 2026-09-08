import type { SearchProvider, SearchResultItem } from "./searchProvider.js";

// Tavily is an API purpose-built for exactly this use case (handing an LLM
// current, real-world results), which is why it's the default here — a
// plain REST call, one API key, JSON in/out. Swap or add another provider by
// implementing SearchProvider and registering it in searchRouter.ts; nothing
// else in the app needs to change.
const API_URL = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 6_000;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export const tavilyProvider: SearchProvider = {
  name: "tavily",

  configured(): boolean {
    return !!process.env.TAVILY_API_KEY;
  },

  async search(query, opts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    if (opts?.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          query,
          max_results: opts?.maxResults ?? 5,
          search_depth: "basic",
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const err = new Error(`Tavily search failed (${res.status}): ${detail}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      const data = (await res.json()) as TavilyResponse;
      const results: SearchResultItem[] = (data.results ?? [])
        .filter((r): r is Required<Pick<TavilyResult, "title" | "url">> & TavilyResult => !!r.url)
        .map((r) => {
          let domain: string | undefined;
          try {
            domain = new URL(r.url!).hostname.replace(/^www\./, "");
          } catch {
            domain = undefined;
          }
          return {
            title: r.title || r.url!,
            url: r.url!,
            snippet: (r.content || "").slice(0, 500),
            domain,
          };
        });
      return results;
    } finally {
      clearTimeout(timeout);
    }
  },
};
