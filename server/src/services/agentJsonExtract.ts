// Small, shared utility: real LLMs — especially smaller local ones — don't reliably emit bare JSON
// even when explicitly told to. Used by Phase 9's Orchestrator (parsing a task-decomposition list)
// and Coder (parsing a {filePath, content} write instruction) role executors. A genuine parse
// failure is a real, honest error surfaced to the caller — never silently swallowed into an empty
// result, since a task that silently "succeeds" with no actual output would be exactly the kind of
// fake autonomy this engagement has guarded against throughout.
export class JsonExtractError extends Error {
  constructor(rawText: string) {
    super(`Could not parse JSON from model output: ${rawText.slice(0, 300)}`);
    this.name = "JsonExtractError";
  }
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Real models sometimes add a sentence before/after the JSON despite explicit instructions not
    // to — fall back to the first balanced-looking {...} or [...] block found anywhere in the text.
    const match = candidate.match(/[[{][\s\S]*[\]}]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through to the real error below
      }
    }
    throw new JsonExtractError(text);
  }
}
