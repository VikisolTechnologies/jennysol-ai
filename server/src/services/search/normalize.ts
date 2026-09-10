// Lightweight, detectable-signal source-quality/freshness normalization —
// deliberately NOT a learned classifier or an NLP conflict-detector (see
// docs/CURRENT_INFORMATION_ARCHITECTURE.md's own stated reasoning: building
// that kind of machinery with no real usage data to validate it against is
// speculative complexity). This does two honest, mechanical things: (1)
// stamps which provider actually produced each result and a coarse
// sourceType from its domain — both real signals already available; (2)
// buckets freshness from a real publishedAt date, only when the provider
// actually supplied one — never invented when it didn't. Judgment calls
// that genuinely need reasoning (do these sources actually conflict, which
// one should win) are left to the model, given this metadata explicitly —
// see llm.ts's search-results persona instruction.
import type { SearchResultItem } from "./searchProvider.js";

const NEWS_DOMAINS = new Set([
  "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "cnn.com", "nytimes.com",
  "wsj.com", "bloomberg.com", "theguardian.com", "npr.org", "aljazeera.com",
  "techcrunch.com", "theverge.com", "arstechnica.com", "wired.com", "engadget.com",
  "cnbc.com", "forbes.com", "axios.com", "politico.com", "ft.com",
]);

const REFERENCE_DOMAINS = new Set(["wikipedia.org", "britannica.com", "who.int", "un.org"]);

function classifySourceType(domain: string | undefined): string {
  if (!domain) return "web";
  const bare = domain.replace(/^www\./, "");
  if (NEWS_DOMAINS.has(bare)) return "news";
  if (REFERENCE_DOMAINS.has(bare) || bare.endsWith(".gov") || bare.endsWith(".edu")) return "reference";
  return "web";
}

function classifyFreshness(publishedAt: string | undefined): string {
  if (!publishedAt) return "unknown";
  const parsed = new Date(publishedAt);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  const ageMs = Date.now() - parsed.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (ageMs < 0) return "unknown"; // future-dated — not a trustworthy freshness signal
  if (ageMs <= day) return "today";
  if (ageMs <= 7 * day) return "this_week";
  if (ageMs <= 30 * day) return "this_month";
  return "older";
}

export function normalizeResults(results: SearchResultItem[], provider: string): SearchResultItem[] {
  return results.map((r) => ({
    ...r,
    provider,
    sourceType: r.sourceType ?? classifySourceType(r.domain),
    freshness: r.freshness ?? classifyFreshness(r.publishedAt),
  }));
}
