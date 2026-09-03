import { authFetch } from "./auth";

export interface AdminStats {
  totalUsers: number;
  usersByRole: { role: string; count: number }[];
  usersByProvider: { provider: string; count: number }[];
  newSignups7d: number;
  newSignups30d: number;
  activeUsers24h: number;
  activeUsers7d: number;
  totalConversations: number;
  totalMessages: number;
  signupsByDay: { day: string; count: number }[];
  messagesByDay: { day: string; count: number }[];
}

async function parseOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function fetchAdminStats(): Promise<{ stats: AdminStats; errorsLast24h: number }> {
  const res = await authFetch("/api/admin/stats");
  return parseOrThrow(res);
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  authProvider: string;
  emailVerified: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  conversationCount: number;
  messageCount: number;
}

export async function fetchAdminUsers(
  query: string,
  page: number
): Promise<{ users: AdminUserRow[]; total: number; page: number; limit: number }> {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set("q", query);
  const res = await authFetch(`/api/admin/users?${params.toString()}`);
  return parseOrThrow(res);
}

export interface AdminConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export async function fetchAdminUser(
  id: string
): Promise<{ user: AdminUserRow; conversations: AdminConversationSummary[] }> {
  const res = await authFetch(`/api/admin/users/${id}`);
  return parseOrThrow(res);
}

export async function fetchAdminConversation(
  userId: string,
  conversationId: string
): Promise<{ messages: { role: "user" | "assistant"; content: string; createdAt: string }[] }> {
  const res = await authFetch(`/api/admin/users/${userId}/conversations/${conversationId}`);
  return parseOrThrow(res);
}

export interface AdminErrorEntry {
  id: string;
  level: string;
  message: string;
  stack: string | null;
  path: string | null;
  userId: string | null;
  createdAt: string;
}

export async function fetchAdminErrors(
  page: number
): Promise<{ errors: AdminErrorEntry[]; page: number; limit: number }> {
  const res = await authFetch(`/api/admin/errors?page=${page}`);
  return parseOrThrow(res);
}
