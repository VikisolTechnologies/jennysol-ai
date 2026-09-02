import { Router } from "express";
import { z } from "zod";
import { embed } from "../services/embeddings.js";
import { searchSimilarChunks } from "../services/vectorStore.js";
import { buildSystemPrompt, streamChatCompletion, type ChatTurn } from "../services/llm.js";

export const chatRouter = Router();

const chatRequestSchema = z.object({
  message: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
});

chatRouter.post("/", async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { message, history } = parsed.data;

  try {
    const queryEmbedding = await embed(message);
    const matches = searchSimilarChunks(queryEmbedding, 5);
    const systemPrompt = buildSystemPrompt(matches.map((m) => m.text));

    const turns: ChatTurn[] = [...history, { role: "user", content: message }];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    await streamChatCompletion(systemPrompt, turns, (delta) => {
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    });

    res.write(
      `data: ${JSON.stringify({
        done: true,
        sources: matches.map((m) => ({ documentId: m.documentId, text: m.text.slice(0, 160) })),
      })}\n\n`
    );
    res.end();
  } catch (err) {
    console.error("Chat failed:", err);
    const apiStatus = (err as { status?: number })?.status;
    const message = !process.env.GEMINI_API_KEY
      ? "The server's GEMINI_API_KEY is missing. Set it in server/.env and restart the server."
      : apiStatus
        ? `Chat request failed: ${(err as Error).message}`
        : "Chat request failed";
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    } else {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  }
});
