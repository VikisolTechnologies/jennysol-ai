import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../lib/auth";
import { AuthLayout, AuthError, AuthField, AuthSubmit } from "./AuthLayout";

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Reset your password">
        <p className="text-sm text-rose-500">
          This link is missing its reset token. Request a new one from the{" "}
          <Link to="/forgot-password" className="text-brand-500 hover:underline">
            forgot password
          </Link>{" "}
          page.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      {done ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Password updated — every other session was signed out for safety. Taking you to login…
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <AuthError message={error} />
          <AuthField
            label="New password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <p className="-mt-2 mb-3 text-[11px] text-neutral-400">
            At least 10 characters, with upper and lower case letters and a number.
          </p>
          <AuthSubmit loading={loading}>Update password</AuthSubmit>
        </form>
      )}
    </AuthLayout>
  );
}
