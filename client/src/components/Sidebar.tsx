import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  IconBrain,
  IconChevronDown,
  IconChevronRight,
  IconCompass,
  IconFile,
  IconFileText,
  IconLayoutDashboard,
  IconListCheck,
  IconLogout,
  IconMailExclamation,
  IconMessage,
  IconDotsVertical,
  IconPencil,
  IconPlug,
  IconSettings,
  IconSquarePlus,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { Orb } from "./orb/Orb";
import { RenameDialog, DeleteConversationDialog } from "./ConversationDialog";
import {
  deleteConversation,
  deleteDocument,
  fetchConversations,
  fetchDocuments,
  renameConversation,
  uploadDocument,
  type ConversationSummary,
  type DocumentInfo,
} from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { resendVerification, fetchServerVersion } from "../lib/auth";
import { ROLES } from "../lib/auth";

function iconFor(filename: string) {
  if (filename.toLowerCase().endsWith(".pdf")) return <IconFile size={16} className="text-jenny-bad" />;
  return <IconFileText size={16} className="text-jenny-gold" />;
}

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

// Buckets by calendar day (in the browser's own local timezone), not a
// rolling 24h/7d window — "Yesterday" should mean the actual previous
// calendar date, matching how every mainstream chat product's history
// grouping reads, not "somewhere between 24 and 48 hours ago."
function groupConversations(conversations: ConversationSummary[]): { label: string; items: ConversationSummary[] }[] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(new Date());
  const yesterday = today - 86_400_000;
  const weekAgo = today - 7 * 86_400_000;

  const buckets: Record<string, ConversationSummary[]> = { Today: [], Yesterday: [], "Previous 7 days": [], Older: [] };
  for (const c of conversations) {
    const day = startOfDay(new Date(c.updatedAt.replace(" ", "T") + "Z"));
    if (day >= today) buckets["Today"].push(c);
    else if (day >= yesterday) buckets["Yesterday"].push(c);
    else if (day >= weekAgo) buckets["Previous 7 days"].push(c);
    else buckets["Older"].push(c);
  }
  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

export function Sidebar({
  open,
  onClose,
  activeConversationId,
  conversationsVersion,
  onSelectConversation,
  onNewChat,
  onRequestAuthGate,
}: {
  open: boolean;
  onClose: () => void;
  activeConversationId: string | null;
  conversationsVersion: number;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onRequestAuthGate: () => void;
}) {
  const { user, logout, startNewGuestSession, replayIntro } = useAuth();
  // For the "is this the same identity/build on both devices?" diagnostic
  // below — fetched once, not on any hot path. Never a secret: the backend
  // build SHA is the same thing `git log` shows anyone with repo access,
  // and user.id is already returned by /api/auth/me on every page load.
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  useEffect(() => {
    void fetchServerVersion().then(setServerVersion);
  }, []);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // Which row's "⋯" menu is open, plus the two dialogs it can lead to.
  // Replaces the old hover-only pencil/trash icons (opacity-0 until
  // group-hover) — confirmed those were completely unreachable on any
  // touch device with no :hover, meaning rename/delete were effectively
  // broken on mobile. This menu button is always visible instead.
  const [menuOpenForId, setMenuOpenForId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  // Captured at the moment a row's "..." button opens its menu — not read
  // from document.activeElement when the dialog opens, because the
  // Rename/Delete menuitem that was actually clicked unmounts (closing the
  // menu) in the same commit that opens the dialog, and a focused element
  // being removed makes the browser fall back to <body> before any effect
  // can observe it. This ref stays valid across that unmount so Escape/close
  // can restore focus to the real trigger instead of stranding it on <body>.
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [documentsExpanded, setDocumentsExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const fileInput = useRef<HTMLInputElement>(null);

  async function refreshDocuments() {
    try {
      setDocuments(await fetchDocuments());
    } catch {
      // server not reachable yet — leave list empty, chat window surfaces the real error
    }
  }

  async function refreshConversations() {
    try {
      setConversations(await fetchConversations());
    } catch {
      // same — chat window's own error handling covers server-down cases
    }
  }

  useEffect(() => {
    refreshDocuments();
  }, []);

  useEffect(() => {
    refreshConversations();
  }, [conversationsVersion]);

  // Close the row menu on outside click/tap — standard kebab-menu behavior.
  useEffect(() => {
    if (!menuOpenForId) return;
    function onDocClick() {
      setMenuOpenForId(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpenForId]);

  // Real backend persistence via the same renameConversation the old
  // inline-edit path used (server-side ownership enforced in
  // routes/conversations.ts) — only reflected in local state once the
  // request actually succeeds, so a failed rename can never silently
  // diverge from what the server has.
  async function commitRename(c: ConversationSummary, trimmed: string) {
    await renameConversation(c.id, trimmed);
    setConversations((prev) => prev.map((x) => (x.id === c.id ? { ...x, title: trimmed, titleSource: "manual" } : x)));
  }

  // Same real backend call as before (DELETE /api/conversations/:id), but
  // now gated behind an explicit confirmation dialog instead of firing the
  // instant a trash icon is tapped, and only removed from local state once
  // the server confirms the delete actually happened.
  async function commitDelete(c: ConversationSummary) {
    await deleteConversation(c.id);
    setConversations((prev) => prev.filter((x) => x.id !== c.id));
    if (c.id === activeConversationId) onNewChat();
  }

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(file);
      await refreshDocuments();
    } catch {
      setError("Upload failed. Try a .pdf, .txt, or .md file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex w-80 shrink-0 -translate-x-full flex-col gap-3 border-r border-jenny-hairline bg-jenny-void/95 p-4 backdrop-blur-xl transition-transform duration-300 md:static md:translate-x-0 md:bg-jenny-void ${
        open ? "translate-x-0" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Orb state="asleep" size="sm" />
          <div>
            <h1 className="text-sm font-bold leading-tight text-jenny-text">JennySol</h1>
            <p className="text-[11px] text-jenny-dim">Grounded chat assistant</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-jenny-muted hover:bg-jenny-raised md:hidden"
          aria-label="Close sidebar"
        >
          <IconX size={18} />
        </button>
      </div>

      <button
        onClick={onNewChat}
        className="flex items-center justify-center gap-2 rounded-xl bg-jenny-gold px-3 py-2.5 text-sm font-semibold text-jenny-ink-on-gold transition hover:opacity-90"
      >
        <IconSquarePlus size={15} />
        New chat
      </button>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && <p className="px-2.5 py-3 text-xs text-jenny-faint">No chats yet — say something!</p>}
        {groupConversations(conversations).map((group) => (
          <div key={group.label} className="mb-3">
            <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-jenny-faint">{group.label}</h3>
            <ul className="space-y-0.5">
              {group.items.map((c) => (
                <li key={c.id} className="relative">
                  {/* The row selector and the "..." trigger are SIBLINGS,
                      not parent/child — a <button> can never validly
                      contain another interactive element (invalid HTML,
                      and confirmed via real touch-tap testing to make the
                      inner control unreliable to activate). */}
                  <div
                    className={`flex w-full items-center gap-0.5 rounded-lg pl-0.5 pr-1 transition ${
                      c.id === activeConversationId ? "bg-jenny-gold/10 text-jenny-champagne" : "text-jenny-text-3 hover:bg-jenny-raised"
                    }`}
                  >
                    <button
                      onClick={() => onSelectConversation(c.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 text-left text-sm"
                    >
                      <IconMessage size={14} className="shrink-0 opacity-60" />
                      <span className="truncate">{c.title}</span>
                    </button>
                    {/* Always visible (never hover-gated) — a hover-only
                        trigger is unreachable on any touchscreen with no
                        :hover, which is what the old pencil/trash icons
                        were. Real 44px tap target (h-11 w-11), not just a
                        44px-tall row — the icon itself stays visually small
                        via the inner size={15}. */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        menuTriggerRef.current = e.currentTarget;
                        setMenuOpenForId((prev) => (prev === c.id ? null : c.id));
                      }}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-jenny-dim transition hover:bg-jenny-raised-2 hover:text-jenny-text-2"
                      aria-label={`More options for "${c.title}"`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpenForId === c.id}
                    >
                      <IconDotsVertical size={15} />
                    </button>
                  </div>
                  <span className="ml-2.5 block px-0.5 text-[10px] text-jenny-faint">{relativeTime(c.updatedAt)}</span>

                  {menuOpenForId === c.id && (
                    <div
                      role="menu"
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-1 top-11 z-10 w-40 overflow-hidden rounded-xl border border-jenny-hairline-card bg-jenny-raised py-1 shadow-lg motion-safe:animate-fade-in"
                    >
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenuOpenForId(null);
                          setRenameTarget(c);
                        }}
                        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-jenny-text-2 hover:bg-jenny-raised-2"
                      >
                        <IconPencil size={14} /> Rename
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenuOpenForId(null);
                          setDeleteTarget(c);
                        }}
                        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-jenny-bad hover:bg-jenny-bad/10"
                      >
                        <IconTrash size={14} /> Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <RenameDialog
        open={renameTarget !== null}
        initialValue={renameTarget?.title ?? ""}
        onClose={() => setRenameTarget(null)}
        onSave={(value) => commitRename(renameTarget!, value)}
        restoreFocusRef={menuTriggerRef}
      />
      <DeleteConversationDialog
        open={deleteTarget !== null}
        title={deleteTarget?.title ?? ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => commitDelete(deleteTarget!)}
        restoreFocusRef={menuTriggerRef}
      />

      <div className="shrink-0 border-t border-jenny-hairline pt-3">
        <button
          onClick={() => setDocumentsExpanded((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-jenny-faint hover:text-jenny-text-3"
        >
          <span>Documents {documents.length > 0 && `(${documents.length})`}</span>
          {documentsExpanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        </button>

        {documentsExpanded && (
          <div className="mt-2 flex flex-col gap-2 animate-fade-in">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              className={`group relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-3 py-4 text-center transition-colors ${
                dragging ? "border-jenny-gold bg-jenny-gold/10" : "border-jenny-border hover:border-jenny-gold-mid hover:bg-jenny-gold/5"
              }`}
            >
              <IconUpload
                size={18}
                className={uploading ? "animate-bounce text-jenny-gold" : "text-jenny-dim group-hover:text-jenny-gold"}
              />
              <span className="text-[11px] font-medium text-jenny-text-3">
                {uploading ? "Uploading…" : "Drop a file or click to upload"}
              </span>
              <span className="text-[10px] text-jenny-faint">PDF, TXT, or MD</span>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            {error && <p className="text-[11px] text-jenny-bad">{error}</p>}

            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {documents.map((doc) => (
                <li key={doc.id} className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-jenny-raised">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {iconFor(doc.filename)}
                    <span className="truncate" title={doc.filename}>
                      {doc.filename}
                    </span>
                  </span>
                  <button
                    onClick={async () => {
                      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
                      await deleteDocument(doc.id);
                    }}
                    className="shrink-0 text-jenny-dim opacity-0 transition hover:text-jenny-bad group-hover:opacity-100"
                    aria-label={`Delete ${doc.filename}`}
                  >
                    <IconTrash size={12} />
                  </button>
                </li>
              ))}
              {documents.length === 0 && <li className="px-2 py-2 text-[11px] text-jenny-faint">None yet — answers use general knowledge until you add some.</li>}
            </ul>
          </div>
        )}
      </div>

      {user && !user.emailVerified && (
        <div className="shrink-0 rounded-lg border border-jenny-warn/25 bg-jenny-warn/10 px-2.5 py-2 text-[11px] text-jenny-warn">
          <div className="flex items-start gap-1.5">
            <IconMailExclamation size={13} className="mt-0.5 shrink-0" />
            <div>
              Verify your email to secure your account.{" "}
              {resendState === "sent" ? (
                <span className="font-medium">Sent — check your inbox.</span>
              ) : (
                <button
                  onClick={async () => {
                    setResendState("sending");
                    try {
                      await resendVerification();
                      setResendState("sent");
                    } catch {
                      setResendState("idle");
                    }
                  }}
                  disabled={resendState === "sending"}
                  className="font-medium underline hover:no-underline disabled:opacity-50"
                >
                  {resendState === "sending" ? "Sending…" : "Resend link"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {user && (
        <div className="flex shrink-0 flex-col gap-0.5">
          {[
            { to: "/agents", label: "Agents", Icon: IconCompass },
            { to: "/files", label: "Files", Icon: IconFileText },
            { to: "/memory", label: "Memory", Icon: IconBrain },
            { to: "/tasks", label: "Tasks", Icon: IconListCheck },
            { to: "/integrations", label: "Integrations", Icon: IconPlug },
          ].map(({ to, label, Icon }) => (
            <Link key={to} to={to} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-jenny-muted transition hover:bg-jenny-raised hover:text-jenny-text-2">
              <Icon size={13} />
              {label}
            </Link>
          ))}
        </div>
      )}

      {user && (
        <Link to="/account" className="flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-jenny-muted transition hover:bg-jenny-raised hover:text-jenny-text-2">
          <IconSettings size={13} />
          Account &amp; settings
        </Link>
      )}

      {user?.role === "admin" && (
        <Link to="/admin" className="flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-jenny-muted transition hover:bg-jenny-raised hover:text-jenny-text-2">
          <IconLayoutDashboard size={13} />
          Admin dashboard
        </Link>
      )}

      {user?.isGuest && (
        <div className="flex shrink-0 flex-col gap-1.5">
          {/* Guests have no password to log back in with, so there's no
              plain "log out" here — signing up (GuestLimitModal) is the
              path that keeps access to this guest's history. */}
          <button
            onClick={onRequestAuthGate}
            className="flex items-center gap-2 rounded-lg border border-dashed border-jenny-gold-mid px-2.5 py-2 text-left text-xs font-medium text-jenny-champagne transition hover:bg-jenny-gold/10"
          >
            <IconSquarePlus size={13} className="shrink-0" />
            <span>
              You&rsquo;re chatting as a guest. <span className="underline">Sign up to save your chats</span>
            </span>
          </button>
          {/* Keeps the temporary-vs-permanent distinction subtle but
              explicit — see the session/storage architecture doc. A guest's
              history now really does live only for this browser session
              (sessionStorage-backed identity, short server-side TTL), so
              this is no longer just a sign-up pitch, it's accurate. */}
          <p className="px-2.5 text-[10px] text-jenny-faint">Your chat history is temporary and will be cleared when this browser session ends.</p>
          {/* Shared-device escape hatch — see docs/SECURITY_AUDIT.md. On a
              shared phone/computer, whoever opens Jennysol next would
              otherwise silently continue THIS guest's session (and see its
              chat history) with no indication anything is wrong. Native
              confirm() is deliberate here: this is a rare, high-stakes
              action, not a place for a custom dialog to add polish to. */}
          <button
            onClick={() => {
              if (
                window.confirm(
                  "Start a new session on this device? You'll lose access to this guest conversation unless you've already signed up."
                )
              ) {
                void startNewGuestSession();
              }
            }}
            className="px-2.5 text-left text-[10px] text-jenny-faint underline decoration-dotted transition hover:text-jenny-text-3"
          >
            Not you? Start a new session
          </button>
        </div>
      )}

      {user && !user.isGuest && (
        <div className="flex shrink-0 items-center justify-between gap-2 rounded-lg px-1 py-1">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-jenny-text-2">{user.name}</p>
            <p className="truncate text-[10px] text-jenny-faint">{ROLES.find((r) => r.value === user.role)?.label ?? user.role}</p>
          </div>
          <button onClick={logout} className="shrink-0 rounded-lg p-1.5 text-jenny-dim transition hover:bg-jenny-raised hover:text-jenny-text-2" aria-label="Log out" title="Log out">
            <IconLogout size={14} />
          </button>
        </div>
      )}

      <p className="shrink-0 text-center text-[10px] text-jenny-faint">Powered by Vikisol · runs locally on your data</p>

      {/* Lets two devices be compared directly (e.g. "are these actually
          two different identities, and the same app build?") instead of
          guessing from symptoms — see docs/SECURITY_AUDIT.md. Nothing here
          is secret: user.id is already returned by /api/auth/me, and both
          build SHAs are the same information a repo commit log shows. */}
      {user && (
        <details className="shrink-0 text-[10px] text-jenny-faint">
          <summary className="cursor-pointer select-none text-center hover:text-jenny-text-3">Diagnostics</summary>
          <div className="mt-1.5 space-y-1 rounded-lg bg-jenny-raised px-2 py-1.5 font-mono">
            <p>account: {user.isGuest ? "guest" : "full"}</p>
            <p className="break-all">user id: {user.id}</p>
            <p>app build: {__BUILD_VERSION__}</p>
            <p>server build: {serverVersion ?? "…"}</p>
            <button
              onClick={replayIntro}
              className="mt-1 rounded-md border border-jenny-border px-2 py-1 font-sans text-[10px] text-jenny-muted transition hover:border-jenny-gold-mid hover:text-jenny-text-2"
            >
              Replay welcome
            </button>
          </div>
        </details>
      )}
    </aside>
  );
}
