import { Router } from "express";
import {
  conversationExists,
  deleteConversation,
  getConversationMessages,
  listConversations,
} from "../services/conversationStore.js";

export const conversationsRouter = Router();

conversationsRouter.get("/", (req, res) => {
  res.json({ conversations: listConversations(req.userId!) });
});

conversationsRouter.get("/:id", (req, res) => {
  if (!conversationExists(req.userId!, req.params.id)) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json({ messages: getConversationMessages(req.userId!, req.params.id) });
});

conversationsRouter.delete("/:id", (req, res) => {
  deleteConversation(req.userId!, req.params.id);
  res.status(204).send();
});
