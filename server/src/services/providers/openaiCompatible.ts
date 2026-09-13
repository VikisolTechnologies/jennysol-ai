import type { ChatTurn, StreamOptions, TokenUsage, ToolCall, ToolCallHandler, ToolDefinition } from "../llmProvider.js";

// Rough, clearly-labeled fallback for the rare case a request errors out (or
// is aborted) before any usage chunk arrives — Ollama and DeepSeek both
// report real usage via stream_options.include_usage on a normal completion
// (confirmed live against Ollama 0.33.3), so this estimate is a safety net,
// not the common case. ~4 chars/token is the standard ballpark for English
// text — good enough for a rolling dashboard, not for billing.
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

// Shared streaming client for any OpenAI-compatible chat completions endpoint
// (DeepSeek, Ollama, and most other providers all speak this same shape).
export async function streamOpenAiCompatible(
  url: string,
  headers: Record<string, string>,
  model: string,
  systemPrompt: string,
  history: ChatTurn[],
  onDelta: (text: string) => void,
  opts?: StreamOptions
): Promise<void> {
  if (opts?.tools?.length && opts.onToolCall) {
    return attemptWithTools(url, headers, model, systemPrompt, history, onDelta, opts.tools, opts.onToolCall, opts.signal, opts.onUsage, opts.onActivity);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    signal: opts?.signal,
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((h) => ({ role: h.role, content: h.content })),
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Request to ${url} failed (${res.status}): ${detail}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";
  let realUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const payload = line.replace(/^data: /, "").trim();
      if (!payload || payload === "[DONE]") continue;
      opts?.onActivity?.();
      const parsed = JSON.parse(payload);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (delta) {
        assistantText += delta;
        onDelta(delta);
      }
      if (parsed?.usage) realUsage = parsed.usage;
    }
  }

  if (opts?.onUsage) {
    opts.onUsage(
      realUsage
        ? {
            promptTokens: realUsage.prompt_tokens ?? null,
            completionTokens: realUsage.completion_tokens ?? null,
            estimated: false,
          }
        : {
            promptTokens: estimateTokens(systemPrompt + history.map((h) => h.content).join("\n")),
            completionTokens: estimateTokens(assistantText),
            estimated: true,
          }
    );
  }
}

function toOpenAiTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

interface AccumulatingToolCall {
  id: string;
  name: string;
  argsJson: string;
}

const MAX_TOOL_ROUNDS = 4;

// Mirrors gemini.ts's attemptWithTools: a bounded round-trip loop rather than
// a single request, since the model may need a tool result before it can
// produce a real final answer. Kept as an entirely separate function (not a
// branch threaded through the plain streaming loop above) for the same
// reason gemini.ts isolates its own version — this is new, less-exercised
// code, and it must never be able to regress the plain chat path every
// existing Ollama/DeepSeek request already depends on.
async function attemptWithTools(
  url: string,
  headers: Record<string, string>,
  model: string,
  systemPrompt: string,
  history: ChatTurn[],
  onDelta: (text: string) => void,
  tools: ToolDefinition[],
  onToolCall: ToolCallHandler,
  signal?: AbortSignal,
  onUsage?: (usage: TokenUsage) => void,
  onActivity?: () => void
): Promise<void> {
  // OpenAI-shaped message history this loop grows round to round — starts
  // from the same plain (role, content) turns as the non-tool path, then
  // gains assistant tool_calls + tool-result messages as rounds happen.
  const messages: Record<string, unknown>[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ];
  const openAiTools = toOpenAiTools(tools);
  let totalCompletionTokens = 0;
  let lastPromptTokens: number | undefined;
  let anyRealUsage = false;
  let allAssistantText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      signal,
      body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, messages, tools: openAiTools }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`Request to ${url} failed (${res.status}): ${detail}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // Streamed tool-call argument fragments arrive keyed by their position
    // in the assistant's tool_calls array, not always with the name/id
    // repeated on every fragment — accumulate per-index and only read the
    // finished result once the stream ends.
    const callsByIndex = new Map<number, AccumulatingToolCall>();
    let assistantText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const payload = line.replace(/^data: /, "").trim();
        if (!payload || payload === "[DONE]") continue;
        onActivity?.();
        const parsed = JSON.parse(payload);
        if (parsed?.usage) {
          anyRealUsage = true;
          lastPromptTokens = parsed.usage.prompt_tokens ?? lastPromptTokens;
          totalCompletionTokens += parsed.usage.completion_tokens ?? 0;
        }
        const delta = parsed?.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          assistantText += delta.content;
          allAssistantText += delta.content;
          onDelta(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const existing = callsByIndex.get(idx);
          if (existing) {
            if (tc.function?.arguments) existing.argsJson += tc.function.arguments;
          } else {
            callsByIndex.set(idx, {
              id: tc.id ?? `call-${round}-${idx}`,
              name: tc.function?.name ?? "unknown_tool",
              argsJson: tc.function?.arguments ?? "",
            });
          }
        }
      }
    }

    if (callsByIndex.size === 0) {
      reportUsage();
      return; // model answered in plain text — this round is the final one
    }

    const calls = [...callsByIndex.values()];
    messages.push({
      role: "assistant",
      content: assistantText || null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.argsJson },
      })),
    });

    for (const c of calls) {
      let args: Record<string, unknown>;
      try {
        args = c.argsJson ? JSON.parse(c.argsJson) : {};
      } catch {
        args = {};
      }
      const call: ToolCall = { id: c.id, name: c.name, args };
      let output: unknown;
      try {
        output = await onToolCall(call);
      } catch (err) {
        // Same contract as gemini.ts: a tool failure is data fed back to the
        // model, not a thrown error that aborts the whole turn.
        output = { error: err instanceof Error ? err.message : String(err) };
      }
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(output ?? null) });
    }
  }

  // Bounded loop exhausted without a plain-text final answer — never leave
  // the turn silently empty (same fallback gemini.ts uses).
  onDelta("I tried a few tool calls but couldn't reach a final answer — mind rephrasing your question?");
  reportUsage();

  function reportUsage(): void {
    if (!onUsage) return;
    onUsage(
      anyRealUsage
        ? { promptTokens: lastPromptTokens ?? null, completionTokens: totalCompletionTokens, estimated: false }
        : {
            promptTokens: estimateTokens(systemPrompt + history.map((h) => h.content).join("\n")),
            completionTokens: estimateTokens(allAssistantText),
            estimated: true,
          }
    );
  }
}
