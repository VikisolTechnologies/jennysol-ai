import { Router } from "express";
import { z } from "zod";
import { generateImage } from "../services/providers/geminiImage.js";

export const imageRouter = Router();

const imageRequestSchema = z.object({
  prompt: z.string().min(1),
});

imageRouter.post("/", async (req, res) => {
  const parsed = imageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({
      error: "I can't generate images right now — image generation isn't set up on this server yet.",
    });
    return;
  }

  try {
    const image = await generateImage(parsed.data.prompt);
    res.json(image);
  } catch (err) {
    console.error("Image generation failed:", err);
    const status = (err as { status?: number })?.status;
    // Shown verbatim as Jenny's reply in the chat bubble — never leak raw
    // provider/billing/quota language here, talk the way she'd actually say it.
    const message =
      status === 429
        ? "I can't generate an image right now — I've hit today's limit on that. It'll free up again soon. In the meantime I can help you write a sharp prompt for another image tool, or just describe what you're picturing and I'll work with that."
        : "Something went wrong generating that image. Want to try rephrasing it, or describe what you're picturing and I'll help another way?";
    res.status(500).json({ error: message });
  }
});
