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

export function insertDocument(id: string, filename: string) {
  db.prepare("INSERT INTO documents (id, filename) VALUES (?, ?)").run(id, filename);
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

export function listDocuments() {
  return db
    .prepare(
      `SELECT d.id, d.filename, d.uploaded_at as uploadedAt, COUNT(c.id) as chunkCount
       FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
       GROUP BY d.id ORDER BY d.uploaded_at DESC`
    )
    .all();
}

export function deleteDocument(id: string) {
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
}

export function searchSimilarChunks(queryEmbedding: Float32Array, topK = 5): StoredChunk[] {
  const rows = db
    .prepare(
      "SELECT id, document_id as documentId, chunk_index as chunkIndex, text, embedding FROM chunks"
    )
    .all() as { id: string; documentId: string; chunkIndex: number; text: string; embedding: Buffer }[];

  const scored = rows.map((row) => {
    const embedding = fromBlob(row.embedding);
    return { ...row, embedding, score: cosineSimilarity(queryEmbedding, embedding) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
