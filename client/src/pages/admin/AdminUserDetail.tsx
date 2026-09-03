import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MessageSquare } from "lucide-react";
import {
  fetchAdminUser,
  fetchAdminConversation,
  type AdminUserRow,
  type AdminConversationSummary,
} from "../../lib/admin";

export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ user: AdminUserRow; conversations: AdminConversationSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeConvo, setActiveConvo] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string; createdAt: string }[]>([]);

  useEffect(() => {
    if (!id) return;
    fetchAdminUser(id)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load user"));
  }, [id]);

  useEffect(() => {
    if (!id || !activeConvo) return;
    fetchAdminConversation(id, activeConvo).then((r) => setMessages(r.messages));
  }, [id, activeConvo]);

  if (error) return <p className="text-sm text-rose-500">{error}</p>;
  if (!data) return <p className="text-sm text-neutral-400">Loading…</p>;

  const { user, conversations } = data;

  return (
    <div className="flex flex-col gap-5">
      <Link to="/admin/users" className="flex w-fit items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-brand-500">
        <ArrowLeft size={13} /> Back to users
      </Link>

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
        <h1 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">{user.name}</h1>
        <p className="text-sm text-neutral-500">{user.email}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-500">
          <span>Role: <strong className="text-neutral-700 dark:text-neutral-200">{user.role}</strong></span>
          <span>Sign-in: <strong className="capitalize text-neutral-700 dark:text-neutral-200">{user.authProvider}</strong></span>
          <span>Verified: <strong className="text-neutral-700 dark:text-neutral-200">{user.emailVerified ? "Yes" : "No"}</strong></span>
          <span>Joined: <strong className="text-neutral-700 dark:text-neutral-200">{new Date(user.createdAt.replace(" ", "T") + "Z").toLocaleDateString()}</strong></span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Conversations ({conversations.length})
          </h3>
          <p className="mb-3 text-[11px] text-amber-600 dark:text-amber-400">
            Support access — reading a user's private chat content. Use for troubleshooting only.
          </p>
          <ul className="flex flex-col gap-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setActiveConvo(c.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                    activeConvo === c.id
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/5"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <MessageSquare size={13} className="shrink-0 opacity-60" />
                    <span className="truncate">{c.title}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-neutral-400">{c.messageCount} msgs</span>
                </button>
              </li>
            ))}
            {conversations.length === 0 && <li className="px-2.5 py-2 text-xs text-neutral-400">No conversations yet.</li>}
          </ul>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Transcript</h3>
          {!activeConvo ? (
            <p className="text-sm text-neutral-400">Select a conversation to view it.</p>
          ) : (
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
              {messages.map((m, i) => (
                <div key={i} className={`text-sm ${m.role === "user" ? "text-neutral-800 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-300"}`}>
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    {m.role}
                  </span>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
