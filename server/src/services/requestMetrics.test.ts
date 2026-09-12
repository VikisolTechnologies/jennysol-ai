import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordRequest, getMetricsSummary, __resetMetricsForTests } from "./requestMetrics.js";

beforeEach(() => {
  __resetMetricsForTests();
});

function baseRecord(overrides: Partial<Parameters<typeof recordRequest>[0]> = {}) {
  recordRequest({
    timestamp: Date.now(),
    provider: "ollama",
    taskCapability: "general",
    fellBack: false,
    firstTokenMs: 100,
    totalMs: 500,
    promptTokens: 10,
    completionTokens: 5,
    tokensEstimated: false,
    wasWarm: true,
    outcome: "success",
    ...overrides,
  });
}

describe("getMetricsSummary", () => {
  it("counts requests and computes fallback/error rate per provider", () => {
    baseRecord({ provider: "gemini", fellBack: false, outcome: "success" });
    baseRecord({ provider: "gemini", fellBack: false, outcome: "success" });
    baseRecord({ provider: "gemini", fellBack: true, outcome: "success" });
    baseRecord({ provider: "gemini", outcome: "error", errorKind: "503" });

    const summary = getMetricsSummary(60 * 60 * 1000);
    expect(summary.totalRequests).toBe(4);
    expect(summary.byProvider.gemini.requestCount).toBe(4);
    expect(summary.byProvider.gemini.fallbackCount).toBe(1);
    expect(summary.byProvider.gemini.fallbackRate).toBeCloseTo(0.25);
    expect(summary.byProvider.gemini.errorCount).toBe(1);
    expect(summary.byProvider.gemini.errorRate).toBeCloseTo(0.25);
  });

  it("keeps providers separate", () => {
    baseRecord({ provider: "gemini" });
    baseRecord({ provider: "ollama" });
    baseRecord({ provider: "ollama" });

    const summary = getMetricsSummary(60 * 60 * 1000);
    expect(summary.byProvider.gemini.requestCount).toBe(1);
    expect(summary.byProvider.ollama.requestCount).toBe(2);
  });

  it("computes p50/p95/p99 first-token latency from real values only", () => {
    for (const ms of [100, 200, 300, 400, 500]) {
      baseRecord({ provider: "ollama", firstTokenMs: ms });
    }
    baseRecord({ provider: "ollama", firstTokenMs: null }); // must not skew percentiles

    const summary = getMetricsSummary(60 * 60 * 1000);
    const p = summary.byProvider.ollama;
    expect(p.p50FirstTokenMs).toBe(300);
    expect(p.p99FirstTokenMs).toBe(500);
  });

  it("excludes records outside the requested window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    baseRecord({ provider: "ollama" });

    vi.setSystemTime(new Date("2026-01-01T02:00:00Z")); // 2h later
    baseRecord({ provider: "ollama" });

    const lastHour = getMetricsSummary(60 * 60 * 1000);
    expect(lastHour.totalRequests).toBe(1);

    const last3h = getMetricsSummary(3 * 60 * 60 * 1000);
    expect(last3h.totalRequests).toBe(2);
    vi.useRealTimers();
  });

  it("returns an empty summary when nothing has been recorded", () => {
    const summary = getMetricsSummary(60 * 60 * 1000);
    expect(summary.totalRequests).toBe(0);
    expect(summary.byProvider).toEqual({});
  });
});
