import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useAuth } from "../../lib/AuthContext";
import { GOOGLE_SIGN_IN_ENABLED, GoogleSignInButton } from "../../components/GoogleSignInButton";
import { JennyAuthChrome, JennyQuestion, JennyError } from "./JennyAuthChrome";

// JENNYSOL-UI-BUILD.md §4.2 — two steps, "What's your email?" then "And
// your password?", the second showing the entered email with a `change`
// action. SSO is Google in this real codebase (GoogleSignInButton), not the
// spec's illustrative "Microsoft" — the pattern (a secondary SSO action)
// is what's settled, not the specific provider name.
type Step = "email" | "password";

export function SignIn() {
  const { login, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePrimary() {
    setError(null);
    if (step === "email") {
      if (!email.trim()) return setError("Enter your email to continue.");
      setStep("password");
      return;
    }
    if (!password) return setError("Enter your password to continue.");
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign you in.");
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
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <JennyAuthChrome
      step={step === "email" ? 1 : 2}
      totalSteps={2}
      onBack={() => (step === "password" ? setStep("email") : navigate("/start"))}
      onPrimary={handlePrimary}
      primaryLoading={loading}
      secondary={
        step === "password" ? (
          <button type="button" onClick={() => setStep("email")} className="underline decoration-dotted">
            {email}
          </button>
        ) : undefined
      }
    >
      <JennyError message={error} />
      {step === "email" ? (
        <>
          <JennyQuestion>What&rsquo;s your email?</JennyQuestion>
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
          {GOOGLE_SIGN_IN_ENABLED && (
            <div className="mt-8">
              <div className="mb-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-jenny-dim">
                <div className="h-px flex-1 bg-jenny-hairline" />
                or
                <div className="h-px flex-1 bg-jenny-hairline" />
              </div>
              <GoogleSignInButton onCredential={handleGoogle} />
            </div>
          )}
        </>
      ) : (
        <>
          <JennyQuestion>And your password?</JennyQuestion>
          <div className="mt-9 flex items-center justify-between border-b border-jenny-gold pb-3">
            <input
              autoFocus
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent text-[19px] tracking-widest text-jenny-text outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="shrink-0 text-jenny-dim"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate("/forgot-password")}
            className="mt-4 text-xs text-jenny-muted"
          >
            Forgot it? I can send a reset link.
          </button>
        </>
      )}
    </JennyAuthChrome>
  );
}
