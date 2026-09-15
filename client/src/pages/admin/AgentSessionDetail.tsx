import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  IconArrowLeft,
  IconAlertTriangle,
  IconCheck,
  IconFileText,
  IconLoader2,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSkull,
  IconTerminal2,
  IconX,
  IconPlayerStop,
} from "@tabler/icons-react";
import {
  approveAgentAction,
  cancelAgentSession,
  fetchAgentSessionDetail,
  fetchPendingActions,
  killAgent,
  pauseAgentSession,
  rejectAgentAction,
  resumeAgentSession,
  retryTask,
  streamAgentSessionEvents,
  type AgentRow,
  type AgentSessionSummary,
  type AgentTaskRow,
  type PendingAgentActionRow,
  type SessionEventRow,
  type SessionMemoryEntryRow,
} from "../../lib/admin";

// JENNYSOL-UI-BUILD.md §6.3 "Run view" — completed nodes dim to muted, the
// running node stays text-colored with a gold outline; §6.2's RUNNING
// gold / COMPLETED ok / FAILED bad / CANCELLED muted carries over here too.
const TASK_STATUS_STYLES: Record<string, string> = {
  pending: "bg-jenny-raised-2 text-jenny-muted",
  ready: "bg-jenny-champagne/15 text-jenny-champagne",
  queued: "bg-jenny-champagne/15 text-jenny-champagne",
  running: "bg-jenny-gold/15 text-jenny-gold",
  blocked: "bg-jenny-warn/15 text-jenny-warn",
  awaiting_approval: "bg-jenny-gold/20 text-jenny-champagne",
  completed: "bg-jenny-ok/15 text-jenny-ok",
  failed: "bg-jenny-bad/15 text-jenny-bad",
  cancelled: "bg-jenny-raised-2 text-jenny-muted",
};

const SESSION_STATUS_STYLES: Record<string, string> = {
  planning: "bg-jenny-raised-2 text-jenny-muted",
  running: "bg-jenny-gold/15 text-jenny-champagne",
  paused: "bg-jenny-warn/15 text-jenny-warn",
  completed: "bg-jenny-ok/15 text-jenny-ok",
  cancelled: "bg-jenny-raised-2 text-jenny-muted",
  failed: "bg-jenny-bad/15 text-jenny-bad",
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

interface VisualQaResult {
  verdict: "pass" | "concerns";
  findings: string[];
  screenshotBase64: string;
}
function isVisualQaResult(result: unknown): result is VisualQaResult {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  return typeof r.screenshotBase64 === "string" && (r.verdict === "pass" || r.verdict === "concerns");
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
  // Visual QA §6.6 "Confirm/Dismiss actions per finding" — ephemeral,
  // client-only review state (a checked-off box, not a persisted decision):
  // there is no real backend endpoint for "this finding was reviewed", and
  // inventing one just to make this toggle survive a reload would be
  // exactly the fabricated-capability failure mode this whole build avoids
  // everywhere else. Resets on refresh/navigation, honestly.
  const [reviewedFindings, setReviewedFindings] = useState<Set<string>>(new Set());
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

  async function handleRetry(taskId: string) {
    if (!id) return;
    setControlBusy(`retry:${taskId}`);
    try {
      await retryTask(id, taskId);
      await refetch(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not retry task");
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

  if (error && !session) return <p className="text-sm text-jenny-bad">{error}</p>;
  if (!session) return <p className="text-sm text-jenny-muted">Loading…</p>;

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const blockedOrWaiting = tasks.filter((t) => t.status === "awaiting_approval" || t.status === "blocked");
  const totalTokens = agents.reduce((sum, a) => sum + a.tokensUsed, 0);
  const artifacts = extractArtifacts(events);
  const isActive = session.status === "running" || session.status === "planning" || session.status === "paused";
  const visualQaTasks = tasks.filter((t) => isVisualQaResult(t.result));

  return (
    <div className="-m-6 flex min-h-[calc(var(--app-vh)-0px)] flex-col gap-6 bg-jenny-void p-6 sm:-m-8 sm:p-8">
      <Link to="/admin/agent-sessions" className="inline-flex w-fit items-center gap-1.5 text-sm text-jenny-muted hover:text-jenny-champagne">
        <IconArrowLeft size={14} /> Back to sessions
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.25em] text-jenny-gold">
            {session.status.toUpperCase()}
            {isActive && tasks.length > 0 && ` · ${tasks.filter((t) => t.status === "completed").length} OF ${tasks.length}`}
          </p>
          <h1 className="mt-1 font-voice text-xl text-jenny-text">{session.objective}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-jenny-muted">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SESSION_STATUS_STYLES[session.status] ?? SESSION_STATUS_STYLES.planning}`}>
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
                className="flex items-center gap-1.5 rounded-xl bg-jenny-gold px-3.5 py-2.5 text-xs font-semibold text-jenny-ink-on-gold transition hover:opacity-90 disabled:opacity-50"
              >
                {controlBusy === "resume" ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlayerPlay size={14} />} Resume
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleControl("pause")}
                disabled={!!controlBusy}
                className="flex items-center gap-1.5 rounded-xl border border-jenny-border px-3.5 py-2.5 text-xs font-semibold text-jenny-text-3 transition hover:border-jenny-warn hover:text-jenny-warn disabled:opacity-50"
              >
                {controlBusy === "pause" ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlayerPause size={14} />} Pause
              </button>
            )}
            <button
              type="button"
              onClick={() => handleControl("cancel")}
              disabled={!!controlBusy}
              className="flex items-center gap-1.5 rounded-xl border border-jenny-bad/40 px-3.5 py-2.5 text-xs font-semibold text-jenny-bad transition hover:bg-jenny-bad/10 disabled:opacity-50"
            >
              {controlBusy === "cancel" ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlayerStop size={14} />} Cancel
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-jenny-bad">{error}</p>}

      {/* JENNYSOL-UI-BUILD.md §6.3: "Anything awaiting approval renders as a
          gold-bordered block on #2A1C06. This is the most important state
          in the system and must be impossible to miss." */}
      {(blockedOrWaiting.length > 0 || pending.length > 0) && (
        <section className="rounded-2xl border-2 border-jenny-gold bg-jenny-ink-on-gold p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-jenny-champagne">
            <IconAlertTriangle size={16} /> Waiting on you ({pending.length || blockedOrWaiting.length})
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {pending.map((a) => (
              <li key={a.id} className="rounded-xl border border-jenny-gold-mid bg-black/20 p-3">
                {a.toolName === "file.write" ? (
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-jenny-text">
                      <IconFileText size={14} className="text-jenny-gold" /> Write <code className="font-mono">{String(a.args.filePath ?? "?")}</code>
                    </p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-mono text-[11px] text-jenny-text-3">
                      {String(a.args.content ?? "")}
                    </pre>
                  </div>
                ) : (
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-jenny-text">
                      <IconTerminal2 size={14} className="text-jenny-gold" /> Run a command
                    </p>
                    <pre className="mt-2 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] text-jenny-text-3">
                      cd {String(a.args.cwd ?? ".")} && {String(a.args.command ?? "?")} {Array.isArray(a.args.args) ? (a.args.args as unknown[]).join(" ") : ""}
                    </pre>
                  </div>
                )}
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => decide(a.id, "approve")}
                    disabled={!!deciding}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-jenny-ok py-2.5 text-xs font-semibold text-jenny-void transition hover:opacity-90 disabled:opacity-50 sm:flex-none sm:px-5"
                  >
                    {deciding === a.id ? <IconLoader2 size={13} className="animate-spin" /> : <IconCheck size={13} />} Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(a.id, "reject")}
                    disabled={!!deciding}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-jenny-bad py-2.5 text-xs font-semibold text-jenny-void transition hover:opacity-90 disabled:opacity-50 sm:flex-none sm:px-5"
                  >
                    {deciding === a.id ? <IconLoader2 size={13} className="animate-spin" /> : <IconX size={13} />} Reject
                  </button>
                </div>
              </li>
            ))}
            {pending.length === 0 &&
              blockedOrWaiting.map((t) => (
                <li key={t.id} className="text-xs text-jenny-champagne">
                  <code className="font-mono">{t.title}</code> is {t.status.replace("_", " ")}
                  {t.agentId && agentById.get(t.agentId) ? ` (${agentById.get(t.agentId)!.displayName})` : ""}
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-2xl bg-jenny-raised p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-jenny-muted">Agents ({agents.length})</h3>
          {agents.length === 0 ? (
            <p className="text-xs text-jenny-muted">No agents spawned yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {agents.map((a) => {
                const killable = a.status !== "cancelled" && a.status !== "completed" && a.status !== "failed";
                return (
                  <li key={a.id} className="rounded-lg bg-jenny-raised-2/60 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-jenny-text-2">{a.displayName}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-jenny-muted">{a.status}</span>
                        {killable && (
                          <button
                            type="button"
                            title="Kill this agent"
                            onClick={() => handleKill(a.id)}
                            disabled={!!controlBusy}
                            className="rounded-md p-1 text-jenny-muted transition hover:bg-jenny-bad/10 hover:text-jenny-bad disabled:opacity-50"
                          >
                            {controlBusy === `kill:${a.id}` ? <IconLoader2 size={12} className="animate-spin" /> : <IconSkull size={12} />}
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-0.5 text-jenny-muted">{a.modelProvider ?? "no model yet"} · {a.tokensUsed} tokens</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-jenny-raised p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-jenny-muted">
            Tasks ({tasks.filter((t) => t.status === "completed").length}/{tasks.length})
          </h3>
          {tasks.length === 0 ? (
            <p className="text-xs text-jenny-muted">No tasks yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tasks.map((t) => (
                <li key={t.id} className="rounded-lg bg-jenny-raised-2/60 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-jenny-text-2">{t.title}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TASK_STATUS_STYLES[t.status] ?? TASK_STATUS_STYLES.pending}`}>
                        {t.status.replace("_", " ")}
                      </span>
                      {t.status === "failed" && (
                        <button
                          type="button"
                          title="Retry this task from where it failed"
                          onClick={() => handleRetry(t.id)}
                          disabled={!!controlBusy}
                          className="rounded-md p-1 text-jenny-muted transition hover:bg-jenny-gold/10 hover:text-jenny-gold disabled:opacity-50"
                        >
                          {controlBusy === `retry:${t.id}` ? <IconLoader2 size={12} className="animate-spin" /> : <IconRefresh size={12} />}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-jenny-muted">
                    {t.startedAt && <span>{elapsed(t.startedAt, t.completedAt)}</span>}
                    {t.dependsOn.length > 0 && <span>depends on: {t.dependsOn.map((depId) => taskById.get(depId)?.title ?? depId).join(", ")}</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-jenny-raised p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-jenny-muted">Memory ({memory.length} keys)</h3>
          {memory.length === 0 ? (
            <p className="text-xs text-jenny-muted">No shared memory written yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {memory.map((m) => (
                <li key={m.key} className="rounded-lg bg-jenny-raised-2/60 p-2 text-xs">
                  <span className="font-medium text-jenny-text-2">{m.key}</span>
                  <p className="mt-0.5 truncate text-jenny-muted">{JSON.stringify(m.value)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-2xl bg-jenny-raised p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-jenny-muted">Artifacts ({artifacts.length})</h3>
        {artifacts.length === 0 ? (
          <p className="text-xs text-jenny-muted">Nothing written or run yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {artifacts.map((a) => (
              <li key={a.id} className="rounded-lg bg-jenny-raised-2/60 p-2.5 text-xs">
                <div className="flex items-center gap-1.5">
                  {a.kind === "file.write" ? <IconFileText size={13} className="shrink-0 text-jenny-gold" /> : <IconTerminal2 size={13} className="shrink-0 text-jenny-gold" />}
                  {a.kind === "file.write" ? (
                    <code className="truncate font-mono text-jenny-text-2">{a.filePath}</code>
                  ) : (
                    <code className="truncate font-mono text-jenny-text-2">{a.command} {a.args?.join(" ")}</code>
                  )}
                  <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${a.ok ? "bg-jenny-ok/15 text-jenny-ok" : "bg-jenny-bad/15 text-jenny-bad"}`}>
                    {a.kind === "exec.command" ? `exit ${a.exitCode}` : a.ok ? "written" : "failed"}
                  </span>
                </div>
                {(a.stdout || a.stderr) && (
                  <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-mono text-[10px] text-jenny-text-3">
                    {a.stdout}
                    {a.stderr}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* JENNYSOL-UI-BUILD.md §6.6 "Visual QA" — real screenshot + real
          findings from a completed visual_qa task's own result column (see
          agentOrchestrator.ts's runVisualQaTask). The trust block is
          unconditional per spec ("until measured detection rates justify
          removing it") — this model's own real, measured accuracy
          (JENNY_VISION_MODEL_EVALUATION.md) has not cleared that bar. */}
      {visualQaTasks.map((t) => {
        const r = t.result as VisualQaResult;
        return (
          <section key={t.id} className="rounded-2xl bg-jenny-raised p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-jenny-muted">
                Visual QA — {r.findings.length} finding{r.findings.length === 1 ? "" : "s"}
              </h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                  r.verdict === "pass" ? "bg-jenny-ok/15 text-jenny-ok" : "bg-jenny-warn/15 text-jenny-warn"
                }`}
              >
                {r.verdict}
              </span>
            </div>
            <img src={`data:image/png;base64,${r.screenshotBase64}`} alt="Captured screenshot" className="w-full rounded-xl" />
            <div className="mt-3 rounded-xl border border-jenny-gold-mid bg-jenny-ink-on-gold p-3 text-xs text-jenny-champagne">
              This model is known to miss real defects — treat this list as incomplete, not exhaustive.
            </div>
            {r.findings.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {r.findings.map((finding, i) => {
                  const key = `${t.id}:${i}`;
                  const reviewed = reviewedFindings.has(key);
                  return (
                    <li key={key} className={`flex items-start gap-2.5 rounded-lg bg-jenny-raised-2/60 p-2.5 text-xs ${reviewed ? "opacity-50" : ""}`}>
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-jenny-warn" />
                      <span className="flex-1 text-jenny-text-2">{finding}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setReviewedFindings((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                        className="shrink-0 text-[10px] font-medium uppercase text-jenny-muted hover:text-jenny-text-3"
                      >
                        {reviewed ? "Confirmed" : "Confirm"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <section className="rounded-2xl bg-jenny-raised p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-jenny-muted">Activity</h3>
        {events.length === 0 ? (
          <p className="text-xs text-jenny-muted">No events yet.</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-auto font-mono text-[11px] text-jenny-text-3">
            {events.map((e) => (
              <li key={e.id}>
                <span className="text-jenny-muted">{new Date(e.createdAt).toLocaleTimeString()}</span> {formatEventLine(e)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
