import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { fetchAdminUsers, type AdminUserRow } from "../../lib/admin";

export function AdminUsers() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ users: AdminUserRow[]; total: number; limit: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetchAdminUsers(query, page)
        .then(setResult)
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, page]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">Users</h1>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search name or email…"
            className="w-64 rounded-lg border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5"
          />
        </div>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400 dark:bg-white/5">
            <tr>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Sign-in</th>
              <th className="px-4 py-2.5 font-medium">Verified</th>
              <th className="px-4 py-2.5 font-medium">Chats</th>
              <th className="px-4 py-2.5 font-medium">Msgs</th>
              <th className="px-4 py-2.5 font-medium">Last active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-white/5">
            {result?.users.map((u) => (
              <tr key={u.id} className="hover:bg-neutral-50 dark:hover:bg-white/5">
                <td className="px-4 py-2.5">
                  <Link to={`/admin/users/${u.id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
                    {u.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{u.email}</td>
                <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{u.role}</td>
                <td className="px-4 py-2.5 capitalize text-neutral-600 dark:text-neutral-300">{u.authProvider}</td>
                <td className="px-4 py-2.5">{u.emailVerified ? "✓" : "—"}</td>
                <td className="px-4 py-2.5">{u.conversationCount}</td>
                <td className="px-4 py-2.5">{u.messageCount}</td>
                <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">
                  {u.lastActiveAt ? new Date(u.lastActiveAt.replace(" ", "T") + "Z").toLocaleDateString() : "never"}
                </td>
              </tr>
            ))}
            {result && result.users.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-neutral-400">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {result && result.total > result.limit && (
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>
            Page {page} of {totalPages} — {result.total} users
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-neutral-200 px-3 py-1 disabled:opacity-40 dark:border-white/10"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-neutral-200 px-3 py-1 disabled:opacity-40 dark:border-white/10"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
