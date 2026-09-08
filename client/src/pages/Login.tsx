import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { GOOGLE_SIGN_IN_ENABLED, GoogleSignInButton } from "../components/GoogleSignInButton";
import { AuthLayout, AuthError, AuthField, AuthSubmit } from "./AuthLayout";

export function Login() {
  const { login, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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
      title="Welcome back"
      subtitle="Log in to JennySol AI"
      footer={
        <>
          New here?{" "}
          <Link to="/signup" className="font-medium text-brand-500 hover:underline">
            Create an account
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
        <AuthField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <div className="mb-3 text-right">
          <Link to="/forgot-password" className="text-xs text-neutral-500 hover:text-brand-500 dark:text-neutral-400">
            Forgot password?
          </Link>
        </div>
        <AuthSubmit loading={loading}>Log in</AuthSubmit>
      </form>
    </AuthLayout>
  );
}
