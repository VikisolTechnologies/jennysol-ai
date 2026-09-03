import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { ROLES, type Role } from "../lib/auth";
import { GOOGLE_SIGN_IN_ENABLED, GoogleSignInButton } from "../components/GoogleSignInButton";
import { AuthLayout, AuthError, AuthField, AuthSubmit } from "./AuthLayout";

export function Signup() {
  const { signup, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("candidate");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signup({ name, email, password, role });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle(credential: string) {
    setError(null);
    setLoading(true);
    try {
      await googleLogin(credential);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Get started with Jennysol AI"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-brand-500 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      {GOOGLE_SIGN_IN_ENABLED && (
        <>
          <GoogleSignInButton onCredential={handleGoogle} />
          <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-white/10" />
            or
            <div className="h-px flex-1 bg-neutral-200 dark:bg-white/10" />
          </div>
        </>
      )}
      <form onSubmit={handleSubmit}>
        <AuthError message={error} />
        <AuthField label="Name" value={name} onChange={setName} autoComplete="name" />
        <AuthField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <p className="-mt-2 mb-3 text-[11px] text-neutral-400">
          At least 10 characters, with upper and lower case letters and a number.
        </p>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">I am a…</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5 dark:text-neutral-100"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <AuthSubmit loading={loading}>Create account</AuthSubmit>
      </form>
    </AuthLayout>
  );
}
