import { useEffect, useRef, useState } from "react";
import { FileText, File, Sparkles, Trash2, UploadCloud, X } from "lucide-react";
import { deleteDocument, fetchDocuments, uploadDocument, type DocumentInfo } from "../lib/api";

function iconFor(filename: string) {
  if (filename.toLowerCase().endsWith(".pdf")) return <File size={16} className="text-rose-500" />;
  return <FileText size={16} className="text-brand-500" />;
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setDocuments(await fetchDocuments());
    } catch {
      // server not reachable yet — leave list empty, chat window surfaces the real error
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(file);
      await refresh();
    } catch {
      setError("Upload failed. Try a .pdf, .txt, or .md file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex w-80 shrink-0 -translate-x-full flex-col gap-5 border-r border-neutral-200 bg-neutral-50/90 p-5 backdrop-blur-xl transition-transform duration-300 dark:border-white/10 dark:bg-neutral-900/90 md:static md:translate-x-0 md:bg-neutral-50 md:dark:bg-neutral-900 ${
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
        className={`group relative flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragging
            ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
            : "border-neutral-300 hover:border-brand-400 hover:bg-brand-50/60 dark:border-white/15 dark:hover:border-brand-400/60 dark:hover:bg-brand-500/5"
        }`}
      >
        <UploadCloud
          size={22}
          className={uploading ? "animate-bounce text-brand-500" : "text-neutral-400 group-hover:text-brand-500"}
        />
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
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
      {error && <p className="-mt-3 text-[11px] text-rose-500">{error}</p>}

      <div className="flex-1 overflow-y-auto">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Documents {documents.length > 0 && `(${documents.length})`}
        </h3>
        <ul className="space-y-1">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="group flex animate-fade-in items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-neutral-200/60 dark:hover:bg-white/5"
            >
              <div className="flex min-w-0 items-center gap-2">
                {iconFor(doc.filename)}
                <span className="truncate" title={doc.filename}>
                  {doc.filename}
                </span>
              </div>
              <button
                onClick={async () => {
                  setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
                  await deleteDocument(doc.id);
                }}
                className="shrink-0 text-neutral-400 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                aria-label={`Delete ${doc.filename}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
          {documents.length === 0 && (
            <li className="rounded-lg border border-dashed border-neutral-200 px-3 py-4 text-center text-xs text-neutral-400 dark:border-white/10">
              No documents yet — answers will use general knowledge until you add some.
            </li>
          )}
        </ul>
      </div>

      <p className="text-center text-[10px] text-neutral-400">Powered by Gemini · runs locally on your data</p>
    </aside>
  );
}
