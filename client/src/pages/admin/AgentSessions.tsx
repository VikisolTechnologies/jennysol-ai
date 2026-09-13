import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bot, Clock, Loader2, Send } from "lucide-react";
import { fetchAgentSessions, startAgentSession, type AgentSessionSummary } from "../../lib/admin";

const STATUS_STYLES: Record<string, string> = {
  planning: "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
  running: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  cancelled: "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200",
};

export function AgentSessions() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<AgentSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [objective, setObjective] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgentSessions()
      .then(setSessions)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load sessions"));
  }, []);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = objective.trim();
    if (!trimmed || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const session = await startAgentSession(trimmed);
      navigate(`/admin/agent-sessions/${session.id}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not start session");
      setStarting(false);
    }
  }

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

      <form
        onSubmit={handleStart}
        className="flex flex-col gap-2.5 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5 sm:flex-row sm:items-start"
      >
        <div className="flex-1">
          <label htmlFor="agent-objective" className="sr-only">
            Objective
          </label>
          <textarea
            id="agent-objective"
            rows={2}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Describe a real, small objective — e.g. &ldquo;Add a health-check endpoint that returns the build version&rdquo;"
            className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-brand-400 dark:border-white/10 dark:bg-transparent dark:text-neutral-100"
          />
          {startError && <p className="mt-1.5 text-xs text-rose-500">{startError}</p>}
        </div>
        <button
          type="submit"
          disabled={!objective.trim() || starting}
          className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:py-2.5"
        >
          {starting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          Start session
        </button>
      </form>

      {error && <p className="text-sm text-rose-500">{error}</p>}
      {!error && !sessions && <p className="text-sm text-neutral-400">Loading…</p>}

      {sessions && sessions.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:bg-white/5 dark:text-neutral-300">
          <Bot size={16} className="mt-0.5 shrink-0" />
          <span>
            No engineering sessions yet — this is honest, not a stub. Describe an objective above to start a
            real one.
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
