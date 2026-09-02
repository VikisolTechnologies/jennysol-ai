import { useEffect, useRef, useState } from "react";
import { deleteDocument, fetchDocuments, uploadDocument, type DocumentInfo } from "../lib/api";

export function Sidebar() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    setDocuments(await fetchDocuments());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      await uploadDocument(file);
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  return (
    <aside className="w-72 shrink-0 border-r border-neutral-200 bg-neutral-50 p-4 flex flex-col gap-4">
      <div>
        <h2 className="font-semibold text-neutral-900">Jennysol AI</h2>
        <p className="text-xs text-neutral-500">RAG-powered chat assistant</p>
      </div>

      <div>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="w-full rounded-lg bg-indigo-600 text-white text-sm py-2 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload document"}
        </button>
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
      </div>

      <div className="flex-1 overflow-y-auto">
        <h3 className="text-xs font-medium text-neutral-500 mb-2 uppercase tracking-wide">
          Documents
        </h3>
        <ul className="space-y-1">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="group flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100"
            >
              <span className="truncate" title={doc.filename}>
                {doc.filename}
              </span>
              <button
                onClick={async () => {
                  await deleteDocument(doc.id);
                  await refresh();
                }}
                className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 text-xs"
              >
                ✕
              </button>
            </li>
          ))}
          {documents.length === 0 && (
            <li className="text-xs text-neutral-400">No documents yet.</li>
          )}
        </ul>
      </div>
    </aside>
  );
}
