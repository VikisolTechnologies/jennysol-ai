import { Router } from "express";
import { z } from "zod";
import { generateSpeech } from "../services/providers/geminiTts.js";

export const speechRouter = Router();

const speechRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  voice: z.string().min(1),
});

speechRouter.post("/", async (req, res) => {
  const parsed = speechRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({
      error: "The server's GEMINI_API_KEY is missing. Set it in server/.env and restart the server.",
    });
    return;
  }

  try {
    const speech = await generateSpeech(parsed.data.text, parsed.data.voice);
    res.json(speech);
  } catch (err) {
    console.error("Speech generation failed:", err);
    const status = (err as { status?: number })?.status;
    const message =
      status === 429
        ? "Speech generation is rate-limited or not included in this Gemini API key's current plan."
        : err instanceof Error
          ? err.message
          : "Speech generation failed";
    res.status(500).json({ error: message });
  }
});
