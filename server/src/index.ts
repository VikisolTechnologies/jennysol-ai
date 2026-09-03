import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { chatRouter } from "./routes/chat.js";
import { conversationsRouter } from "./routes/conversations.js";
import { documentsRouter } from "./routes/documents.js";
import { imageRouter } from "./routes/image.js";
import { speechRouter } from "./routes/speech.js";
import { activeProviderMissingKey } from "./services/llm.js";
import "./db/index.js";

const missingKey = activeProviderMissingKey();
if (missingKey) {
  console.warn(`[jennysol] ${missingKey} is not set — chat requests will fail. See server/.env.example.`);
}

// Same-origin deploys (or local dev via the Vite proxy) don't need CORS at
// all; set CORS_ORIGIN when the client is hosted separately (e.g. Vercel)
// so this API isn't left open to every origin.
const app = express();
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN } : {}));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/chat", chatRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/image", imageRouter);
app.use("/api/speech", speechRouter);

// In production, serve the built client so a single service hosts both the
// API and the UI — no separate static host needed for deployment.
const clientDist = path.resolve(import.meta.dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`[jennysol] server listening on http://localhost:${port}`);
});
