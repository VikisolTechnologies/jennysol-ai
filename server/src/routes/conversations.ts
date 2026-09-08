import { Router } from "express";
import { z } from "zod";
import {
  conversationExists,
  deleteConversation,
  getConversationMessages,
  listConversations,
  renameConversation,
} from "../services/conversationStore.js";
import { zodErrorMessage } from "../utils/zodError.js";

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

// Strips C0 control characters (a title is a single line of UI text, never
// a place for embedded newlines/tabs/etc.) before validating length —
// Unicode text and emoji are untouched, they live well outside that range.
const renameSchema = z.object({
  title: z
    .string()
    .transform((s) => s.replace(/[\x00-\x1F\x7F]/g, "").trim())
    .pipe(z.string().min(1, "Title can't be empty").max(200, "Title is too long")),
});

conversationsRouter.patch("/:id", (req, res) => {
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  // renameConversation's own WHERE (id AND user_id) is the real
  // authorization boundary; this existence check up front is just what
  // turns "0 rows affected because it's someone else's" into an honest 404
  // instead of a silent 200 that changed nothing.
  const renamed = renameConversation(req.userId!, req.params.id, parsed.data.title);
  if (!renamed) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json({ title: parsed.data.title });
});

conversationsRouter.delete("/:id", (req, res) => {
  deleteConversation(req.userId!, req.params.id);
  res.status(204).send();
});
