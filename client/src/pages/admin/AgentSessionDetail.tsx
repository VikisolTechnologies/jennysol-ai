import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  FileEdit,
  Loader2,
  Pause,
  Play,
  Skull,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import {
  approveAgentAction,
  cancelAgentSession,
  fetchAgentSessionDetail,
  fetchPendingActions,
  killAgent,
  pauseAgentSession,
  rejectAgentAction,
  resumeAgentSession,
  streamAgentSessionEvents,
  type AgentRow,
  type AgentSessionSummary,
  type AgentTaskRow,
  type PendingAgentActionRow,
  type SessionEventRow,
  type SessionMemoryEntryRow,
} from "../../lib/admin";

const TASK_STATUS_STYLES: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
  ready: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
  queued: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
  running: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200",
  blocked: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  awaiting_approval: "bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-100",
  completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200",
  cancelled: "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
};

const SESSION_STATUS_STYLES: Record<string, string> = {
  planning: "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
  running: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  cancelled: "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200",
};

function formatEventLine(event: SessionEventRow): string {
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : null;
  const detail = payload ? Object.entries(payload).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ") : "";
  return `${event.type}${detail ? " — " + detail : ""}`;
}

function elapsed(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "";
  const start = new Date(startedAt.replace(" ", "T") + "Z").getTime();
  const end = completedAt ? new Date(completedAt.replace(" ", "T") + "Z").getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

interface ArtifactRow {
  id: number;
  createdAt: string;
  kind: "file.write" | "exec.command";
  ok: boolean;
  filePath?: string;
  command?: string;
  args?: string[];
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

// The real, sole source of truth (architecture doc §3/§8): every artifact shown here is a real
// tool.exec.finished event this session actually produced — nothing derived or guessed client-side.
function extractArtifacts(events: SessionEventRow[]): ArtifactRow[] {
  const rows: ArtifactRow[] = [];
  for (const e of events) {
    if (e.type !== "tool.exec.finished") continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (p.tool === "file.write") {
      rows.push({ id: e.id, createdAt: e.createdAt, kind: "file.write", ok: !!p.ok, filePath: p.filePath as string });
    } else if (p.tool === "exec.command") {
      rows.push({
        id: e.id,
        createdAt: e.createdAt,
        kind: "exec.command",
        ok: !!p.ok,
        command: p.command as string,
        args: p.args as string[] | undefined,
        exitCode: (p.exitCode as number | null | undefined) ?? null,
        stdout: p.stdout as string | undefined,
        stderr: p.stderr as string | undefined,
      });
    }
  }
  return rows;
}

export function AgentSessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<AgentSessionSummary | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [tasks, setTasks] = useState<AgentTaskRow[]>([]);
  const [memory, setMemory] = useState<SessionMemoryEntryRow[]>([]);
  const [events, setEvents] = useState<SessionEventRow[]>([]);
  const [pending, setPending] = useState<PendingAgentActionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [controlBusy, setControlBusy] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const lastEventId = useRef(0);
  const [, forceTick] = useState(0);

  const refetch = useCallback(async (sessionId: string) => {
    const [detail, pendingActions] = await Promise.all([
      fetchAgentSessionDetail(sessionId),
      fetchPendingActions(sessionId).catch(() => []),
    ]);
    setSession(detail.session);
    setAgents(detail.agents);
    setTasks(detail.tasks);
    setMemory(detail.memory);
    setPending(pendingActions);
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    fetchAgentSessionDetail(id)
      .then((data) => {
        if (cancelled) return;
        setSession(data.session);
        setAgents(data.agents);
        setTasks(data.tasks);
        setMemory(data.memory);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load session"));
    fetchPendingActions(id)
      .then((a) => !cancelled && setPending(a))
      .catch(() => {});

    function connect() {
      if (cancelled) return;
      controller = new AbortController();
      setConnected(true);
      streamAgentSessionEvents(id!, lastEventId.current, (event) => {
        if (cancelled) return;
        lastEventId.current = event.id;
        setEvents((prev) => [...prev, event]);
        // Re-fetch the current snapshot rather than deriving it from the event payload — the
        // established rule this page has followed since the polling-only shell (architecture doc §3).
        refetch(id!).catch(() => {});
      }, controller.signal)
        .catch(() => {
          // A real connection drop (network blip, server restart) — not our own abort.
        })
        .finally(() => {
          if (cancelled) return;
          setConnected(false);
          retryTimer = setTimeout(connect, 3000);
        });
    }
    connect();

    return () => {
      cancelled = true;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [id, refetch]);

  // Live-ticking elapsed times (running tasks/session) need a re-render even with no new event.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleControl(action: "pause" | "resume" | "cancel") {
    if (!id || controlBusy) return;
    setControlBusy(action);
    try {
      if (action === "pause") await pauseAgentSession(id);
      else if (action === "resume") await resumeAgentSession(id);
      else await cancelAgentSession(id);
      await refetch(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} session`);
    } finally {
      setControlBusy(null);
    }
  }

  async function handleKill(agentId: string) {
    if (!id) return;
    setControlBusy(`kill:${agentId}`);
    try {
      await killAgent(id, agentId);
      await refetch(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not kill agent");
    } finally {
      setControlBusy(null);
    }
  }

  async function decide(actionId: string, kind: "approve" | "reject") {
    if (!id) return;
    setDeciding(actionId);
    try {
      if (kind === "approve") await approveAgentAction(actionId);
      else await rejectAgentAction(actionId);
      await refetch(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not decide");
    } finally {
      setDeciding(null);
    }
  }

  if (error && !session) return <p className="text-sm text-rose-500">{error}</p>;
  if (!session) return <p className="text-sm text-neutral-400">Loading…</p>;

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const blockedOrWaiting = tasks.filter((t) => t.status === "awaiting_approval" || t.status === "blocked");
  const totalTokens = agents.reduce((sum, a) => sum + a.tokensUsed, 0);
  const artifacts = extractArtifacts(events);
  const isActive = session.status === "running" || session.status === "planning" || session.status === "paused";

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/admin/agent-sessions"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-500 dark:text-neutral-400"
      >
        <ArrowLeft size={14} /> Back to sessions
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">{session.objective}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                SESSION_STATUS_STYLES[session.status] ?? SESSION_STATUS_STYLES.planning
              }`}
            >
              {session.status}
            </span>
            <span>{connected ? "live" : "reconnecting…"}</span>
            <span>· started {new Date(session.createdAt).toLocaleString()}</span>
            <span>· elapsed {elapsed(session.createdAt, session.completedAt)}</span>
            <span>· {totalTokens} tokens used (cost not tracked — no per-model price table exists yet)</span>
          </p>
        </div>

        {isActive && (
          <div className="flex shrink-0 gap-2">
            {session.status === "paused" ? (
              <button
                type="button"
                onClick={() => handleControl("resume")}
                disabled={!!controlBusy}
                className="flex items-center gap-1.5 rounded-xl bg-brand-500 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
              >
                {controlBusy === "resume" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Resume
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleControl("pause")}
                disabled={!!controlBusy}
                className="flex items-center gap-1.5 rounded-xl border border-neutral-200 px-3.5 py-2.5 text-xs font-semibold text-neutral-600 transition hover:border-amber-300 hover:text-amber-700 disabled:opacity-50 dark:border-white/10 dark:text-neutral-300"
              >
                {controlBusy === "pause" ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />} Pause
              </button>
            )}
            <button
              type="button"
              onClick={() => handleControl("cancel")}
              disabled={!!controlBusy}
              className="flex items-center gap-1.5 rounded-xl border border-rose-200 px-3.5 py-2.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
            >
              {controlBusy === "cancel" ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Cancel
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {/* Stage B §2.3: the single most important state in the system, made unmissable. */}
      {(blockedOrWaiting.length > 0 || pending.length > 0) && (
        <section className="rounded-2xl border-2 border-amber-300 bg-amber-50/50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-200">
            <AlertTriangle size={16} /> Waiting on you ({pending.length || blockedOrWaiting.length})
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {pending.map((a) => (
              <li key={a.id} className="rounded-xl border border-amber-200 bg-white p-3 dark:border-amber-500/30 dark:bg-black/20">
                {a.toolName === "file.write" ? (
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                      <FileEdit size={14} className="text-brand-500" /> Write{" "}
                      <code className="font-mono">{String(a.args.filePath ?? "?")}</code>
                    </p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-2 font-mono text-[11px] text-neutral-600 dark:bg-black/30 dark:text-neutral-300">
                      {String(a.args.content ?? "")}
                    </pre>
                  </div>
                ) : (
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                      <Terminal size={14} className="text-brand-500" /> Run a command
                    </p>
                    <pre className="mt-2 overflow-auto rounded-lg bg-neutral-50 p-2 font-mono text-[11px] text-neutral-600 dark:bg-black/30 dark:text-neutral-300">
                      cd {String(a.args.cwd ?? ".")} && {String(a.args.command ?? "?")}{" "}
                      {Array.isArray(a.args.args) ? (a.args.args as unknown[]).join(" ") : ""}
                    </pre>
                  </div>
                )}
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => decide(a.id, "approve")}
                    disabled={!!deciding}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50 sm:flex-none sm:px-5"
                  >
                    {deciding === a.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(a.id, "reject")}
                    disabled={!!deciding}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-600 py-2.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50 sm:flex-none sm:px-5"
                  >
                    {deciding === a.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Reject
                  </button>
                </div>
              </li>
            ))}
            {pending.length === 0 &&
              blockedOrWaiting.map((t) => (
                <li key={t.id} className="text-xs text-amber-700 dark:text-amber-200">
                  <code className="font-mono">{t.title}</code> is {t.status.replace("_", " ")}
                  {t.agentId && agentById.get(t.agentId) ? ` (${agentById.get(t.agentId)!.displayName})` : ""}
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Agents ({agents.length})
          </h3>
          {agents.length === 0 ? (
            <p className="text-xs text-neutral-400">No agents spawned yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {agents.map((a) => {
                const killable = a.status !== "cancelled" && a.status !== "completed" && a.status !== "failed";
                return (
                  <li key={a.id} className="rounded-lg border border-neutral-100 p-2 text-xs dark:border-white/10">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-neutral-700 dark:text-neutral-200">{a.displayName}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-neutral-400">{a.status}</span>
                        {killable && (
                          <button
                            type="button"
                            title="Kill this agent"
                            onClick={() => handleKill(a.id)}
                            disabled={!!controlBusy}
                            className="rounded-md p-1 text-neutral-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-500/10"
                          >
                            {controlBusy === `kill:${a.id}` ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Skull size={12} />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-0.5 text-neutral-400">
                      {a.modelProvider ?? "no model yet"} · {a.tokensUsed} tokens
                    </p>
                  </li>
                );
              })}
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
                <li key={t.id} className="rounded-lg border border-neutral-100 p-2 text-xs dark:border-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-neutral-700 dark:text-neutral-200">{t.title}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        TASK_STATUS_STYLES[t.status] ?? TASK_STATUS_STYLES.pending
                      }`}
                    >
                      {t.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-neutral-400">
                    {t.startedAt && <span>{elapsed(t.startedAt, t.completedAt)}</span>}
                    {t.dependsOn.length > 0 && (
                      <span>
                        depends on: {t.dependsOn.map((depId) => taskById.get(depId)?.title ?? depId).join(", ")}
                      </span>
                    )}
                  </p>
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
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Artifacts ({artifacts.length})
        </h3>
        {artifacts.length === 0 ? (
          <p className="text-xs text-neutral-400">Nothing written or run yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {artifacts.map((a) => (
              <li key={a.id} className="rounded-lg border border-neutral-100 p-2.5 text-xs dark:border-white/10">
                <div className="flex items-center gap-1.5">
                  {a.kind === "file.write" ? (
                    <FileEdit size={13} className="shrink-0 text-brand-500" />
                  ) : (
                    <Terminal size={13} className="shrink-0 text-brand-500" />
                  )}
                  {a.kind === "file.write" ? (
                    <code className="truncate font-mono text-neutral-700 dark:text-neutral-200">{a.filePath}</code>
                  ) : (
                    <code className="truncate font-mono text-neutral-700 dark:text-neutral-200">
                      {a.command} {a.args?.join(" ")}
                    </code>
                  )}
                  <span
                    className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                      a.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200"
                    }`}
                  >
                    {a.kind === "exec.command" ? `exit ${a.exitCode}` : a.ok ? "written" : "failed"}
                  </span>
                </div>
                {(a.stdout || a.stderr) && (
                  <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-2 font-mono text-[10px] text-neutral-500 dark:bg-black/30 dark:text-neutral-400">
                    {a.stdout}
                    {a.stderr}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Activity</h3>
        {events.length === 0 ? (
          <p className="text-xs text-neutral-400">No events yet.</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-auto font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
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
