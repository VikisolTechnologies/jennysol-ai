import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as authApi from "./auth";
import type { User } from "./auth";
import { ACTIVE_CONVERSATION_KEY } from "./storageKeys";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { email: string; password: string; name: string; role: authApi.Role }) => Promise<void>;
  googleLogin: (credential: string) => Promise<void>;
  upgradeGuest: (input: { email: string; password: string; name: string }) => Promise<void>;
  logout: () => Promise<void>;
  // Guest-only escape hatch — see docs/SECURITY_AUDIT.md. A guest session
  // has no credentials to log back in with, so unlike logout() this doesn't
  // just clear the token: it immediately establishes a brand-new, distinct
  // guest identity (same mechanism as a first-time visitor) and reloads,
  // guaranteeing no in-memory state from the previous guest survives —
  // critical on a shared device where the next person must never see the
  // previous guest's conversations.
  startNewGuestSession: () => Promise<void>;
  refresh: () => Promise<void>;
  dismissWelcome: () => void;
  // Client-side only, never persisted or sent to the server — bumping this
  // makes RequireAuth show the intro again without touching the real
  // hasSeenWelcome flag, so replaying it for a demo never changes what a
  // returning visit shows on some OTHER device/session for this account.
  introReplayToken: number;
  replayIntro: () => void;
  clearIntroReplay: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [introReplayToken, setIntroReplayToken] = useState(0);

  async function refresh() {
    const u = await authApi.fetchMe();
    setUser(u);
  }

  useEffect(() => {
    (async () => {
      let u = await authApi.fetchMe();
      // No signed-in user (first visit, or a cleared/expired token) — start
      // a guest session automatically instead of forcing a login wall.
      // guestLogin() persists its own token the same way login()/signup()
      // do, so this is invisible on every subsequent visit: fetchMe() above
      // will just succeed with the same guest identity from then on.
      if (!u) {
        try {
          u = await authApi.guestLogin();
        } catch {
          // Network down, or the guest-creation rate limit (abuse
          // protection) was hit — fall through with user=null; RequireAuth
          // sends them to /login as a fallback rather than the app hanging.
        }
      }
      setUser(u);
      setLoading(false);
    })();
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
    async upgradeGuest(input) {
      const u = await authApi.upgradeGuestAccount(input);
      setUser(u);
    },
    async logout() {
      await authApi.logout();
      setUser(null);
    },
    async startNewGuestSession() {
      // logout() deletes the CURRENT session server-side (see
      // /api/auth/logout) and clears the token — the previous guest's
      // conversations are untouched in the database (orphaned, not
      // deleted; still recoverable if that guest later signs up from a
      // browser that still has their old token), just no longer reachable
      // from this browser.
      await authApi.logout().catch(() => {});
      try {
        localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      } catch {
        // storage unavailable — nothing to clear, the reload below still
        // lands on a clean boot either way
      }
      // A full reload (rather than calling guestLogin() + setUser() here)
      // is deliberate: it re-runs every component's initial state from
      // scratch, which is the only way to be certain nothing an earlier
      // guest's session populated into React state (loaded messages,
      // refs, in-flight requests) survives the switch. The boot effect
      // above sees no token and calls guestLogin() itself, exactly like a
      // first-time visitor.
      window.location.reload();
    },
    refresh,
    // Optimistic local flip so the welcome overlay closes immediately
    // instead of waiting on a round trip; markWelcomeSeen persists it
    // server-side in the background (best-effort, see auth.ts).
    dismissWelcome() {
      authApi.markWelcomeSeen();
      setUser((u) => (u ? { ...u, hasSeenWelcome: true } : u));
    },
    introReplayToken,
    replayIntro() {
      setIntroReplayToken((t) => t + 1);
    },
    clearIntroReplay() {
      setIntroReplayToken(0);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
