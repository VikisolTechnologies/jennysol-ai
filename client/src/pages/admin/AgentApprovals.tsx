import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileEdit, Terminal, Check, X, Loader2, ShieldAlert } from "lucide-react";
import { approveAgentAction, fetchPendingActions, rejectAgentAction, type PendingAgentActionRow } from "../../lib/admin";

const POLL_MS = 4000;

function ActionSummary({ action }: { action: PendingAgentActionRow }) {
  if (action.toolName === "file.write") {
    const filePath = typeof action.args.filePath === "string" ? action.args.filePath : "(unknown file)";
    const content = typeof action.args.content === "string" ? action.args.content : "";
    return (
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          <FileEdit size={14} className="text-brand-500" /> Write <code className="font-mono">{filePath}</code>
        </p>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-50 p-2.5 font-mono text-[11px] text-neutral-600 dark:bg-black/30 dark:text-neutral-300">
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
      <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
        <Terminal size={14} className="text-brand-500" /> Run a command
      </p>
      <pre className="mt-2 overflow-auto rounded-lg bg-neutral-50 p-2.5 font-mono text-[11px] text-neutral-600 dark:bg-black/30 dark:text-neutral-300">
        cd {cwd} && {command} {args}
      </pre>
    </div>
  );
}

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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">Approval queue</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Every write or command an agent is proposing, anywhere, right now. Nothing here executes until you
          decide — no bulk action, no default, no one-tap-through.
        </p>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}
      {!error && !actions && <p className="text-sm text-neutral-400">Loading…</p>}

      {actions && actions.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:bg-white/5 dark:text-neutral-300">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>Nothing waiting on you right now — it&rsquo;s quiet here.</span>
        </div>
      )}

      {actions && actions.length > 0 && (
        <ul className="flex flex-col gap-3">
          {actions.map((a) => (
            <li
              key={a.id}
              className="rounded-2xl border-2 border-amber-300 bg-amber-50/40 p-4 dark:border-amber-500/40 dark:bg-amber-500/10"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <ActionSummary action={a} />
                <Link
                  to={`/admin/agent-sessions/${a.sessionId}`}
                  className="shrink-0 text-xs font-medium text-neutral-500 underline-offset-2 hover:text-brand-500 hover:underline dark:text-neutral-400"
                >
                  View session →
                </Link>
              </div>
              {actionError[a.id] && <p className="mt-2 text-xs text-rose-500">{actionError[a.id]}</p>}
              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => decide(a.id, "approve")}
                  disabled={!!deciding[a.id]}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none sm:px-6"
                >
                  {deciding[a.id] === "approve" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => decide(a.id, "reject")}
                  disabled={!!deciding[a.id]}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-600 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none sm:px-6"
                >
                  {deciding[a.id] === "reject" ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
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
