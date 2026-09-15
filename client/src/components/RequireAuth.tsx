import { useEffect, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "../lib/AuthContext";

// JENNYSOL-UI-BUILD.md replaces the old JennySolIntro.tsx auto-dismissing
// cinematic overlay with real, interactive screens (Welcome → mic permission
// → first run) — see pages/jennysol/*.tsx. This component's job shrinks to
// just the redirect: a first-time user (or a replayed intro, via Sidebar's
// diagnostics) lands on "/start" instead of an overlay rendered in place.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, introReplayToken, clearIntroReplay } = useAuth();

  // Consumed once, in an effect rather than inline during render — bumping
  // introReplayToken (Sidebar's "Replay welcome" diagnostic) should redirect
  // to /start exactly once per bump, not re-clear on every re-render this
  // component happens to go through while still on that screen.
  useEffect(() => {
    if (introReplayToken > 0) clearIntroReplay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introReplayToken]);

  if (loading) {
    return (
      <div className="flex h-[var(--app-vh)] w-screen items-center justify-center bg-jenny-void">
        <Sparkles size={22} className="animate-pulse text-jenny-gold" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (introReplayToken > 0 || !user.hasSeenWelcome) return <Navigate to="/start" replace />;

  return <>{children}</>;
}
