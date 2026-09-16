import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestPasswordReset } from "../lib/auth";
import { JennyAuthChrome, JennyQuestion, JennyCommentary, JennyError } from "./jennysol/JennyAuthChrome";

// Real continuation of the sign-in flow (SignIn.tsx's "Forgot it?" link) —
// shares JennyAuthChrome rather than the old AuthLayout, so a user who
// leaves the conversational sign-in screen doesn't land on a second,
// unrelated visual system mid-flow.
export function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handlePrimary() {
    if (sent) {
      navigate("/login");
      return;
    }
    setError(null);
    if (!email.trim()) return setError("Enter your email to continue.");
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <JennyAuthChrome
      step={1}
      totalSteps={1}
      onBack={() => navigate("/login")}
      onPrimary={handlePrimary}
      primaryLoading={loading}
    >
      <JennyError message={error} />
      {sent ? (
        <>
          <JennyQuestion>Check your email.</JennyQuestion>
          <JennyCommentary>
            If an account exists for <strong className="text-jenny-text-2">{email}</strong>, a reset link is on its
            way.
          </JennyCommentary>
        </>
      ) : (
        <>
          <JennyQuestion>Where should I send the reset link?</JennyQuestion>
          <div className="mt-9 border-b border-jenny-gold pb-3">
            <input
              autoFocus
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent text-[19px] text-jenny-text outline-none"
              placeholder="you@example.com"
            />
          </div>
        </>
      )}
    </JennyAuthChrome>
  );
}
