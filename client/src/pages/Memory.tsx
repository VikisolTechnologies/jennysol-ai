import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Brain, FileText, MessageSquare, Trash2 } from "lucide-react";
import { deleteConversation, fetchConversations, type ConversationSummary } from "../lib/api";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso.replace(" ", "T") + "Z").toLocaleDateString();
}

// Three genuinely different things this app has, deliberately not blurred
// into one "Memory" label:
//   1. Conversation history — real, per-account, shown below (reuses the
//      exact same fetchConversations/deleteConversation the Sidebar uses).
//   2. Documents/RAG — real, but a separate system (see Files.tsx); linked
//      to, not duplicated here.
//   3. Persistent extracted memory (facts recalled across different
//      conversations) — does not exist. Said plainly, not implied.
export function Memory() {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    void fetchConversations().then(setConversations).catch(() => setConversations([]));
  }, []);

  return (
    <div className="h-[var(--app-vh)] overflow-y-auto bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-500 dark:text-neutral-400">
          <ArrowLeft size={14} /> Back to chat
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-lg shadow-brand-500/30">
            <Brain size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Memory</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">What JennySol actually remembers, and what it doesn't.</p>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-white/15 dark:bg-white/5 dark:text-neutral-300">
          <span>
            JennySol keeps your full conversation history (below) and can answer questions grounded
            in documents you've uploaded (see{" "}
            <Link to="/files" className="text-brand-600 underline hover:no-underline dark:text-brand-400">
              Files
            </Link>
            ). It does <strong>not</strong> maintain a separate long-term memory that extracts and
            recalls facts about you across different conversations — if you ask what Jenny
            remembers about you, she'll say so honestly rather than guess.
          </span>
        </div>

        <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-neutral-400">Conversation history</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {conversations === null && <li className="text-sm text-neutral-400">Loading…</li>}
          {conversations?.length === 0 && (
            <li className="rounded-xl border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-400 dark:border-white/10">
              No conversations yet — start chatting to see them here.
            </li>
          )}
          {conversations?.map((c) => (
            <li
              key={c.id}
              className="group flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-white/10 dark:bg-neutral-900"
            >
              <Link to="/" className="flex min-w-0 items-center gap-2.5">
                <MessageSquare size={15} className="shrink-0 text-neutral-400" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-neutral-400">Updated {relativeTime(c.updatedAt)}</p>
                </div>
              </Link>
              <button
                onClick={async () => {
                  setConversations((prev) => prev?.filter((x) => x.id !== c.id) ?? null);
                  await deleteConversation(c.id);
                }}
                className="shrink-0 rounded-lg p-2 text-neutral-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-500/10"
                aria-label={`Delete "${c.title}"`}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>

        <Link
          to="/files"
          className="mt-8 flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-brand-300 dark:border-white/10 dark:bg-neutral-900 dark:hover:border-brand-400/40"
        >
          <FileText size={16} className="text-brand-500" />
          <div>
            <p className="text-sm font-medium">Documents &amp; RAG</p>
            <p className="text-xs text-neutral-400">Uploaded files JennySol can ground answers in — see Files.</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
