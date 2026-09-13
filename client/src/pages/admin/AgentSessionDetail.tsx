import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  fetchAgentSessionDetail,
  fetchAgentSessionEvents,
  type AgentRow,
  type AgentSessionSummary,
  type AgentTaskRow,
  type SessionEventRow,
  type SessionMemoryEntryRow,
} from "../../lib/admin";

// Polling, not SSE, for now — deliberate: this page has real, live-server-backed data to render
// from the moment a session exists (Phases 1-4), but the SSE multiplexing design (Phase 13 of
// docs/AI_AGENT_IMPLEMENTATION_PLAN.md) is real work of its own, sequenced for once there are many
// phases' worth of real traffic to test it against. A 3s poll against the same real, durable
// agent_session_events table is honest today and swaps for a live connection later without this
// page's rendering logic changing at all — every element here still traces to a real event row,
// never invented client-side state.
const POLL_MS = 3000;

const TASK_STATUS_STYLES: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
  ready: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
  queued: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
  running: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200",
  blocked: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200",
  cancelled: "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
};

function formatEventLine(event: SessionEventRow): string {
  // Human-readable line per event, matching the activity-feed shape architecture doc §8 describes —
  // a plain fallback (type + payload) until each real role/tool phase gives specific events a
  // richer template.
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : null;
  const detail = payload ? Object.entries(payload).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ") : "";
  return `${event.type}${detail ? " — " + detail : ""}`;
}

export function AgentSessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<AgentSessionSummary | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [tasks, setTasks] = useState<AgentTaskRow[]>([]);
  const [memory, setMemory] = useState<SessionMemoryEntryRow[]>([]);
  const [events, setEvents] = useState<SessionEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastEventId = useRef(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    fetchAgentSessionDetail(id)
      .then((data) => {
        if (cancelled) return;
        setSession(data.session);
        setAgents(data.agents);
        setTasks(data.tasks);
        setMemory(data.memory);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load session"));

    const poll = async () => {
      try {
        const fresh = await fetchAgentSessionEvents(id, lastEventId.current);
        if (cancelled || fresh.length === 0) return;
        lastEventId.current = fresh[fresh.length - 1].id;
        setEvents((prev) => [...prev, ...fresh]);
        // Session/agents/tasks may have changed as a side effect of whatever produced these events —
        // re-fetch the current snapshot rather than trying to derive it client-side from event
        // payloads, which is exactly the drift architecture doc §3 warns against.
        const data = await fetchAgentSessionDetail(id);
        if (!cancelled) {
          setSession(data.session);
          setAgents(data.agents);
          setTasks(data.tasks);
          setMemory(data.memory);
        }
      } catch {
        // A transient poll failure isn't a page-level error — the next tick retries.
      }
    };
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id]);

  if (error) return <p className="text-sm text-rose-500">{error}</p>;
  if (!session) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/admin/agent-sessions"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-500 dark:text-neutral-400"
      >
        <ArrowLeft size={14} /> Back to sessions
      </Link>

      <div>
        <h1 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">{session.objective}</h1>
        <p className="mt-1 text-xs text-neutral-400">
          {session.status} · started {new Date(session.createdAt).toLocaleString()}
          {session.completedAt && ` · completed ${new Date(session.completedAt).toLocaleString()}`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Agents ({agents.length})
          </h3>
          {agents.length === 0 ? (
            <p className="text-xs text-neutral-400">No agents spawned yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {agents.map((a) => (
                <li key={a.id} className="rounded-lg border border-neutral-100 p-2 text-xs dark:border-white/10">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-neutral-700 dark:text-neutral-200">{a.displayName}</span>
                    <span className="text-neutral-400">{a.status}</span>
                  </div>
                  <p className="mt-0.5 text-neutral-400">
                    {a.modelProvider ?? "no model yet"} · {a.tokensUsed} tokens
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Tasks ({tasks.filter((t) => t.status === "completed").length}/{tasks.length})
          </h3>
          {tasks.length === 0 ? (
            <p className="text-xs text-neutral-400">No tasks yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-100 p-2 text-xs dark:border-white/10">
                  <span className="truncate text-neutral-700 dark:text-neutral-200">{t.title}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      TASK_STATUS_STYLES[t.status] ?? TASK_STATUS_STYLES.pending
                    }`}
                  >
                    {t.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Memory ({memory.length} keys)
          </h3>
          {memory.length === 0 ? (
            <p className="text-xs text-neutral-400">No shared memory written yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {memory.map((m) => (
                <li key={m.key} className="rounded-lg border border-neutral-100 p-2 text-xs dark:border-white/10">
                  <span className="font-medium text-neutral-700 dark:text-neutral-200">{m.key}</span>
                  <p className="mt-0.5 truncate text-neutral-400">{JSON.stringify(m.value)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Activity</h3>
        {events.length === 0 ? (
          <p className="text-xs text-neutral-400">No events yet — polling every {POLL_MS / 1000}s.</p>
        ) : (
          <ul className="flex flex-col gap-1 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
            {events.map((e) => (
              <li key={e.id}>
                <span className="text-neutral-300 dark:text-neutral-600">{new Date(e.createdAt).toLocaleTimeString()}</span>{" "}
                {formatEventLine(e)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
