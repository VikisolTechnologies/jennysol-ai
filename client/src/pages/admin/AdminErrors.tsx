import { useEffect, useState } from "react";
import { fetchAdminErrors, type AdminErrorEntry } from "../../lib/admin";

const LEVEL_COLOR: Record<string, string> = {
  uncaughtException: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  unhandledRejection: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  server: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  client: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
};

export function AdminErrors() {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ errors: AdminErrorEntry[]; limit: number } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminErrors(page)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load errors"));
  }, [page]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">Errors</h1>
      <p className="text-xs text-neutral-400">
        Every uncaught server error, unhandled rejection, and reported frontend crash — most recent first.
      </p>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      <div className="flex flex-col gap-2">
        {result?.errors.map((e) => (
          <div key={e.id} className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-white/10 dark:bg-white/5">
            <button
              onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${LEVEL_COLOR[e.level] ?? "bg-neutral-100 text-neutral-600"}`}>
                  {e.level}
                </span>
                <span className="text-sm text-neutral-700 dark:text-neutral-200">{e.message}</span>
              </div>
              <span className="shrink-0 text-[11px] text-neutral-400">
                {new Date(e.createdAt.replace(" ", "T") + "Z").toLocaleString()}
              </span>
            </button>
            {expanded === e.id && (
              <div className="mt-2 border-t border-neutral-100 pt-2 text-xs text-neutral-500 dark:border-white/5">
                {e.path && <p className="mb-1">Path: {e.path}</p>}
                {e.userId && <p className="mb-1">User: {e.userId}</p>}
                {e.stack && (
                  <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-50 p-2 text-[11px] dark:bg-black/30">{e.stack}</pre>
                )}
              </div>
            )}
          </div>
        ))}
        {result && result.errors.length === 0 && <p className="text-sm text-neutral-400">No errors logged. Good sign.</p>}
      </div>

      {result && result.errors.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-neutral-200 px-3 py-1 text-sm disabled:opacity-40 dark:border-white/10"
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={result.errors.length < result.limit}
            className="rounded-lg border border-neutral-200 px-3 py-1 text-sm disabled:opacity-40 dark:border-white/10"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
