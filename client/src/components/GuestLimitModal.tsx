import { useState } from "react";
import { Link } from "react-router-dom";
import { IconX } from "@tabler/icons-react";
import { useAuth } from "../lib/AuthContext";
import { Orb } from "./orb/Orb";

// Shown either as a periodic nudge (ChatWindow, every Nth guest message —
// see chat.ts's guest.progress event — never blocking the message itself)
// or proactively (Sidebar's "Save your chats" prompt). Upgrading keeps the
// same user id/session — see server/src/routes/auth.ts's /upgrade route —
// so every message the guest already sent stays exactly where it is; this
// modal only exists to collect the email/password/name that turns the
// account into a full one.
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-sm rounded-2xl border border-jenny-hairline-card bg-jenny-surface p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <Orb state="speaking" size="sm" />
            <div>
              <h2 className="font-voice text-base text-jenny-text">{reason === "limit" ? "Enjoying the conversation?" : "Save your chats"}</h2>
              <p className="mt-0.5 text-xs text-jenny-muted">
                {reason === "limit"
                  ? "Sign up — free — so this conversation (and the next ones) are saved to your account."
                  : "Create a free account so your chats aren't lost if you clear your browser."}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1 text-jenny-muted hover:bg-jenny-raised hover:text-jenny-text-3" aria-label="Dismiss">
            <IconX size={16} />
          </button>
        </div>

        {error && <p className="mb-3 rounded-lg bg-jenny-bad/10 px-3 py-2 text-xs text-jenny-bad">{error}</p>}

        <form onSubmit={handleSubmit}>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-jenny-text-3">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              className="w-full rounded-lg border border-jenny-border bg-jenny-raised px-3 py-2 text-base text-jenny-text outline-none focus:border-jenny-gold"
            />
          </label>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-jenny-text-3">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-jenny-border bg-jenny-raised px-3 py-2 text-base text-jenny-text outline-none focus:border-jenny-gold"
            />
          </label>
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium text-jenny-text-3">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full rounded-lg border border-jenny-border bg-jenny-raised px-3 py-2 text-base text-jenny-text outline-none focus:border-jenny-gold"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-jenny-gold px-3 py-2.5 text-sm font-semibold text-jenny-ink-on-gold transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Sign up and keep chatting"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-jenny-muted">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-jenny-champagne hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
