import { useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { WelcomeAnimation } from "./WelcomeAnimation";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, dismissWelcome } = useAuth();
  // Local flag so dismissing plays the exit animation before children ever
  // mount, instead of popping straight to the app the instant the optimistic
  // user.hasSeenWelcome flip in AuthContext lands.
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white dark:bg-neutral-950">
        <Sparkles size={22} className="animate-pulse text-brand-500" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!user.hasSeenWelcome && !welcomeDismissed) {
    return (
      <WelcomeAnimation
        name={user.name}
        onDone={() => {
          dismissWelcome();
          setWelcomeDismissed(true);
        }}
      />
    );
  }

  return <>{children}</>;
}
