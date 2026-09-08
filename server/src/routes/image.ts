import { Router } from "express";
import { z } from "zod";
import { generateImage } from "../services/providers/geminiImage.js";
import { zodErrorMessage } from "../utils/zodError.js";

export const imageRouter = Router();

const imageRequestSchema = z.object({
  prompt: z.string().min(1),
});

imageRouter.post("/", async (req, res) => {
  const parsed = imageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
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
    const detail = err instanceof Error ? err.message : String(err);
    // Shown verbatim as Jenny's reply in the chat bubble — never leak raw
    // provider/billing/quota language here, talk the way she'd actually say
    // it. "limit: 0" / "FreeTier" in a 429's own body means this API key's
    // *tier* has zero quota for image generation specifically (confirmed
    // directly in production logs) — a permanent condition until billing
    // is enabled, not a transient rate limit that clears on its own. Saying
    // "try again later" for that case would be a quieter but equally
    // dishonest version of "here's your image" — it promises a recovery
    // that isn't coming without an account change.
    const isZeroQuotaTier = status === 429 && /limit:\s*0\b/i.test(detail);
    const message = isZeroQuotaTier
      ? "I can't generate images right now — this account's current plan doesn't include any image-generation quota, so it's not something that'll clear up on its own. Someone would need to enable billing/upgrade the plan for that model. In the meantime I can help you write a sharp prompt for another image tool, or just describe what you're picturing and I'll work with that."
      : status === 429
        ? "I can't generate an image right now — I've hit today's limit on that. It'll free up again soon. In the meantime I can help you write a sharp prompt for another image tool, or just describe what you're picturing and I'll work with that."
        : "Something went wrong generating that image. Want to try rephrasing it, or describe what you're picturing and I'll help another way?";
    res.status(500).json({ error: message });
  }
});
