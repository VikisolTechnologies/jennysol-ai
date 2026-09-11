import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { updateProfile } from "../../lib/auth";
import { ROLES } from "../../lib/auth";

export function AccountProfile() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const dirty = name.trim() !== user.name && name.trim().length > 0;

  async function handleSave() {
    setStatus("saving");
    setError(null);
    try {
      await updateProfile(name.trim());
      await refresh();
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't save your changes. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Profile</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Your basic account information.
        </p>
      </div>

      {user.isGuest && (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-brand-300 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
          <Sparkles size={16} className="mt-0.5 shrink-0" />
          <span>
            You're using a temporary guest session — there's no email or password to manage yet.
            Sign up from the chat sidebar to turn this into a full account without losing your
            conversation history.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-white/10 dark:bg-neutral-900">
        <div>
          <label htmlFor="profile-name" className="block text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Display name
          </label>
          <input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none ring-brand-500/20 focus:ring-2 dark:border-white/15 dark:bg-neutral-950 dark:text-white"
          />
        </div>

        {!user.isGuest && (
          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400">Email</label>
            <p className="mt-1.5 text-sm text-neutral-700 dark:text-neutral-300">{user.email}</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400">Role</label>
          <p className="mt-1.5 text-sm text-neutral-700 dark:text-neutral-300">
            {ROLES.find((r) => r.value === user.role)?.label ?? user.role}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400">Member since</label>
          <p className="mt-1.5 text-sm text-neutral-700 dark:text-neutral-300">
            {new Date(user.createdAt.replace(" ", "T") + "Z").toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={!dirty || status === "saving"}
            className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "saving" ? "Saving…" : "Save changes"}
          </button>
          {status === "saved" && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Saved</span>}
          {status === "error" && <span className="text-xs font-medium text-rose-500">{error}</span>}
        </div>
      </div>
    </div>
  );
}
