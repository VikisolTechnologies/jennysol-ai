import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IconLoader2, IconRobot, IconClock, IconSend } from "@tabler/icons-react";
import { fetchAgentSessions, startAgentSession, type AgentSessionSummary } from "../../lib/admin";

// JENNYSOL-UI-BUILD.md §6.2 "Sessions" — RUNNING gold, COMPLETED ok,
// FAILED bad, CANCELLED muted. This page sits inside AdminLayout's shared
// (untouched, out-of-spec) shell, so only its own content adopts the new
// jenny-* tokens — the surrounding sidebar/chrome is deliberately left
// alone (see JENNYSOL-UI-BUILD.md §11, "do not restyle anything outside
// these twelve screens").
const STATUS_STYLES: Record<string, string> = {
  planning: "bg-jenny-raised-2 text-jenny-muted",
  running: "bg-jenny-gold/15 text-jenny-champagne",
  paused: "bg-jenny-warn/15 text-jenny-warn",
  completed: "bg-jenny-ok/15 text-jenny-ok",
  cancelled: "bg-jenny-raised-2 text-jenny-muted",
  failed: "bg-jenny-bad/15 text-jenny-bad",
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
    <div className="-m-6 flex min-h-[calc(var(--app-vh)-0px)] flex-col gap-6 bg-jenny-void p-6 sm:-m-8 sm:p-8">
      <div>
        <p className="text-[10px] tracking-[0.3em] text-jenny-gold">SESSIONS</p>
        <h1 className="mt-1 font-voice text-2xl text-jenny-text">What Jenny did</h1>
        <p className="mt-1.5 text-sm text-jenny-muted">
          Every row here traces to a real <code className="rounded bg-jenny-raised px-1 py-0.5 text-xs">agent_sessions</code> row —
          nothing shown is invented.
        </p>
      </div>

      <form
        onSubmit={handleStart}
        className="flex flex-col gap-2.5 rounded-2xl bg-jenny-raised p-4 sm:flex-row sm:items-start"
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
            className="w-full resize-none rounded-xl bg-jenny-raised-2 px-3 py-2.5 text-sm text-jenny-text outline-none placeholder:text-jenny-dim focus:ring-1 focus:ring-jenny-gold"
          />
          {startError && <p className="mt-1.5 text-xs text-jenny-bad">{startError}</p>}
        </div>
        <button
          type="submit"
          disabled={!objective.trim() || starting}
          className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-jenny-gold px-4 py-3 text-sm font-semibold text-jenny-ink-on-gold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:py-2.5"
        >
          {starting ? <IconLoader2 size={16} className="animate-spin" /> : <IconSend size={16} />}
          Start session
        </button>
      </form>

      {error && <p className="text-sm text-jenny-bad">{error}</p>}
      {!error && !sessions && <p className="text-sm text-jenny-dim">Loading…</p>}

      {sessions && sessions.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-jenny-border bg-jenny-raised px-4 py-3 text-sm text-jenny-text-3">
          <IconRobot size={16} className="mt-0.5 shrink-0" />
          <span>No engineering sessions yet — this is honest, not a stub. Describe an objective above to start a real one.</span>
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <Link
              key={s.id}
              to={`/admin/agent-sessions/${s.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl bg-jenny-raised p-4 transition hover:bg-jenny-raised-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-jenny-text">{s.objective}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-jenny-dim">
                  <IconClock size={12} /> {new Date(s.createdAt).toLocaleString()}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[s.status] ?? STATUS_STYLES.planning}`}>
                {s.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
