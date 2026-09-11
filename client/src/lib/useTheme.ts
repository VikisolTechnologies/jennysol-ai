import { useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "jennysol-theme";

// No stored preference at all means "system" — matches index.html's
// pre-paint inline script exactly (it falls back to matchMedia when
// localStorage has no value), so there's never a mismatch between what
// paints before React mounts and what this hook resolves to afterward.
function getStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    // ignore (private browsing / storage disabled)
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? (systemPrefersDark() ? "dark" : "light") : preference;
}

// Powers both the existing chat-header toggle (theme/toggleTheme — always
// resolves to a concrete light/dark choice, same behavior as before this
// change) and the new Appearance settings page (preference/setPreference —
// a real three-way Dark/Light/System choice). One hook, one source of
// truth, so the two surfaces can never disagree about which theme is active.
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredPreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(preference));

  useEffect(() => {
    const next = resolve(preference);
    setResolvedTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      if (preference === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // ignore (private browsing / storage disabled) — just won't persist across reloads
    }

    if (preference !== "system") return;
    // Only "system" needs to react live to an OS-level theme change while
    // this page stays open — an explicit light/dark choice is deliberately
    // static until the user changes it again.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const dark = mq.matches;
      setResolvedTheme(dark ? "dark" : "light");
      document.documentElement.classList.toggle("dark", dark);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  return {
    // Legacy shape — unchanged for ChatWindow.tsx's existing toggle button.
    // Toggling always lands on a concrete light/dark choice (never
    // "system"), matching a simple two-state button's affordance.
    theme: resolvedTheme,
    toggleTheme: () => setPreferenceState(resolvedTheme === "dark" ? "light" : "dark"),
    // New — the Appearance settings page's three-way control.
    preference,
    setPreference: setPreferenceState,
    resolvedTheme,
  };
}
