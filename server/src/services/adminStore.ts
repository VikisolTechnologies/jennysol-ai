import { db } from "../db/index.js";
import type { Role } from "./auth/userStore.js";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  authProvider: string;
  emailVerified: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  conversationCount: number;
  messageCount: number;
}

const USER_LIST_SELECT = `
  SELECT
    u.id, u.email, u.name, u.role, u.auth_provider as authProvider,
    u.email_verified as emailVerified, u.created_at as createdAt,
    (SELECT MAX(s.last_used_at) FROM sessions s WHERE s.user_id = u.id) as lastActiveAt,
    (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) as conversationCount,
    (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = u.id) as messageCount
  FROM users u
`;

function toAdminUser(row: Record<string, unknown>): AdminUserRow {
  return { ...row, emailVerified: !!row.emailVerified } as AdminUserRow;
}

export function listUsers(search: string, limit: number, offset: number): AdminUserRow[] {
  const rows = search
    ? db
        .prepare(`${USER_LIST_SELECT} WHERE u.name LIKE ? OR u.email LIKE ? ORDER BY u.created_at DESC LIMIT ? OFFSET ?`)
        .all(`%${search}%`, `%${search}%`, limit, offset)
    : db.prepare(`${USER_LIST_SELECT} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
  return (rows as Record<string, unknown>[]).map(toAdminUser);
}

export function countUsers(search: string): number {
  const row = search
    ? (db.prepare("SELECT COUNT(*) as count FROM users WHERE name LIKE ? OR email LIKE ?").get(`%${search}%`, `%${search}%`) as {
        count: number;
      })
    : (db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number });
  return row.count;
}

export function getAdminUser(id: string): AdminUserRow | null {
  const row = db.prepare(`${USER_LIST_SELECT} WHERE u.id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? toAdminUser(row) : null;
}

export interface AdminConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export function listConversationsForUser(userId: string): AdminConversationSummary[] {
  return db
    .prepare(
      `SELECT c.id, c.title, c.updated_at as updatedAt,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as messageCount
       FROM conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC`
    )
    .all(userId) as AdminConversationSummary[];
}

// Deliberately unscoped by requester — admin-only support tooling to read a
// user's own conversation for troubleshooting. A real, intentional privacy
// tradeoff (support access to private chat content), not an oversight; only
// reachable behind requireAdmin, and every call here is a conscious choice
// to give admins that access, not an accident of a shared code path.
export function getConversationForAdmin(
  conversationId: string
): { role: "user" | "assistant"; content: string; createdAt: string }[] {
  return db
    .prepare(
      `SELECT role, content, created_at as createdAt FROM messages
       WHERE conversation_id = ? ORDER BY created_at ASC`
    )
    .all(conversationId) as { role: "user" | "assistant"; content: string; createdAt: string }[];
}

export function conversationBelongsToUser(userId: string, conversationId: string): boolean {
  return !!db.prepare("SELECT 1 FROM conversations WHERE id = ? AND user_id = ?").get(conversationId, userId);
}

export interface DailyCount {
  day: string;
  count: number;
}

function dailyCounts(table: string, days: number): DailyCount[] {
  return db
    .prepare(
      `SELECT date(created_at) as day, COUNT(*) as count FROM ${table}
       WHERE created_at >= datetime('now', ?)
       GROUP BY date(created_at) ORDER BY day ASC`
    )
    .all(`-${days} days`) as DailyCount[];
}

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
  signupsByDay: DailyCount[];
  messagesByDay: DailyCount[];
}

export function getAdminStats(): AdminStats {
  const totalUsers = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
  const usersByRole = db.prepare("SELECT role, COUNT(*) as count FROM users GROUP BY role").all() as {
    role: string;
    count: number;
  }[];
  const usersByProvider = db
    .prepare("SELECT auth_provider as provider, COUNT(*) as count FROM users GROUP BY auth_provider")
    .all() as { provider: string; count: number }[];
  const newSignups7d = (
    db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now', '-7 days')").get() as { c: number }
  ).c;
  const newSignups30d = (
    db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now', '-30 days')").get() as { c: number }
  ).c;
  const activeUsers24h = (
    db
      .prepare("SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE last_used_at >= datetime('now', '-1 days')")
      .get() as { c: number }
  ).c;
  const activeUsers7d = (
    db
      .prepare("SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE last_used_at >= datetime('now', '-7 days')")
      .get() as { c: number }
  ).c;
  const totalConversations = (db.prepare("SELECT COUNT(*) as c FROM conversations").get() as { c: number }).c;
  const totalMessages = (db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c;

  return {
    totalUsers,
    usersByRole,
    usersByProvider,
    newSignups7d,
    newSignups30d,
    activeUsers24h,
    activeUsers7d,
    totalConversations,
    totalMessages,
    signupsByDay: dailyCounts("users", 14),
    messagesByDay: dailyCounts("messages", 14),
  };
}
