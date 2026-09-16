import { streamChatCompletion } from "../llm.js";
import { extractJson, JsonExtractError } from "../agentJsonExtract.js";
import { ACTION_REGISTRY, findActionTarget } from "./actionRegistry.js";

export interface ParsedIntent {
  targetId: string;
  slots: Record<string, string>;
  missingRequiredSlots: string[];
}

function registryDescription(): string {
  return ACTION_REGISTRY.map(
    (t) =>
      `- id: "${t.id}" (${t.label}) — slots: ${t.slots
        .map((s) => `${s.name}${s.required ? "" : " (optional)"}: ${s.description}`)
        .join("; ")}`
  ).join("\n");
}

// JENNYSOL-MOBILE-AND-ACTIONS.md Part A.2: "Parse an utterance into an
// intent and slots... ask one question at a time for what is missing." Real
// LLM call against this deployment's own configured provider chain (the
// same one chat itself uses) — not a fabricated regex parser pretending to
// be language understanding. Returns null (never throws) when the message
// genuinely isn't an action request, or when the model's own JSON output
// can't be parsed — either way, the real, safe behavior for the caller
// (chatRunner.ts) is to fall through to normal chat, not to block on this.
export async function parseActionIntent(
  message: string,
  priorTargetId?: string,
  priorSlots?: Record<string, string>
): Promise<ParsedIntent | null> {
  const priorContext = priorTargetId
    ? `\n\nThe user was already mid-way through a "${priorTargetId}" request with these slots already known: ${JSON.stringify(
        priorSlots ?? {}
      )}. This new message is very likely answering the question you (Jenny) just asked to fill in a missing slot — merge it in rather than starting over, unless it's clearly an unrelated new request.`
    : "";

  const systemPrompt = `You extract a structured action intent from one user message, for a real deep-link handoff system. Available action targets:
${registryDescription()}
${priorContext}

Respond with ONLY a JSON object, no other text, no markdown fences:
{"targetId": "<one of the ids above, or null if this message doesn't match any of them>", "slots": {"<slot name>": "<value extracted from the message>"}}

Only include a slot in "slots" if the message (or the prior context above) actually states it — never invent a value. If nothing matches, respond {"targetId": null, "slots": {}}.`;

  let fullText = "";
  try {
    await streamChatCompletion(
      systemPrompt,
      [{ role: "user", content: message }],
      (delta) => {
        fullText += delta;
      },
      undefined,
      "general"
    );
  } catch {
    // Real provider failure — same safe fallback as a genuine non-match:
    // normal chat still needs to work even when this classification step
    // can't run.
    return null;
  }

  let parsed: unknown;
  try {
    parsed = extractJson(fullText);
  } catch (err) {
    if (err instanceof JsonExtractError) return null;
    throw err;
  }

  const obj = parsed as { targetId?: string | null; slots?: Record<string, string> };
  if (!obj.targetId) return null;
  const target = findActionTarget(obj.targetId);
  if (!target) return null;

  const slots = obj.slots && typeof obj.slots === "object" ? obj.slots : {};
  // A slot only really counts as "known" if it's non-empty AND (where the
  // target defines one) passes its own real validator — see actionRegistry
  // .ts's own comment on why: an LLM's instruction-following alone isn't
  // enough of a guarantee for something that produces a real-world link.
  const missingRequiredSlots = target.slots
    .filter((s) => {
      if (!s.required) return false;
      const value = slots[s.name]?.trim();
      if (!value) return true;
      return s.validate ? !s.validate(value) : false;
    })
    .map((s) => s.name);
  // A slot that failed its own validator shouldn't be carried forward as if
  // it were real ("mom" surviving into the clarify state, then silently
  // reused if the next message happens to look complete) — drop it so the
  // next turn asks fresh rather than trusting a value already known to be
  // invalid.
  for (const name of missingRequiredSlots) delete slots[name];

  return { targetId: target.id, slots, missingRequiredSlots };
}
