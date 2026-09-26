// JENNYSOL-ARCHITECTURE.md §6's self-service gap: exporting and deleting ALL of a user's
// remembered documents in one action, not one document at a time (deleteDocument already existed
// and is exercised elsewhere — security.test.ts, guestIsolation.test.ts — this file is only the
// two new functions).
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db/index.js";
import { insertDocument, insertChunks, listDocuments, deleteAllDocumentsForUser, exportAllDocumentsForUser } from "./vectorStore.js";

function seedUser(userId: string) {
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)").run(userId, `${userId}@test.local`, "x", userId);
}

const vec = () => new Float32Array(384).fill(0.1);

beforeEach(() => {
  db.exec("DELETE FROM chunks; DELETE FROM documents; DELETE FROM users;");
});

describe("exportAllDocumentsForUser", () => {
  it("returns every document's chunk text, in order, scoped to the caller's own user id", () => {
    seedUser("u1");
    seedUser("u2");
    insertDocument("u1", "doc-1", "notes.txt");
    insertChunks("doc-1", [
      { text: "first chunk", index: 0, embedding: vec() },
      { text: "second chunk", index: 1, embedding: vec() },
    ]);
    insertDocument("u2", "doc-2", "someone-elses.txt");
    insertChunks("doc-2", [{ text: "not yours", index: 0, embedding: vec() }]);

    const exported = exportAllDocumentsForUser("u1");

    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ id: "doc-1", filename: "notes.txt", chunks: ["first chunk", "second chunk"] });
    expect(JSON.stringify(exported)).not.toContain("not yours");
  });

  it("never includes the raw embedding vectors — only the text that was actually embedded", () => {
    seedUser("u1");
    insertDocument("u1", "doc-1", "notes.txt");
    insertChunks("doc-1", [{ text: "hello", index: 0, embedding: vec() }]);

    const exported = exportAllDocumentsForUser("u1");
    expect(JSON.stringify(exported)).not.toMatch(/embedding/i);
  });

  it("an export for a user with nothing uploaded is an empty array, not an error", () => {
    seedUser("u1");
    expect(exportAllDocumentsForUser("u1")).toEqual([]);
  });
});

describe("deleteAllDocumentsForUser", () => {
  it("deletes every one of the caller's own documents (and their chunks, via the FK cascade) in one call", () => {
    seedUser("u1");
    insertDocument("u1", "doc-1", "a.txt");
    insertDocument("u1", "doc-2", "b.txt");
    insertChunks("doc-1", [{ text: "x", index: 0, embedding: vec() }]);
    insertChunks("doc-2", [{ text: "y", index: 0, embedding: vec() }]);

    const deleted = deleteAllDocumentsForUser("u1");

    expect(deleted).toBe(2);
    expect(listDocuments("u1")).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) as n FROM chunks").get()).toEqual({ n: 0 });
  });

  it("never touches another user's documents", () => {
    seedUser("u1");
    seedUser("u2");
    insertDocument("u1", "doc-1", "mine.txt");
    insertDocument("u2", "doc-2", "theirs.txt");

    deleteAllDocumentsForUser("u1");

    expect(listDocuments("u1")).toEqual([]);
    expect(listDocuments("u2")).toHaveLength(1);
  });

  it("deleting when there's nothing to delete reports 0, not an error", () => {
    seedUser("u1");
    expect(deleteAllDocumentsForUser("u1")).toBe(0);
  });
});
