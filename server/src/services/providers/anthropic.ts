// Claude (Anthropic) provider, with difficulty tiers. Same LlmProvider contract as gemini.ts:
// plain streamed chat, and - when `tools` + `onToolCall` are passed - a bounded tool-calling loop.
//
// Tiers (StreamOptions.tier, chosen by modelTiers.ts's classifyDifficulty for each request):
//   fast     -> Haiku 4.5  : everyday requests - a lookup, a short answer, one clear action
//   balanced -> Sonnet 5   : moderate requests - compare/summarise results, draft a post
//   deep     -> Opus 5.5   : multi-step planning - several actions, trade-offs, a whole plan
// Each overridable per deployment (ANTHROPIC_MODEL_FAST/_BALANCED/_DEEP) without a code change.
import Anthropic from "@anthropic-ai/sdk";
import type { ChatTurn, LlmProvider, TokenUsage, ToolCallHandler, ToolDefinition } from "../llmProvider.js";
import type { DifficultyTier } from "../models/modelTiers.js";

const DEFAULT_MODELS: Record<DifficultyTier, string> = {
  fast: "claude-haiku-4-5-20251001",
  balanced: "claude-sonnet-5",
  deep: "claude-opus-5-5",
};

export function modelForTier(tier: DifficultyTier | undefined): string {
  const t: DifficultyTier = tier ?? "fast";
  const override =
    t === "fast" ? process.env.ANTHROPIC_MODEL_FAST : t === "balanced" ? process.env.ANTHROPIC_MODEL_BALANCED : process.env.ANTHROPIC_MODEL_DEEP;
  return override || DEFAULT_MODELS[t];
}

// Output budget per tier - a plan needs room; a quick answer doesn't.
const MAX_TOKENS: Record<DifficultyTier, number> = { fast: 1024, balanced: 2048, deep: 4096 };

// Same bound as gemini.ts's MAX_TOOL_ROUNDS, a little higher: a real plan (search, then look at
// nearby activities, then propose two actions) legitimately takes a few rounds.
const MAX_TOOL_ROUNDS = 6;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// The Messages API only accepts tool names matching ^[a-zA-Z0-9_-]{1,64}$, but connector tools
// are namespaced with a dot ("arena.searchJobs", enforced by ToolRegistry). "__" never appears in
// a real tool name, so the mapping is reversible.
export function toApiToolName(name: string): string {
  return name.replace(/\./g, "__");
}
export function fromApiToolName(name: string): string {
  return name.replace(/__/g, ".");
}

type MessageParam = Anthropic.Messages.MessageParam;
type ContentBlockParam = Anthropic.Messages.ContentBlockParam;

function toMessages(history: ChatTurn[]): MessageParam[] {
  // The API requires the conversation to start with a user turn and alternate; merge any
  // consecutive same-role turns rather than dropping them.
  const out: MessageParam[] = [];
  for (const turn of history) {
    const role = turn.role === "assistant" ? "assistant" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${turn.content}`;
    } else {
      out.push({ role, content: turn.content });
    }
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

function toApiTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
  return tools.map((t, i) => ({
    name: toApiToolName(t.name),
    description: t.description,
    input_schema: t.parameters as Anthropic.Messages.Tool.InputSchema,
    // Cache the whole tool list (the breakpoint on the last tool covers every tool before it) -
    // it's identical across a user's turns, so repeat requests only pay for it once.
    ...(i === tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

async function run(
  systemPrompt: string,
  history: ChatTurn[],
  onDelta: (text: string) => void,
  tier: DifficultyTier | undefined,
  tools: ToolDefinition[] | undefined,
  onToolCall: ToolCallHandler | undefined,
  signal: AbortSignal | undefined,
  onUsage: ((usage: TokenUsage) => void) | undefined,
  onActivity: (() => void) | undefined
): Promise<void> {
  const model = modelForTier(tier);
  const messages = toMessages(history);
  const apiTools = tools?.length && onToolCall ? toApiTools(tools) : undefined;
  let promptTokens: number | null = null;
  let completionTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = getClient().messages.stream(
      {
        model,
        max_tokens: MAX_TOKENS[tier ?? "fast"],
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages,
        ...(apiTools ? { tools: apiTools } : {}),
      },
      signal ? { signal } : undefined
    );
    stream.on("streamEvent", () => onActivity?.());
    stream.on("text", (text) => onDelta(text));
    const message = await stream.finalMessage();

    promptTokens = (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    completionTokens += message.usage.output_tokens ?? 0;

    const toolUses = message.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    if (message.stop_reason !== "tool_use" || toolUses.length === 0 || !onToolCall) {
      onUsage?.({ promptTokens, completionTokens, estimated: false });
      return;
    }

    messages.push({ role: "assistant", content: message.content as ContentBlockParam[] });
    const results: ContentBlockParam[] = [];
    for (const use of toolUses) {
      let output: unknown;
      let isError = false;
      try {
        output = await onToolCall({ id: use.id, name: fromApiToolName(use.name), args: (use.input ?? {}) as Record<string, unknown> });
      } catch (err) {
        // Reported to the model as data (same as gemini.ts), so it can explain the failure
        // honestly instead of the whole turn erroring out over one bad tool call.
        output = { error: err instanceof Error ? err.message : String(err) };
        isError = true;
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output ?? null), ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }

  onUsage?.({ promptTokens, completionTokens, estimated: false });
  onDelta("I tried a few steps but couldn't finish that - could you say it another way?");
}

export const anthropicProvider: LlmProvider = {
  async streamChatCompletion(systemPrompt, history, onDelta, _onWebSources, opts) {
    return run(systemPrompt, history, onDelta, opts?.tier, opts?.tools, opts?.onToolCall, opts?.signal, opts?.onUsage, opts?.onActivity);
  },
};
