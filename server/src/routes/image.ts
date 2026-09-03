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
      error: "The server's GEMINI_API_KEY is missing. Set it in server/.env and restart the server.",
    });
    return;
  }

  try {
    const image = await generateImage(parsed.data.prompt);
    res.json(image);
  } catch (err) {
    console.error("Image generation failed:", err);
    const status = (err as { status?: number })?.status;
    const message =
      status === 429
        ? "Image generation is rate-limited or not included in this Gemini API key's current plan. Check billing/quota at ai.google.dev/gemini-api/docs/rate-limits."
        : err instanceof Error
          ? err.message
          : "Image generation failed";
    res.status(500).json({ error: message });
  }
});
