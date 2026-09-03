import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { AuthLayout, AuthError, AuthField, AuthSubmit } from "./AuthLayout";

export function Login() {
  const { login } = useAuth();
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

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to Jennysol AI"
      footer={
        <>
          New here?{" "}
          <Link to="/signup" className="font-medium text-brand-500 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
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
