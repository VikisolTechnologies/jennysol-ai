import { Router } from "express";
import {
  conversationExists,
  deleteConversation,
  getConversationMessages,
  listConversations,
} from "../services/conversationStore.js";

export const conversationsRouter = Router();

conversationsRouter.get("/", (_req, res) => {
  res.json({ conversations: listConversations() });
});

conversationsRouter.get("/:id", (req, res) => {
  if (!conversationExists(req.params.id)) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json({ messages: getConversationMessages(req.params.id) });
});

conversationsRouter.delete("/:id", (req, res) => {
  deleteConversation(req.params.id);
  res.status(204).send();
});
