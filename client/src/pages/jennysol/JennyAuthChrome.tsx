import type { ReactNode } from "react";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { Orb } from "../../components/orb/Orb";

// JENNYSOL-UI-BUILD.md §4 — "Auth — conversational, one question per
// screen." Shared chrome for sign-in/create-account: small orb marker +
// JENNY eyebrow, progress ticks top-right (gold for done, border for
// remaining), circular gold arrow bottom-right with a secondary text
// action to its left. Every step (SignIn.tsx, SignUp.tsx) supplies only
// its question, field(s) and commentary as children.
export function JennyAuthChrome({
  step,
  totalSteps,
  onBack,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryLoading,
  secondary,
}: {
  step: number;
  totalSteps: number;
  onBack: () => void;
  children: ReactNode;
  primaryLabel?: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  secondary?: ReactNode;
}) {
  return (
    <div className="flex h-[var(--app-vh)] flex-col overflow-y-auto bg-jenny-void text-jenny-text">
      <div className="flex shrink-0 items-center justify-between px-5 pt-[calc(1.1rem+env(safe-area-inset-top))]">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full text-jenny-muted transition hover:text-jenny-text-2"
          aria-label="Back"
        >
          <IconArrowLeft size={19} />
        </button>
        <div
          className="flex gap-1.5"
          role="progressbar"
          aria-label={`Step ${step} of ${totalSteps}`}
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
        >
          {Array.from({ length: totalSteps }, (_, i) => (
            <span key={i} className={`block h-0.5 w-4 rounded-full ${i < step ? "bg-jenny-gold" : "bg-jenny-raised-2"}`} />
          ))}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!primaryDisabled && !primaryLoading) onPrimary();
        }}
        className="flex flex-1 flex-col px-6 pt-8 sm:mx-auto sm:w-full sm:max-w-sm"
      >
        <div className="mb-6 flex items-center gap-3">
          {/* "asleep", not "speaking" -- nothing is actually being spoken on
              a typed form screen (this is also the exact reason the
              voice-driven auth mockup was dropped: no real audio state
              exists here to represent honestly). Showing "speaking" (a
              filled, pulsing core) when nothing is playing is what read as
              a dead, meaningless dot -- asleep's plain outline ring is the
              only state that's actually true here. */}
          <Orb state="asleep" size="sm" />
          <span className="text-[10px] tracking-[0.3em] text-jenny-muted">JENNY</span>
        </div>

        <div className="flex-1">{children}</div>

        <div className="flex shrink-0 items-center gap-3 pb-[calc(1.9rem+env(safe-area-inset-bottom))] pt-6">
          {secondary && <span className="flex-1 text-[13px] text-jenny-muted">{secondary}</span>}
          <button
            type="submit"
            disabled={primaryDisabled || primaryLoading}
            aria-label={primaryLabel ?? "Continue"}
            className="ml-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-jenny-gold text-jenny-ink-on-gold transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {primaryLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-jenny-ink-on-gold border-t-transparent" />
            ) : (
              <IconArrowRight size={23} />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export function JennyQuestion({ children }: { children: ReactNode }) {
  return <p className="font-voice text-[28px] leading-[1.2] text-jenny-text sm:text-[31px]">{children}</p>;
}

export function JennyCommentary({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[13px] leading-relaxed text-jenny-muted">{children}</p>;
}

export function JennyError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mb-4 rounded-lg bg-jenny-bad/10 px-3 py-2 text-[13px] text-jenny-bad">{message}</p>;
}
