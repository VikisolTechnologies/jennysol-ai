import { Router } from "express";
import { z } from "zod";
import { embed } from "../services/embeddings.js";
import { searchSimilarChunks } from "../services/vectorStore.js";
import {
  buildSystemPrompt,
  streamChatCompletion,
  activeProviderMissingKey,
  type ChatTurn,
} from "../services/llm.js";
import {
  addMessage,
  conversationExists,
  createConversation,
  getConversationMessages,
} from "../services/conversationStore.js";

export const chatRouter = Router();

const chatRequestSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
});

chatRouter.post("/", async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { message } = parsed.data;
  const userId = req.userId!;

  // Conversation history lives server-side, keyed by conversationId, rather
  // than trusting the client to resend the whole transcript every request —
  // one source of truth, and the payload stays small on long conversations.
  // conversationExists is scoped by userId, so a conversationId belonging to
  // another user silently falls through to "create a new conversation"
  // rather than granting cross-account access.
  const conversationId =
    parsed.data.conversationId && conversationExists(userId, parsed.data.conversationId)
      ? parsed.data.conversationId
      : createConversation(userId, message);
  const history: ChatTurn[] = getConversationMessages(userId, conversationId);
  // Save the user's turn up front — if the LLM call below fails, the
  // question is still in history for a retry instead of being lost.
  addMessage(userId, conversationId, "user", message);

  try {
    const queryEmbedding = await embed(message);
    const matches = searchSimilarChunks(userId, queryEmbedding, 5);
    const systemPrompt = buildSystemPrompt(matches.map((m) => m.text));

    const turns: ChatTurn[] = [...history, { role: "user", content: message }];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`data: ${JSON.stringify({ conversationId })}\n\n`);

    let fullReply = "";
    await streamChatCompletion(systemPrompt, turns, (delta) => {
      fullReply += delta;
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    });

    const sources = matches.map((m) => ({ documentId: m.documentId, text: m.text.slice(0, 160) }));
    addMessage(userId, conversationId, "assistant", fullReply, sources);

    res.write(`data: ${JSON.stringify({ done: true, sources })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Chat failed:", err);
    const apiStatus = (err as { status?: number })?.status;
    const missingKey = activeProviderMissingKey();
    const message = missingKey
      ? `The server's ${missingKey} is missing. Set it in server/.env and restart the server.`
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
