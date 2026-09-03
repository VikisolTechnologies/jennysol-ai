import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

// Client-side gate is purely a UX convenience (don't show admin nav to
// non-admins) — the real enforcement is server-side requireAdmin on every
// /api/admin/* route, which checks the role fresh from the DB on each
// request. Never trust this component alone for anything security-relevant.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}
