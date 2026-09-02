export interface Chunk {
  text: string;
  index: number;
}

/**
 * Splits text into overlapping word-based chunks. Overlap preserves context
 * across chunk boundaries so answers don't lose meaning at a cut point.
 */
export function chunkText(text: string, chunkSize = 220, overlap = 40): Chunk[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push({ text: words.slice(start, end).join(" "), index: index++ });
    if (end === words.length) break;
    start = end - overlap;
  }

  return chunks;
}
