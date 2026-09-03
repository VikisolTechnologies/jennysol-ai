import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { cosineSimilarity } from "./embeddings.js";

export interface StoredChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embedding: Float32Array;
}

function toBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function fromBlob(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

export function insertDocument(userId: string, id: string, filename: string) {
  db.prepare("INSERT INTO documents (id, user_id, filename) VALUES (?, ?, ?)").run(id, userId, filename);
}

export function insertChunks(
  documentId: string,
  chunks: { text: string; index: number; embedding: Float32Array }[]
) {
  const insert = db.prepare(
    "INSERT INTO chunks (id, document_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMany = db.transaction((rows: typeof chunks) => {
    for (const c of rows) {
      insert.run(randomUUID(), documentId, c.index, c.text, toBlob(c.embedding));
    }
  });
  insertMany(chunks);
}

export function listDocuments(userId: string) {
  return db
    .prepare(
      `SELECT d.id, d.filename, d.uploaded_at as uploadedAt, COUNT(c.id) as chunkCount
       FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
       WHERE d.user_id = ?
       GROUP BY d.id ORDER BY d.uploaded_at DESC`
    )
    .all(userId);
}

export function documentBelongsToUser(userId: string, documentId: string): boolean {
  return !!db.prepare("SELECT 1 FROM documents WHERE id = ? AND user_id = ?").get(documentId, userId);
}

export function deleteDocument(userId: string, id: string) {
  db.prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(id, userId);
}

// Scoped by owner via a join, not filtered after the fact — a user's search
// only ever ranks against chunks belonging to documents they themselves
// uploaded.
export function searchSimilarChunks(userId: string, queryEmbedding: Float32Array, topK = 5): StoredChunk[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.document_id as documentId, c.chunk_index as chunkIndex, c.text, c.embedding
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.user_id = ?`
    )
    .all(userId) as { id: string; documentId: string; chunkIndex: number; text: string; embedding: Buffer }[];

  const scored = rows.map((row) => {
    const embedding = fromBlob(row.embedding);
    return { ...row, embedding, score: cosineSimilarity(queryEmbedding, embedding) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
