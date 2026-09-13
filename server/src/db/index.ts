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

  -- M9 (audit/observability, PROJECT-PROGRESS.md milestone model): a real, append-only trail of
  -- every product-gateway event distinguishable from a human-originated JennySol action, separate
  -- from error_logs (crashes) and agent_events (a single AgentRun's own SSE replay log). Scoped by
  -- product/external_user_id/tenant_id so a query can never return one identity's trail to
  -- another (see agentAuditLog.ts). detail is always run through memoryScope.ts's redactSecrets()
  -- before being stringified here — this table must never contain a raw service token, secret, or
  -- Authorization header value.
  CREATE TABLE IF NOT EXISTS agent_audit_log (
    id TEXT PRIMARY KEY,
    correlation_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    product TEXT,
    external_user_id TEXT,
    tenant_id TEXT,
    tool_name TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agent_audit_log_correlation ON agent_audit_log(correlation_id);
  CREATE INDEX IF NOT EXISTS idx_agent_audit_log_identity ON agent_audit_log(product, external_user_id, tenant_id);
  CREATE INDEX IF NOT EXISTS idx_agent_audit_log_created_at ON agent_audit_log(created_at);

  -- Multi-agent orchestration (docs/AI_AGENT_SYSTEM_ARCHITECTURE.md §5). Named agent_sessions, not
  -- sessions — that name is already taken by the auth-session table above; this is a deliberately
  -- separate, session-scoped analog of agent_runs, not an extension of it (one agent_sessions row
  -- can spawn many agent_tasks, each of which runs like an agent_run does today).
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    objective TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning',
    max_session_time_ms INTEGER,
    max_token_budget INTEGER,
    max_cost REAL,
    max_agent_count INTEGER,
    max_concurrent_agents INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_status ON agent_sessions(user_id, status);

  -- One row per top-level SessionMemory field (requirements, constraints, architecture, decisions,
  -- current_plan, changed_files, tests, audit_results, open_questions, ...), not one giant JSON
  -- blob — lets one agent update one section without a read-modify-write race on the whole object,
  -- and makes "what changed and when" (updated_by_agent_id/updated_at) a real query instead of a
  -- diff against history nobody kept.
  CREATE TABLE IF NOT EXISTS session_memory (
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by_agent_id TEXT,
    PRIMARY KEY (session_id, key)
  );

  -- A logical agent: one SQLite row, no model loaded and no process started until a scheduler
  -- (Phase 6) actually grants it an execution slot for a task. This is the literal mechanism behind
  -- "many logical agents, few concurrent model executions" (architecture doc §6) — creating 50 of
  -- these costs 50 row-writes, nothing else.
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    display_name TEXT NOT NULL,
    model_provider TEXT,
    model_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    capabilities TEXT,
    permissions TEXT,
    current_task_id TEXT,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);

  -- The task DAG. depends_on is a JSON array of other agent_tasks.id values (edges); a task becomes
  -- 'ready' only once every id in depends_on is 'completed' (Phase 3's readyTasks(), a plain
  -- topological check on this table — no separate graph library).
  CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    depends_on TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agent_tasks_session_status ON agent_tasks(session_id, status);
  CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agent_id);

  -- Generalizes agent_events' proven append-only/replay-by-id pattern from run scope to session
  -- scope. This table is the ONLY source of truth the live dashboard (Phase 13) ever renders from —
  -- see architecture doc §3's "fake autonomy" defense and §8.
  CREATE TABLE IF NOT EXISTS agent_session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agent_session_events_session ON agent_session_events(session_id, id);

  -- Phase 1 of code isolation (architecture doc §7): a WRITE-tier file tool must hold this lock
  -- before writing a path; a second agent requesting a held lock gets a real WAIT status, never a
  -- silent overwrite. released_at IS NULL means currently held.
  CREATE TABLE IF NOT EXISTS file_locks (
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
    released_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_file_locks_session_path ON file_locks(session_id, file_path);

  -- The human-steering queue (architecture doc §10). A CRITICAL-impact inbound message creates one
  -- of these and pauses every agent_task that transitively depends on the affected area; answering
  -- it (status -> 'answered') is what the scheduler's next tick checks before unblocking those tasks.
  CREATE TABLE IF NOT EXISTS user_decisions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    options TEXT,
    impact TEXT NOT NULL DEFAULT 'low',
    affected_agents TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    answer TEXT,
    answered_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_user_decisions_session_status ON user_decisions(session_id, status);
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
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    } catch (err) {
      // Confirmed real, not theoretical: the test suite runs each file in
      // its own worker process against the same on-disk SQLite file (see
      // vitest's isolate mode), so on the very first run after adding a
      // brand-new column, every worker's PRAGMA check above sees it as
      // missing and several race to ALTER TABLE at once — only the first
      // actually succeeds, the rest hit exactly this SQLite error. That
      // error message IS the proof the column now exists (by whichever
      // process won the race), so it's safe to treat as success rather
      // than crash startup; any other error still propagates.
      if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
    }
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

// Lets a manual rename (routes/conversations.ts's PATCH) permanently win
// over any future automatic re-titling — existing rows default to 'auto'
// (correct: none of them have been manually renamed, since this column
// didn't exist before). Not currently read by any auto-title logic (there
// isn't any beyond the one-time title set at creation — see
// conversationStore.ts's titleFrom), but recorded now so a future
// auto-retitling feature has something to check against from day one
// instead of needing its own migration later.
addColumnIfMissing("conversations", "title_source", "title_source TEXT NOT NULL DEFAULT 'auto'");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_summaries_user_id ON conversation_summaries(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`);
