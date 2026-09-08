import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.resolve(import.meta.dirname, "../../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "jennysol.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'candidate',
    organization_id TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    ip TEXT,
    succeeded INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON login_attempts(email, created_at);

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sources TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

  CREATE TABLE IF NOT EXISTS error_logs (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    path TEXT,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);

  -- Rolling per-conversation summary of every message older than the recent
  -- sliding window ContextManager sends the model. through_index counts how
  -- many of the conversation's oldest messages are already folded into the
  -- summary text; anything from through_index up to (length - window size)
  -- is a gap the summarizer hasn't caught up on yet (see contextManager.ts).
  CREATE TABLE IF NOT EXISTS conversation_summaries (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    summary TEXT NOT NULL DEFAULT '',
    through_index INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per chat turn's full lifecycle, independent of any particular
  -- HTTP connection — this is what lets a request survive the browser
  -- closing, refreshing, or losing its network connection. See
  -- agentRunStore.ts and JENNY_IMPLEMENTATION_STATUS.md section 43.
  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    request_id TEXT,
    user_message TEXT NOT NULL,
    response_text TEXT NOT NULL DEFAULT '',
    provider TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    sources TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    first_event_at TEXT,
    first_token_at TEXT,
    completed_at TEXT,
    last_heartbeat_at TEXT,
    seen_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation ON agent_runs(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_user_status ON agent_runs(user_id, status);

  -- Append-only log of everything that happened during a run, so a client
  -- that reconnects mid-stream (or long after completion) can replay
  -- exactly what it missed via "?after=<id>" instead of re-deriving state.
  CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id, id);
`);

// Pre-auth deployments already have `documents`/`conversations` tables without a
// user_id column — CREATE TABLE IF NOT EXISTS above won't add it to an existing
// table, so migrate explicitly. Existing rows (created before auth existed) are
// left with user_id = NULL and become invisible to every user once routes are
// scoped by owner — orphaned rather than deleted, since destroying pre-auth data
// silently isn't this migration's call to make.
function addColumnIfMissing(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

addColumnIfMissing("documents", "user_id", "user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
addColumnIfMissing("conversations", "user_id", "user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
addColumnIfMissing("users", "google_id", "google_id TEXT");
addColumnIfMissing("users", "auth_provider", "auth_provider TEXT NOT NULL DEFAULT 'password'");
addColumnIfMissing("users", "has_seen_welcome", "has_seen_welcome INTEGER NOT NULL DEFAULT 0");
// A guest account is a real row in this table (so every existing
// user_id-scoped query — conversations, messages, agent_runs, documents —
// already works for it with zero special-casing) created automatically on
// first visit, with a synthetic unusable email/password. Upgrading to a
// full account (see userStore.upgradeGuestToFullAccount) updates this same
// row in place rather than creating a new one, which is what lets a guest's
// chat history carry over when they sign up.
addColumnIfMissing("users", "is_guest", "is_guest INTEGER NOT NULL DEFAULT 0");

// Defense-in-depth hardening: conversation_summaries was previously scoped
// only by conversation_id (an unguessable UUID, and in practice every real
// call site already validates ownership of that id before ever reaching
// this table) — adding user_id and requiring it in every query means a
// future call site that forgets to validate ownership first still can't
// leak another user's summary, rather than relying solely on "nobody would
// ever call this wrong." Non-destructive: existing rows get user_id = NULL
// and simply stop matching (see conversationStore.ts) — the summary is a
// performance cache, not authoritative data, so a miss just means that one
// conversation's context resends slightly more raw history until it
// resummarizes, never data loss or an error.
addColumnIfMissing("conversation_summaries", "user_id", "user_id TEXT REFERENCES users(id) ON DELETE CASCADE");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_summaries_user_id ON conversation_summaries(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
`);
