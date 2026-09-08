import { useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { JennySolIntro } from "./intro/JennySolIntro";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, dismissWelcome, introReplayToken, clearIntroReplay } = useAuth();
  // Local flag so dismissing plays the exit animation before children ever
  // mount, instead of popping straight to the app the instant the optimistic
  // user.hasSeenWelcome flip in AuthContext lands.
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  if (loading) {
    return (
      <div className="flex h-[var(--app-vh)] w-screen items-center justify-center bg-white dark:bg-neutral-950">
        <Sparkles size={22} className="animate-pulse text-brand-500" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // introReplayToken is a purely client-side, non-persisted counter (see
  // AuthContext's replayIntro) — bumping it re-satisfies this condition
  // without ever touching the server-side hasSeenWelcome flag, so "replay
  // the intro" for a demo never affects what a returning visit shows.
  if ((!user.hasSeenWelcome && !welcomeDismissed) || introReplayToken > 0) {
    return (
      <JennySolIntro
        name={user.name}
        onDone={() => {
          if (introReplayToken > 0) clearIntroReplay();
          else dismissWelcome();
          setWelcomeDismissed(true);
        }}
      />
    );
  }

  return <>{children}</>;
}
