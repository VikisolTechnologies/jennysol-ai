import { useEffect, useState } from "react";
import { Laptop, ShieldX } from "lucide-react";
import { fetchSessions, getToken, revokeSession, type SessionSummary } from "../../lib/auth";

// Identifies which row in the list is THIS device without ever sending the
// raw token anywhere new — the server's fingerprint is sha256(token) hex,
// first 12 chars (see services/auth/sessions.ts); computing the same thing
// client-side via SubtleCrypto lets the UI mark "this session" and hide the
// revoke button for it, purely for display — the server independently
// refuses to revoke the caller's own current session either way.
async function currentSessionFingerprint(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

function describeSession(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  if (/iphone/i.test(userAgent)) return "iPhone";
  if (/ipad/i.test(userAgent)) return "iPad";
  if (/android/i.test(userAgent)) return "Android device";
  if (/macintosh/i.test(userAgent)) return "Mac";
  if (/windows/i.test(userAgent)) return "Windows PC";
  return "Browser session";
}

function formatDate(iso: string): string {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AccountSessions() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [list, mine] = await Promise.all([fetchSessions(), currentSessionFingerprint()]);
      setSessions(list);
      setCurrentFingerprint(mine);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your sessions.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleRevoke(fingerprint: string) {
    setRevoking(fingerprint);
    try {
      await revokeSession(fingerprint);
      setSessions((prev) => prev?.filter((s) => s.fingerprint !== fingerprint) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't revoke that session.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Sessions</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Every device currently signed in to your account.
        </p>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {sessions === null && !error && <p className="text-sm text-neutral-400">Loading…</p>}

      {sessions && (
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => {
            const isCurrent = s.fingerprint === currentFingerprint;
            return (
              <li
                key={s.fingerprint}
                className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400">
                    <Laptop size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                      {describeSession(s.userAgent)}
                      {isCurrent && (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                          This device
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-400">
                      Last active {formatDate(s.lastUsedAt)} · signed in {formatDate(s.createdAt)}
                    </p>
                  </div>
                </div>
                {!isCurrent && (
                  <button
                    onClick={() => handleRevoke(s.fingerprint)}
                    disabled={revoking === s.fingerprint}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    <ShieldX size={13} />
                    {revoking === s.fingerprint ? "Signing out…" : "Sign out"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
