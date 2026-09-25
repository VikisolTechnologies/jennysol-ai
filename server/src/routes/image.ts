import { Router } from "express";
import { z } from "zod";
import { routeImageGeneration, hasAnyConfiguredImageProvider, AllImageProvidersUnavailableError } from "../services/imageRouter.js";
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

  if (!hasAnyConfiguredImageProvider()) {
    res.status(500).json({
      error: "I can't generate images right now — image generation isn't set up on this server yet.",
    });
    return;
  }

  try {
    const result = await routeImageGeneration(parsed.data.prompt);
    res.json(result.image);
  } catch (err) {
    console.error("Image generation failed:", err);
    // Shown verbatim as Jenny's reply in the chat bubble — never leak raw
    // provider/billing/quota language here, talk the way she'd actually say
    // it. Only reached once EVERY provider in the chain (Gemini, then
    // Qwen-Image, then Janus-Pro, both via fal.ai) has failed — see
    // imageRouter.ts's routeImageGeneration.
    if (err instanceof AllImageProvidersUnavailableError) {
      // "limit: 0" / "FreeTier" in Gemini's own 429 body means that key's
      // *tier* has zero quota for image generation specifically (confirmed
      // directly in production logs) — a permanent condition until billing
      // is enabled, not something that clears on its own. Worth calling out
      // by name even though Qwen/Janus also failed, since it's the one
      // failure in the set with a real, actionable fix.
      const isZeroQuotaTier = err.attempts.some((a) => /limit:\s*0\b/i.test(a.reason));
      const message = isZeroQuotaTier
        ? "I can't generate images right now — this account's current plan doesn't include any image-generation quota, so it's not something that'll clear up on its own. Someone would need to enable billing/upgrade the plan for that model. In the meantime I can help you write a sharp prompt for another image tool, or just describe what you're picturing and I'll work with that."
        : "I can't generate an image right now — I tried every image model I have and none of them came through. It'll likely clear up soon. In the meantime I can help you write a sharp prompt for another image tool, or just describe what you're picturing and I'll work with that.";
      res.status(500).json({ error: message });
      return;
    }
    res.status(500).json({
      error: "Something went wrong generating that image. Want to try rephrasing it, or describe what you're picturing and I'll help another way?",
    });
  }
});
