import { useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset } from "../lib/auth";
import { AuthLayout, AuthError, AuthField, AuthSubmit } from "./AuthLayout";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a reset link"
      footer={
        <Link to="/login" className="font-medium text-brand-500 hover:underline">
          Back to login
        </Link>
      }
    >
      {sent ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          If an account exists for <strong>{email}</strong>, a reset link is on its way. Check the address you
          entered and (if you're running this locally without an email provider configured yet) the server console.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <AuthError message={error} />
          <AuthField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <AuthSubmit loading={loading}>Send reset link</AuthSubmit>
        </form>
      )}
    </AuthLayout>
  );
}
