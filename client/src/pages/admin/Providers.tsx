import { useEffect, useState } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import {
  fetchProviderHealth,
  fetchRequestMetrics,
  type OllamaModelInfo,
  type HardwareSnapshot,
  type ProviderRouteStatus,
  type ProviderStats,
  type WindowSummary,
} from "../../lib/admin";

type ProviderRow = ProviderRouteStatus & { health: (ProviderStats & { healthy: boolean }) | null };

function statusDot(row: ProviderRow): { color: string; label: string } {
  if (!row.configured) return { color: "bg-jenny-faint", label: "not configured" };
  if (!row.health) return { color: "bg-jenny-dim", label: "no traffic yet" };
  if (!row.health.healthy) return { color: "bg-jenny-bad", label: "unhealthy" };
  if (row.health.consecutiveFailures > 0) return { color: "bg-jenny-warn", label: "degraded" };
  return { color: "bg-jenny-ok", label: "healthy" };
}

function ms(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}ms`;
}

// JENNYSOL-UI-BUILD.md §6.5 "Providers" — real data end to end: this page
// adds no new backend, it's a restyled client for the /provider-health and
// /request-metrics routes server/src/routes/admin.ts already exposes (built
// for JENNYSOL-LOCAL-CUTOVER.md's own "you cannot decide what you cannot
// see"). One real gap, stated rather than invented: neither route tracks a
// live "resident model" flag or an "evictions today" counter (see this
// session's own eviction-policy findings in JENNY_VISION_MODEL_EVALUATION.md)
// — the doc's "resident model count, evictions today" line is left out
// rather than filled with a fabricated number; the installed-models list is
// shown instead, correctly labeled as installed, not resident.
export function Providers() {
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [metrics, setMetrics] = useState<WindowSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [health, reqMetrics] = await Promise.all([fetchProviderHealth(), fetchRequestMetrics()]);
        if (cancelled) return;
        setRows(health.providers);
        setHardware(health.hardware);
        setOllamaModels(health.ollamaModels);
        setMetrics(reqMetrics.last24h);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load provider health");
      }
    }
    load();
    const interval = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const localRows = rows?.filter((r) => r.name === "ollama") ?? [];
  const primary = rows?.find((r) => r.inActiveChain);
  const localP95 = metrics?.byProvider?.ollama?.p95FirstTokenMs ?? null;

  return (
    <div className="-m-6 flex min-h-[calc(var(--app-vh)-0px)] flex-col gap-6 bg-jenny-void p-6 sm:-m-8 sm:p-8">
      <div>
        <p className="text-[10px] tracking-[0.25em] text-jenny-gold">PROVIDERS · LAST 24H</p>
        <h1 className="mt-1 font-voice text-2xl text-jenny-text">Where answers come from</h1>
      </div>

      {error && <p className="text-sm text-jenny-bad">{error}</p>}
      {!error && !rows && <p className="text-sm text-jenny-dim">Loading…</p>}

      {rows && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((row) => {
            const dot = statusDot(row);
            const roleLabel = row.inActiveChain ? (row === primary ? "PRIMARY" : "ACTIVE") : "FALLBACK";
            const stats = metrics?.byProvider?.[row.name];
            return (
              <div key={row.name} className="rounded-2xl bg-jenny-raised p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-jenny-text">{row.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      roleLabel === "PRIMARY" ? "bg-jenny-gold/15 text-jenny-champagne" : "bg-jenny-raised-2 text-jenny-muted"
                    }`}
                  >
                    {roleLabel}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${dot.color}`} />
                  <span className="text-xs text-jenny-muted">{dot.label}</span>
                </div>

                {!row.configured ? (
                  <p className="mt-3 text-xs font-medium text-jenny-bad">NO API KEY</p>
                ) : (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="font-voice text-lg text-jenny-text">{ms(stats?.p50FirstTokenMs ?? null)}</p>
                      <p className="text-[10px] uppercase tracking-wide text-jenny-faint">P50 TTFT</p>
                    </div>
                    <div>
                      <p className="font-voice text-lg text-jenny-text">{ms(stats?.p95FirstTokenMs ?? null)}</p>
                      <p className="text-[10px] uppercase tracking-wide text-jenny-faint">P95</p>
                    </div>
                    <div>
                      <p className="font-voice text-lg text-jenny-text">
                        {stats ? `${Math.round(stats.errorRate * 100)}%` : "—"}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-jenny-faint">Errors</p>
                    </div>
                  </div>
                )}

                {row.name === "ollama" && hardware && (
                  <p className="mt-3 border-t border-jenny-hairline-card pt-2.5 text-[11px] text-jenny-dim">
                    {hardware.profile.label} · {hardware.freeMemoryGb}GB free of {hardware.totalMemoryGb}GB ·{" "}
                    {ollamaModels.length} model{ollamaModels.length === 1 ? "" : "s"} installed (not necessarily
                    resident — live residency isn&rsquo;t tracked yet)
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* §6.5: "Close with a verdict block ... stating a conclusion in
          plain words, not just numbers." Real, computed from the actual
          local P95 above, not a canned line — and honest when there isn't
          enough real traffic yet to have a verdict at all. */}
      {rows && localRows.length > 0 && (
        <section className="rounded-2xl border-2 border-jenny-gold bg-jenny-ink-on-gold p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-jenny-champagne">
            <IconAlertTriangle size={16} /> Verdict
          </h3>
          <p className="mt-2 text-sm text-jenny-text-2">
            {localP95 === null
              ? "Not enough real local traffic in the last 24h to render a verdict — this isn't a placeholder, there's genuinely nothing to measure yet."
              : localP95 > 15000
                ? `Local P95 is ${(localP95 / 1000).toFixed(1)}s. Not ready to promote to primary.`
                : `Local P95 is ${(localP95 / 1000).toFixed(1)}s — within a reasonable range for an interactive reply.`}
          </p>
        </section>
      )}
    </div>
  );
}
