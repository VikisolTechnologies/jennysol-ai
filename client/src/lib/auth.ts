const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const TOKEN_KEY = "jennysol-auth-token";

export const ROLES = [
  { value: "candidate", label: "Candidate / Job Seeker" },
  { value: "recruiter", label: "Recruiter" },
  { value: "business", label: "Business / Client" },
  { value: "software_company", label: "Software Company" },
  { value: "freelancer", label: "Freelancer" },
  { value: "university", label: "University" },
  { value: "training_institute", label: "Training Institute" },
  { value: "admin", label: "Admin" },
] as const;
export type Role = (typeof ROLES)[number]["value"];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
  emailVerified: boolean;
  authProvider: "password" | "google" | "guest";
  hasSeenWelcome: boolean;
  isGuest: boolean;
  createdAt: string;
}

// fetch() rejects with a raw, browser-specific TypeError when a request
// never reaches the server at all (offline, DNS failure, CORS rejection,
// dropped connection) — "Load failed" in Safari, "Failed to fetch" in
// Chrome. Left uncaught, that string ends up shown to the user verbatim as
// if it meant something. Route every request through this so a real network
// failure gets a message that actually explains what happened, while HTTP
// error responses (which already carry a proper server message) pass through
// untouched.
async function doFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error("Can't reach the server right now. Check your connection and try again.");
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable (private browsing etc.) — auth just won't persist across reloads
  }
}

// Every other API module (chat, documents, image, speech, conversations)
// calls this instead of raw fetch, so the auth header and 401 handling live
// in exactly one place.
// Best-effort — Intl.DateTimeFormat is available in every browser this app
// already requires (it's also used for date formatting elsewhere), but this
// stays defensive since a missing/failed timezone header just means the
// server falls back to UTC (see server's dateTime.ts), never a broken request.
function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const timezone = browserTimezone();
  if (timezone) headers.set("X-Timezone", timezone);
  const res = await doFetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent("jennysol-unauthorized"));
  }
  return res;
}

async function parseOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function signup(input: {
  email: string;
  password: string;
  name: string;
  role: Role;
}): Promise<User> {
  const res = await doFetch(`${API_BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await parseOrThrow(res);
  setToken(data.token);
  return data.user;
}

export async function login(email: string, password: string): Promise<User> {
  const res = await doFetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseOrThrow(res);
  setToken(data.token);
  return data.user;
}

// Called automatically on first visit (see AuthContext.tsx) — there is no
// "please log in" wall before you can talk to Jenny. Creates a real user
// row server-side with a synthetic email/password nobody ever sees; the
// returned session token behaves exactly like a normal login's from here
// on, so every other API call needs zero special-casing for guests.
export async function guestLogin(): Promise<User> {
  const res = await doFetch(`${API_BASE}/api/auth/guest`, { method: "POST" });
  const data = await parseOrThrow(res);
  setToken(data.token);
  return data.user;
}

// Upgrades the currently-signed-in guest into a full account in place —
// same user id, same session, so their chat history carries over. Only
// valid while the current session belongs to a guest; the server rejects
// this otherwise.
export async function upgradeGuestAccount(input: { email: string; password: string; name: string }): Promise<User> {
  const res = await authFetch("/api/auth/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await parseOrThrow(res);
  return data.user;
}

export async function googleLogin(credential: string): Promise<User> {
  const res = await doFetch(`${API_BASE}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const data = await parseOrThrow(res);
  setToken(data.token);
  return data.user;
}

export async function markWelcomeSeen(): Promise<void> {
  await authFetch("/api/auth/mark-welcome-seen", { method: "POST" }).catch(() => {});
}

export async function logout(): Promise<void> {
  await authFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  setToken(null);
}

export async function logoutAllDevices(): Promise<void> {
  await authFetch("/api/auth/logout-all", { method: "POST" });
  setToken(null);
}

export async function fetchMe(): Promise<User | null> {
  if (!getToken()) return null;
  const res = await authFetch("/api/auth/me");
  if (!res.ok) return null;
  const data = await res.json();
  return data.user;
}

export async function updateProfile(name: string): Promise<User> {
  const res = await authFetch("/api/auth/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await parseOrThrow(res);
  return data.user;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await authFetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  await parseOrThrow(res);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const res = await doFetch(`${API_BASE}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  await parseOrThrow(res);
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const res = await doFetch(`${API_BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  await parseOrThrow(res);
}

export async function verifyEmail(token: string): Promise<void> {
  const res = await doFetch(`${API_BASE}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  await parseOrThrow(res);
}

export async function resendVerification(): Promise<void> {
  const res = await authFetch("/api/auth/resend-verification", { method: "POST" });
  await parseOrThrow(res);
}
