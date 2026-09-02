import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.resolve(import.meta.dirname, "../../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "jennysol.db"));
db.pragma("journal_mode = WAL");

db.exec(`
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
`);
