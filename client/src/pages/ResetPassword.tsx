import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../lib/auth";
import { JennyAuthChrome, JennyQuestion, JennyCommentary, JennyError } from "./jennysol/JennyAuthChrome";

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handlePrimary() {
    if (done) return;
    setError(null);
    if (!password) return setError("Enter a new password to continue.");
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <JennyAuthChrome step={1} totalSteps={1} onBack={() => navigate("/forgot-password")} onPrimary={() => navigate("/forgot-password")}>
        <JennyQuestion>This link is missing its token.</JennyQuestion>
        <JennyCommentary>Request a new reset link and try again.</JennyCommentary>
      </JennyAuthChrome>
    );
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
      {done ? (
        <>
          <JennyQuestion>Password updated.</JennyQuestion>
          <JennyCommentary>Every other session was signed out for safety. Taking you to sign in…</JennyCommentary>
        </>
      ) : (
        <>
          <JennyQuestion>Choose a new password.</JennyQuestion>
          <div className="mt-9 border-b border-jenny-gold pb-3">
            <input
              autoFocus
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent text-[19px] tracking-widest text-jenny-text outline-none"
            />
          </div>
          <JennyCommentary>At least 10 characters, with upper and lower case letters and a number.</JennyCommentary>
        </>
      )}
    </JennyAuthChrome>
  );
}
