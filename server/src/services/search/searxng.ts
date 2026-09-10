import type { SearchProvider, SearchResultItem } from "./searchProvider.js";

// SearXNG (self-hosted, open-source metasearch — searxng.org) is what makes
// search genuinely free/self-hosted rather than dependent on a paid or
// card-gated API: no per-query cost, no vendor account. Inert by default —
// configured() is false until SEARXNG_BASE_URL is actually set, exactly
// like tavily.ts's TAVILY_API_KEY check, so adding this file changes no
// runtime behavior for anyone who hasn't stood up an instance.
//
// This does NOT include deploying a SearXNG instance — that's a real piece
// of infrastructure (a container, a place to run it, and per SearXNG's own
// docs, it should never be exposed to the public internet unimodified) and
// is documented as a setup step in docs/JENNYSOL_FREE_FIRST_ARCHITECTURE.md
// rather than done here without confirmation, since standing up a new
// network service has cost/security implications this file alone doesn't.
const DEFAULT_TIMEOUT_MS = 6_000;

interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
  publishedDate?: string;
}

interface SearxngResponse {
  results?: SearxngResult[];
}

export const searxngProvider: SearchProvider = {
  name: "searxng",

  configured(): boolean {
    return !!process.env.SEARXNG_BASE_URL;
  },

  async search(query, opts) {
    const base = process.env.SEARXNG_BASE_URL!.replace(/\/$/, "");
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    if (opts?.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const err = new Error(`SearXNG search failed (${res.status}): ${detail}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      const data = (await res.json()) as SearxngResponse;
      const maxResults = opts?.maxResults ?? 5;
      return (data.results ?? [])
        .filter((r): r is Required<Pick<SearxngResult, "url">> & SearxngResult => !!r.url)
        .slice(0, maxResults)
        .map((r) => {
          let domain: string | undefined;
          try {
            domain = new URL(r.url!).hostname.replace(/^www\./, "");
          } catch {
            domain = undefined;
          }
          // publishedDate is genuinely inconsistent across SearXNG's
          // underlying engines (some scraped result pages expose it, most
          // don't) — set only when present rather than faked.
          const snippet = r.publishedDate ? `[${r.publishedDate}] ${r.content ?? ""}` : r.content ?? "";
          return {
            title: r.title || r.url!,
            url: r.url!,
            snippet: snippet.slice(0, 500),
            domain,
            publishedAt: r.publishedDate || undefined,
          };
        });
    } finally {
      clearTimeout(timeout);
    }
  },
};
