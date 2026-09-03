import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "../lib/AuthContext";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white dark:bg-neutral-950">
        <Sparkles size={22} className="animate-pulse text-brand-500" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
