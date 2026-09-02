import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

/**
 * Runs entirely locally (ONNX model pulled once from HF hub and cached) so v1
 * doesn't need a second paid API key just to embed text for retrieval.
 */
let extractor: FeatureExtractionPipeline | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = (await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    )) as FeatureExtractionPipeline;
  }
  return extractor;
}

export async function embed(text: string): Promise<Float32Array> {
  const model = await getExtractor();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Float32Array.from(output.data as Float32Array);
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already normalized, so dot product == cosine similarity
}
