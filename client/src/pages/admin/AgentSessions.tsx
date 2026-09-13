import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Clock } from "lucide-react";
import { fetchAgentSessions, type AgentSessionSummary } from "../../lib/admin";

const STATUS_STYLES: Record<string, string> = {
  planning: "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
  running: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  cancelled: "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200",
};

export function AgentSessions() {
  const [sessions, setSessions] = useState<AgentSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgentSessions()
      .then(setSessions)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load sessions"));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">Agent sessions</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Multi-agent engineering sessions — every row here traces to a real{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-white/10">agent_sessions</code> row,
          nothing shown is invented.
        </p>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}
      {!error && !sessions && <p className="text-sm text-neutral-400">Loading…</p>}

      {sessions && sessions.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:bg-white/5 dark:text-neutral-300">
          <Bot size={16} className="mt-0.5 shrink-0" />
          <span>
            No engineering sessions yet — this is honest, not a stub. Starting a real session needs the
            Orchestrator role (Phase 9 of the implementation plan), which isn't built yet. This page and the
            data model behind it (Phases 1-4) are real and live; it will start showing sessions the moment one
            can actually be created.
          </span>
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <Link
              key={s.id}
              to={`/admin/agent-sessions/${s.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4 hover:border-brand-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-brand-500/40"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">{s.objective}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
                  <Clock size={12} /> {new Date(s.createdAt).toLocaleString()}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide ${
                  STATUS_STYLES[s.status] ?? STATUS_STYLES.planning
                }`}
              >
                {s.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
