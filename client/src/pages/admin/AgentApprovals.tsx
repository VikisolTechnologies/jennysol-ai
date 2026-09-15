import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { IconFileText, IconTerminal2, IconCheck, IconX, IconLoader2, IconShieldExclamation } from "@tabler/icons-react";
import { approveAgentAction, fetchPendingActions, rejectAgentAction, type PendingAgentActionRow } from "../../lib/admin";

const POLL_MS = 4000;

function ActionSummary({ action }: { action: PendingAgentActionRow }) {
  if (action.toolName === "file.write") {
    const filePath = typeof action.args.filePath === "string" ? action.args.filePath : "(unknown file)";
    const content = typeof action.args.content === "string" ? action.args.content : "";
    return (
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-jenny-text">
          <IconFileText size={14} className="text-jenny-gold" /> Write <code className="font-mono">{filePath}</code>
        </p>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2.5 font-mono text-[11px] text-jenny-text-3">
          {content || "(empty file)"}
        </pre>
      </div>
    );
  }
  const command = typeof action.args.command === "string" ? action.args.command : "?";
  const args = Array.isArray(action.args.args) ? (action.args.args as unknown[]).join(" ") : "";
  const cwd = typeof action.args.cwd === "string" ? action.args.cwd : ".";
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-jenny-text">
        <IconTerminal2 size={14} className="text-jenny-gold" /> Run a command
      </p>
      <pre className="mt-2 overflow-auto rounded-lg bg-black/30 p-2.5 font-mono text-[11px] text-jenny-text-3">
        cd {cwd} && {command} {args}
      </pre>
    </div>
  );
}

// JENNYSOL-UI-BUILD.md §6.4 "Approval" — "No bulk approve anywhere. Not as
// a shortcut, not behind a menu. One item at a time, with a line on screen
// saying so." Already true of this page's real behavior (one decide() call
// per action id, no select-all anywhere in the markup) — restyled here,
// not restructured.
export function AgentApprovals() {
  const [actions, setActions] = useState<PendingAgentActionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<Record<string, "approve" | "reject" | undefined>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    fetchPendingActions()
      .then(setActions)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the approval queue"));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  async function decide(id: string, kind: "approve" | "reject") {
    setDeciding((d) => ({ ...d, [id]: kind }));
    setActionError((e) => ({ ...e, [id]: "" }));
    try {
      if (kind === "approve") await approveAgentAction(id);
      else await rejectAgentAction(id);
      setActions((prev) => prev?.filter((a) => a.id !== id) ?? prev);
    } catch (err) {
      setActionError((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Could not decide" }));
    } finally {
      setDeciding((d) => ({ ...d, [id]: undefined }));
    }
  }

  return (
    <div className="-m-6 flex min-h-[calc(var(--app-vh)-0px)] flex-col gap-6 bg-jenny-void p-6 sm:-m-8 sm:p-8">
      <div>
        <p className="text-[10px] tracking-[0.25em] text-jenny-gold">{actions ? `${actions.length} PENDING` : "APPROVALS"}</p>
        <h1 className="mt-1 font-voice text-2xl text-jenny-text">Waiting on you</h1>
        <p className="mt-1.5 text-sm text-jenny-muted">
          Every write or command an agent is proposing, anywhere, right now. Nothing here executes until you decide —
          no bulk action, no default, one item at a time.
        </p>
      </div>

      {error && <p className="text-sm text-jenny-bad">{error}</p>}
      {!error && !actions && <p className="text-sm text-jenny-dim">Loading…</p>}

      {actions && actions.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-jenny-border bg-jenny-raised px-4 py-3 text-sm text-jenny-text-3">
          <IconShieldExclamation size={16} className="mt-0.5 shrink-0" />
          <span>Nothing waiting on you right now — it&rsquo;s quiet here.</span>
        </div>
      )}

      {actions && actions.length > 0 && (
        <ul className="flex flex-col gap-3">
          {actions.map((a) => (
            <li key={a.id} className="rounded-2xl border-2 border-jenny-gold bg-jenny-ink-on-gold p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <ActionSummary action={a} />
                <Link to={`/admin/agent-sessions/${a.sessionId}`} className="shrink-0 text-xs font-medium text-jenny-muted underline-offset-2 hover:text-jenny-champagne hover:underline">
                  View session →
                </Link>
              </div>
              {actionError[a.id] && <p className="mt-2 text-xs text-jenny-bad">{actionError[a.id]}</p>}
              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => decide(a.id, "approve")}
                  disabled={!!deciding[a.id]}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-jenny-ok py-3 text-sm font-semibold text-jenny-void transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none sm:px-6"
                >
                  {deciding[a.id] === "approve" ? <IconLoader2 size={16} className="animate-spin" /> : <IconCheck size={16} />}
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => decide(a.id, "reject")}
                  disabled={!!deciding[a.id]}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-jenny-bad py-3 text-sm font-semibold text-jenny-void transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none sm:px-6"
                >
                  {deciding[a.id] === "reject" ? <IconLoader2 size={16} className="animate-spin" /> : <IconX size={16} />}
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
