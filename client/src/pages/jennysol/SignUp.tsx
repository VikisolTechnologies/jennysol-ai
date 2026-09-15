import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useAuth } from "../../lib/AuthContext";
import { GOOGLE_SIGN_IN_ENABLED, GoogleSignInButton } from "../../components/GoogleSignInButton";
import { JennyAuthChrome, JennyQuestion, JennyError } from "./JennyAuthChrome";

// JENNYSOL-UI-BUILD.md §4.3 — three steps: name, email, password, the
// password step greeting the user by the name just given, strength meter as
// four bars with commentary in words rather than a raw score. Role (a real,
// required field on Signup.tsx's OLD form) isn't part of the spec's three
// steps and isn't asked here: almost every real visitor already has a
// silently-created guest account by the time they reach this screen (see
// AuthContext's auto-guestLogin on first visit), so this form upgrades that
// guest in place (upgradeGuest — no role field on that endpoint at all)
// rather than running a fresh signup. The rare non-guest fallback still
// needs a role for the real API, so it defaults to "candidate" — the same
// default the old form pre-selected — without asking again in this flow.
type Step = "name" | "email" | "password";

function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (pw.length >= 14 || /[^A-Za-z0-9]/.test(pw)) score++;
  const labels = [
    "Needs at least 10 characters, upper and lower case, and a number.",
    "Getting there — a number or a longer phrase would help.",
    "That's strong. One more word would max it out.",
    "Maxed out — that's a strong password.",
  ];
  return { score, label: labels[Math.min(score, 3)] };
}

export function SignUp() {
  const { user, signup, upgradeGuest, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const strength = useMemo(() => passwordStrength(password), [password]);

  async function handlePrimary() {
    setError(null);
    if (step === "name") {
      if (!name.trim()) return setError("Tell me what to call you.");
      setStep("email");
      return;
    }
    if (step === "email") {
      if (!email.trim()) return setError("Enter your email to continue.");
      setStep("password");
      return;
    }
    if (strength.score < 2) return setError("That password needs to be a bit stronger.");
    setLoading(true);
    try {
      if (user?.isGuest) {
        await upgradeGuest({ name: name.trim(), email: email.trim(), password });
      } else {
        await signup({ name: name.trim(), email: email.trim(), password, role: "candidate" });
      }
      navigate("/mic-permission");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle(credential: string) {
    setError(null);
    setLoading(true);
    try {
      await googleLogin(credential);
      navigate("/mic-permission");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  const stepNum = step === "name" ? 1 : step === "email" ? 2 : 3;
  const firstName = name.trim().split(/\s+/)[0] || name;

  return (
    <JennyAuthChrome
      step={stepNum}
      totalSteps={3}
      onBack={() => {
        if (step === "password") return setStep("email");
        if (step === "email") return setStep("name");
        navigate("/start");
      }}
      onPrimary={handlePrimary}
      primaryLoading={loading}
    >
      <JennyError message={error} />
      {step === "name" && (
        <>
          <JennyQuestion>What should I call you?</JennyQuestion>
          <div className="mt-9 border-b border-jenny-gold pb-3">
            <input
              autoFocus
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-transparent text-[19px] text-jenny-text outline-none"
              placeholder="Your name"
            />
          </div>
          {GOOGLE_SIGN_IN_ENABLED && (
            <div className="mt-8">
              <div className="mb-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-jenny-muted">
                <div className="h-px flex-1 bg-jenny-hairline" />
                or
                <div className="h-px flex-1 bg-jenny-hairline" />
              </div>
              <GoogleSignInButton onCredential={handleGoogle} />
            </div>
          )}
        </>
      )}
      {step === "email" && (
        <>
          <JennyQuestion>Good to meet you, {firstName}.</JennyQuestion>
          <p className="font-voice text-[28px] leading-[1.2] text-jenny-muted sm:text-[31px]">What&rsquo;s your email?</p>
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
      {step === "password" && (
        <>
          <JennyQuestion>Pick a password.</JennyQuestion>
          <div className="mt-9 flex items-center justify-between border-b border-jenny-gold pb-3">
            <input
              autoFocus
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent text-[19px] tracking-widest text-jenny-text outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="shrink-0 text-jenny-muted"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <IconEyeOff size={18} /> : <IconEye size={18} />}
            </button>
          </div>
          <div className="mt-3.5 flex gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-0.5 flex-1 rounded-full ${i < strength.score ? "bg-jenny-ok" : "bg-jenny-raised-2"}`} />
            ))}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-jenny-muted">{strength.label}</p>
          <p className="mt-6 text-[11px] leading-relaxed text-jenny-muted">
            By continuing you agree to the terms and privacy policy.
          </p>
        </>
      )}
    </JennyAuthChrome>
  );
}
