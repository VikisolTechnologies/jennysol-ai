import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, File, FileText, Trash2, UploadCloud } from "lucide-react";
import { deleteDocument, fetchDocuments, uploadDocument, type DocumentInfo } from "../lib/api";

// Deliberately reuses the exact same api.ts functions the Sidebar's document
// panel already calls (fetchDocuments/uploadDocument/deleteDocument) against
// the same /api/documents backend — this is a second VIEW onto one real
// system, not a second file implementation. Uploading here shows up in the
// sidebar's list and vice versa, because they're the same data.
function iconFor(filename: string) {
  if (filename.toLowerCase().endsWith(".pdf")) return <File size={16} className="text-rose-500" />;
  return <FileText size={16} className="text-brand-500" />;
}

function formatDate(iso: string): string {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function Files() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setDocuments(await fetchDocuments());
    } catch {
      setError("Couldn't load your files.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(file);
      await refresh();
    } catch {
      setError("Upload failed. Try a .pdf, .txt, or .md file under 20MB.");
    } finally {
      setUploading(false);
    }
  }

  const filtered = documents.filter((d) => d.filename.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="h-[var(--app-vh)] overflow-y-auto bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-500 dark:text-neutral-400">
          <ArrowLeft size={14} /> Back to chat
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-lg shadow-brand-500/30">
            <FileText size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Files</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Documents JennySol can answer questions from, grounded in their content.
            </p>
          </div>
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
            if (file) void handleFile(file);
          }}
          className={`mt-6 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging
              ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
              : "border-neutral-300 hover:border-brand-400 hover:bg-brand-50/60 dark:border-white/15 dark:hover:border-brand-400/60 dark:hover:bg-brand-500/5"
          }`}
        >
          <UploadCloud size={22} className={uploading ? "animate-bounce text-brand-500" : "text-neutral-400"} />
          <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
            {uploading ? "Uploading…" : "Drop a file here, or click to upload"}
          </span>
          <span className="text-xs text-neutral-400">PDF, TXT, or MD · up to 20MB</span>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </label>
        {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}

        {documents.length > 0 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your files…"
            className="mt-6 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-brand-500/20 focus:ring-2 dark:border-white/15 dark:bg-neutral-900 dark:text-white"
          />
        )}

        <ul className="mt-4 flex flex-col gap-2">
          {loading && <p className="text-sm text-neutral-400">Loading…</p>}
          {!loading && filtered.length === 0 && documents.length === 0 && (
            <li className="rounded-xl border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-400 dark:border-white/10">
              No files yet — upload your first document above.
            </li>
          )}
          {!loading && filtered.length === 0 && documents.length > 0 && (
            <li className="px-2 py-3 text-sm text-neutral-400">No files match "{query}".</li>
          )}
          {filtered.map((doc) => (
            <li
              key={doc.id}
              className="group flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-white/10 dark:bg-neutral-900"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {iconFor(doc.filename)}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={doc.filename}>
                    {doc.filename}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {doc.chunkCount} {doc.chunkCount === 1 ? "chunk" : "chunks"} · uploaded {formatDate(doc.uploadedAt)}
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
                  await deleteDocument(doc.id);
                }}
                className="shrink-0 rounded-lg p-2 text-neutral-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-500/10"
                aria-label={`Delete ${doc.filename}`}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
