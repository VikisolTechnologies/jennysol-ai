import "dotenv/config";
import express from "express";
import cors from "cors";
import { chatRouter } from "./routes/chat.js";
import { documentsRouter } from "./routes/documents.js";
import "./db/index.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[jennysol] ANTHROPIC_API_KEY is not set — chat requests will fail. See server/.env.example.");
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/chat", chatRouter);
app.use("/api/documents", documentsRouter);

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`[jennysol] server listening on http://localhost:${port}`);
});
