import { useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { useAuth } from "../lib/AuthContext";

// Shown either as a periodic nudge (ChatWindow, every Nth guest message —
// see chat.ts's guest.progress event — never blocking the message itself)
// or proactively (Sidebar's "Save your chats" prompt). Upgrading keeps the
// same user id/session — see server/src/routes/auth.ts's /upgrade route —
// so every message the guest
// already sent stays exactly where it is; this modal only exists to collect
// the email/password/name that turns the account into a full one.
export function GuestLimitModal({
  open,
  reason,
  onClose,
  onUpgraded,
}: {
  open: boolean;
  reason: "limit" | "manual";
  onClose: () => void;
  onUpgraded: () => void;
}) {
  const { upgradeGuest } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await upgradeGuest({ name, email, password });
      onUpgraded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-neutral-900">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-md shadow-brand-500/30">
              <Sparkles size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                {reason === "limit" ? "Enjoying the conversation?" : "Save your chats"}
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {reason === "limit"
                  ? "Sign up — free — so this conversation (and the next ones) are saved to your account."
                  : "Create a free account so your chats aren't lost if you clear your browser."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-white/10 dark:hover:text-neutral-300"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-base outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5 dark:text-neutral-100"
            />
          </label>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-base outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5 dark:text-neutral-100"
            />
          </label>
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-base outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5 dark:text-neutral-100"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-gradient px-3 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Sign up and keep chatting"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
