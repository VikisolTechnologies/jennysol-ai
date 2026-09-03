import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  MessageSquare,
  SquarePen,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  deleteConversation,
  deleteDocument,
  fetchConversations,
  fetchDocuments,
  uploadDocument,
  type ConversationSummary,
  type DocumentInfo,
} from "../lib/api";

function iconFor(filename: string) {
  if (filename.toLowerCase().endsWith(".pdf")) return <File size={16} className="text-rose-500" />;
  return <FileText size={16} className="text-brand-500" />;
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

export function Sidebar({
  open,
  onClose,
  activeConversationId,
  conversationsVersion,
  onSelectConversation,
  onNewChat,
}: {
  open: boolean;
  onClose: () => void;
  activeConversationId: string | null;
  conversationsVersion: number;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [documentsExpanded, setDocumentsExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      className={`fixed inset-y-0 left-0 z-30 flex w-80 shrink-0 -translate-x-full flex-col gap-3 border-r border-neutral-200 bg-neutral-50/90 p-4 backdrop-blur-xl transition-transform duration-300 dark:border-white/10 dark:bg-neutral-900/90 md:static md:translate-x-0 md:bg-neutral-50 md:dark:bg-neutral-900 ${
        open ? "translate-x-0" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-lg shadow-brand-500/30">
            <Sparkles size={18} />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight">Jennysol AI</h1>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Grounded chat assistant</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200/70 dark:hover:bg-white/10 md:hidden"
          aria-label="Close sidebar"
        >
          <X size={18} />
        </button>
      </div>

      <button
        onClick={onNewChat}
        className="flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-3 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition hover:opacity-90"
      >
        <SquarePen size={15} />
        New chat
      </button>

      <div className="flex-1 overflow-y-auto">
        <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Chats</h3>
        <ul className="space-y-0.5">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onSelectConversation(c.id)}
                className={`group flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                  c.id === activeConversationId
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
                    : "text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-white/5"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MessageSquare size={14} className="shrink-0 opacity-60" />
                  <span className="truncate">{c.title}</span>
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setConversations((prev) => prev.filter((x) => x.id !== c.id));
                    await deleteConversation(c.id);
                    if (c.id === activeConversationId) onNewChat();
                  }}
                  className="shrink-0 rounded p-0.5 text-neutral-400 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                  aria-label={`Delete "${c.title}"`}
                >
                  <Trash2 size={13} />
                </span>
              </button>
              <span className="ml-6 block px-0.5 text-[10px] text-neutral-400">{relativeTime(c.updatedAt)}</span>
            </li>
          ))}
          {conversations.length === 0 && (
            <li className="px-2.5 py-3 text-xs text-neutral-400">No chats yet — say something!</li>
          )}
        </ul>
      </div>

      <div className="shrink-0 border-t border-neutral-200 pt-3 dark:border-white/10">
        <button
          onClick={() => setDocumentsExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          <span>Documents {documents.length > 0 && `(${documents.length})`}</span>
          {documentsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
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
                dragging
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                  : "border-neutral-300 hover:border-brand-400 hover:bg-brand-50/60 dark:border-white/15 dark:hover:border-brand-400/60 dark:hover:bg-brand-500/5"
              }`}
            >
              <UploadCloud
                size={18}
                className={uploading ? "animate-bounce text-brand-500" : "text-neutral-400 group-hover:text-brand-500"}
              />
              <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                {uploading ? "Uploading…" : "Drop a file or click to upload"}
              </span>
              <span className="text-[10px] text-neutral-400">PDF, TXT, or MD</span>
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
            {error && <p className="text-[11px] text-rose-500">{error}</p>}

            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-neutral-200/60 dark:hover:bg-white/5"
                >
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
                    className="shrink-0 text-neutral-400 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                    aria-label={`Delete ${doc.filename}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
              {documents.length === 0 && (
                <li className="px-2 py-2 text-[11px] text-neutral-400">
                  None yet — answers use general knowledge until you add some.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      <p className="shrink-0 text-center text-[10px] text-neutral-400">Powered by Vikisol · runs locally on your data</p>
    </aside>
  );
}
