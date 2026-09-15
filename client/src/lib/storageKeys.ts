// Shared localStorage key names — kept in one place so AuthContext.tsx (the
// "start a new guest session" security fix, see docs/SECURITY_AUDIT.md) and
// MainApp.tsx (which owns reading/writing it day-to-day) never drift out of
// sync, and so neither file needs to import the other across the
// components/lib boundary.
export const ACTIVE_CONVERSATION_KEY = "jennysol-active-conversation";
// Set by pages/jennysol/FirstRun.tsx when the user's very first action is a
// suggestion tap or typed line, read once by ChatWindow.tsx on mount and
// sent as the real opening message — sessionStorage (not localStorage)
// since it's only ever meant to survive the one navigation from /first-run
// into "/", never a later, unrelated visit.
export const PENDING_FIRST_MESSAGE_KEY = "jennysol-pending-first-message";
