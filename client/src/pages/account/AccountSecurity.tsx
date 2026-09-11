import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, LogOut, ShieldAlert } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { changePassword, logoutOtherSessions } from "../../lib/auth";
import { logoutAllDevices } from "../../lib/auth";

export function AccountSecurity() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [othersStatus, setOthersStatus] = useState<"idle" | "working" | "done" | "error">("idle");

  if (!user) return null;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setStatus("error");
      setError("New passwords don't match.");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
      setStatus("saved");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't change your password.");
    }
  }

  async function handleLogoutOthers() {
    setOthersStatus("working");
    try {
      await logoutOtherSessions();
      setOthersStatus("done");
      setTimeout(() => setOthersStatus("idle"), 2500);
    } catch {
      setOthersStatus("error");
    }
  }

  async function handleLogoutEverywhere() {
    if (!window.confirm("Sign out of every device, including this one?")) return;
    await logoutAllDevices();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Security</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Manage your password and active sessions.
        </p>
      </div>

      {user.isGuest ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-brand-300 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>Guest sessions have no password to change. Sign up first to set one.</span>
        </div>
      ) : (
        <form
          onSubmit={handleChangePassword}
          className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-white/10 dark:bg-neutral-900"
        >
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Change password</h2>
          <div className="flex flex-col gap-3">
            <input
              type={showPasswords ? "text" : "password"}
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none ring-brand-500/20 focus:ring-2 dark:border-white/15 dark:bg-neutral-950 dark:text-white"
            />
            <input
              type={showPasswords ? "text" : "password"}
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none ring-brand-500/20 focus:ring-2 dark:border-white/15 dark:bg-neutral-950 dark:text-white"
            />
            <input
              type={showPasswords ? "text" : "password"}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none ring-brand-500/20 focus:ring-2 dark:border-white/15 dark:bg-neutral-950 dark:text-white"
            />
            <button
              type="button"
              onClick={() => setShowPasswords((v) => !v)}
              className="flex w-fit items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              {showPasswords ? <EyeOff size={13} /> : <Eye size={13} />}
              {showPasswords ? "Hide" : "Show"} passwords
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={status === "saving"}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {status === "saving" ? "Updating…" : "Update password"}
            </button>
            {status === "saved" && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Password updated</span>}
            {status === "error" && <span className="text-xs font-medium text-rose-500">{error}</span>}
          </div>
          <p className="text-[11px] text-neutral-400">
            Changing your password automatically signs out every other device.
          </p>
        </form>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-white/10 dark:bg-neutral-900">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Sessions</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          See exactly which devices are signed in on the{" "}
          <a href="/account/sessions" className="text-brand-600 underline hover:no-underline dark:text-brand-400">
            Sessions page
          </a>
          .
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleLogoutOthers}
            disabled={othersStatus === "working"}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-white/15 dark:text-neutral-200 dark:hover:bg-white/5"
          >
            {othersStatus === "working" ? "Signing out other sessions…" : "Sign out other sessions"}
          </button>
          {othersStatus === "done" && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Done</span>}
          <button
            onClick={handleLogoutEverywhere}
            className="flex items-center gap-1.5 rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            <LogOut size={14} />
            Sign out everywhere
          </button>
        </div>
      </div>

      <button
        onClick={logout}
        className="w-fit text-xs text-neutral-400 underline decoration-dotted hover:text-neutral-600 dark:hover:text-neutral-300"
      >
        Just sign out this device
      </button>
    </div>
  );
}
