// Shared localStorage key names — kept in one place so AuthContext.tsx (the
// "start a new guest session" security fix, see docs/SECURITY_AUDIT.md) and
// MainApp.tsx (which owns reading/writing it day-to-day) never drift out of
// sync, and so neither file needs to import the other across the
// components/lib boundary.
export const ACTIVE_CONVERSATION_KEY = "jennysol-active-conversation";
