// In-memory only, same deliberate tradeoff as providerHealth.ts: a single
// Railway instance's own recent request history, not persisted, not shared
// across instances. Good enough for "is the local path stable enough to
// trust with more traffic" judgment calls — not an audit log, not billing
// data (see JENNY_MODEL_FLEET.md / COST-BASELINE.md for why token counts
// here are sometimes estimates, never invoiced amounts).
export interface RequestRecord {
  timestamp: number;
  provider: string;
  model?: string;
  taskCapability: string;
  fellBack: boolean;
  firstTokenMs: number | null;
  totalMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  tokensEstimated: boolean | null;
  wasWarm: boolean | null;
  outcome: "success" | "error";
  errorKind?: string;
}

const MAX_RECORDS = 5000;
const records: RequestRecord[] = [];

export function recordRequest(rec: RequestRecord): void {
  records.push(rec);
  if (records.length > MAX_RECORDS) records.shift();
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

export interface ProviderWindowSummary {
  requestCount: number;
  fallbackCount: number;
  fallbackRate: number;
  errorCount: number;
  errorRate: number;
  p50FirstTokenMs: number | null;
  p95FirstTokenMs: number | null;
  p99FirstTokenMs: number | null;
}

export interface WindowSummary {
  windowMs: number;
  totalRequests: number;
  byProvider: Record<string, ProviderWindowSummary>;
}

// Judgement data, not a dashboard — deliberately a plain synchronous
// snapshot computed on request rather than a background aggregation job,
// since MAX_RECORDS bounds this to a cheap linear scan.
export function getMetricsSummary(windowMs: number): WindowSummary {
  const cutoff = Date.now() - windowMs;
  const inWindow = records.filter((r) => r.timestamp >= cutoff);
  const byProvider: Record<string, ProviderWindowSummary> = {};

  for (const provider of new Set(inWindow.map((r) => r.provider))) {
    const forProvider = inWindow.filter((r) => r.provider === provider);
    const fallbackCount = forProvider.filter((r) => r.fellBack).length;
    const errorCount = forProvider.filter((r) => r.outcome === "error").length;
    const ttfts = forProvider
      .map((r) => r.firstTokenMs)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    byProvider[provider] = {
      requestCount: forProvider.length,
      fallbackCount,
      fallbackRate: forProvider.length ? fallbackCount / forProvider.length : 0,
      errorCount,
      errorRate: forProvider.length ? errorCount / forProvider.length : 0,
      p50FirstTokenMs: percentile(ttfts, 0.5),
      p95FirstTokenMs: percentile(ttfts, 0.95),
      p99FirstTokenMs: percentile(ttfts, 0.99),
    };
  }

  return { windowMs, totalRequests: inWindow.length, byProvider };
}

export function __resetMetricsForTests(): void {
  records.length = 0;
}
