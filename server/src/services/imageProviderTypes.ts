// Shared by every image-generation provider (geminiImage.ts, falImage.ts) so
// routes/image.ts and imageRouter.ts can treat them interchangeably — same
// reasoning as llmProvider.ts for chat.
export interface GeneratedImage {
  mimeType: string;
  data: string; // base64
}
