import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { Orb } from "../../components/orb/Orb";

// JENNYSOL-UI-BUILD.md §4.1 — the real product's front door, distinct from
// the marketing/legal "/welcome" route (pages/Landing.tsx's Aurora skin,
// explicitly out of this spec's scope — see JENNYSOL-UI-BUILD.md §11 "do
// not restyle anything outside these twelve screens"). Routed at "/start".
//
// "Continue as guest" isn't in the mockup's two actions, but removing the
// app's real, deliberate no-login-wall behavior (AuthContext auto-creates a
// guest session for every first-time visitor) would be a silent regression
// this spec never asked for — kept as a clearly tertiary third action
// instead of the mockup's two primaries.
export function Welcome() {
  const { dismissWelcome } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-[var(--app-vh)] flex-col items-center justify-center overflow-y-auto bg-jenny-void px-6 text-center text-jenny-text">
      <Orb state="speaking" size="xl" />

      <p className="mt-11 text-[12px] tracking-[0.45em] text-jenny-text-3">JENNYSOL</p>
      <p className="mx-8 mt-4 font-voice text-[22px] leading-[1.4] text-jenny-text">Your intelligence layer</p>
      <div className="mt-5 h-px w-8 bg-jenny-gold" />

      <div className="mt-16 w-full max-w-xs">
        <button
          onClick={() => navigate("/signup")}
          className="mb-2.5 w-full rounded-full bg-jenny-text py-3.5 text-[14px] font-medium text-jenny-void"
        >
          Get started
        </button>
        <button onClick={() => navigate("/login")} className="w-full py-2.5 text-[13px] text-jenny-muted">
          I already have an account
        </button>
        <button
          onClick={() => {
            dismissWelcome();
            navigate("/");
          }}
          className="mt-1 w-full py-1 text-[11px] text-jenny-muted underline decoration-dotted"
        >
          Continue as guest
        </button>
      </div>
    </div>
  );
}
