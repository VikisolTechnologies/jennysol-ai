import { GoogleGenAI, Modality } from "@google/genai";

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export interface GeneratedImage {
  mimeType: string;
  data: string; // base64
}

export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { responseModalities: [Modality.IMAGE] },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new Error("The model didn't return an image for that prompt. Try rephrasing it.");
  }

  return {
    mimeType: imagePart.inlineData.mimeType || "image/png",
    data: imagePart.inlineData.data,
  };
}
