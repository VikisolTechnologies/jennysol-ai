import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import pdfParse from "pdf-parse";
import { chunkText } from "../services/chunker.js";
import { embedBatch } from "../services/embeddings.js";
import { insertDocument, insertChunks, listDocuments, deleteDocument } from "../services/vectorStore.js";

const uploadsDir = path.resolve(import.meta.dirname, "../../data/uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({ dest: uploadsDir, limits: { fileSize: 20 * 1024 * 1024 } });
export const documentsRouter = Router();

async function extractText(filePath: string, mimetype: string, originalName: string): Promise<string> {
  if (mimetype === "application/pdf" || originalName.endsWith(".pdf")) {
    const buffer = fs.readFileSync(filePath);
    return (await pdfParse(buffer)).text;
  }
  return fs.readFileSync(filePath, "utf-8");
}

documentsRouter.get("/", (req, res) => {
  res.json({ documents: listDocuments(req.userId!) });
});

documentsRouter.post("/", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const text = await extractText(file.path, file.mimetype, file.originalname);
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      res.status(400).json({ error: "Document had no extractable text" });
      return;
    }

    const embeddings = await embedBatch(chunks.map((c) => c.text));
    const documentId = randomUUID();

    insertDocument(req.userId!, documentId, file.originalname);
    insertChunks(
      documentId,
      chunks.map((c, i) => ({ text: c.text, index: c.index, embedding: embeddings[i] }))
    );

    res.status(201).json({ id: documentId, filename: file.originalname, chunkCount: chunks.length });
  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).json({ error: "Failed to process document" });
  } finally {
    fs.unlink(file.path, () => {});
  }
});

documentsRouter.delete("/:id", (req, res) => {
  deleteDocument(req.userId!, req.params.id);
  res.status(204).send();
});
