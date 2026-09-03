import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as authApi from "./auth";
import type { User } from "./auth";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { email: string; password: string; name: string; role: authApi.Role }) => Promise<void>;
  googleLogin: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  dismissWelcome: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const u = await authApi.fetchMe();
    setUser(u);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    // authFetch dispatches this if any request comes back 401 (e.g. the
    // session was revoked elsewhere, or a password reset invalidated it) —
    // without this listener the UI would keep showing a "logged in" state
    // that the server no longer honors.
    const onUnauthorized = () => setUser(null);
    window.addEventListener("jennysol-unauthorized", onUnauthorized);
    return () => window.removeEventListener("jennysol-unauthorized", onUnauthorized);
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    async login(email, password) {
      const u = await authApi.login(email, password);
      setUser(u);
    },
    async signup(input) {
      const u = await authApi.signup(input);
      setUser(u);
    },
    async googleLogin(credential) {
      const u = await authApi.googleLogin(credential);
      setUser(u);
    },
    async logout() {
      await authApi.logout();
      setUser(null);
    },
    refresh,
    // Optimistic local flip so the welcome overlay closes immediately
    // instead of waiting on a round trip; markWelcomeSeen persists it
    // server-side in the background (best-effort, see auth.ts).
    dismissWelcome() {
      authApi.markWelcomeSeen();
      setUser((u) => (u ? { ...u, hasSeenWelcome: true } : u));
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
