import { authFetch } from "./auth";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type Source =
  | { type: "document"; documentId: string; text: string }
  | { type: "web"; title: string; url: string; domain?: string };

// A chat failure the UI needs to react to differently than "show an error
// bubble" — today that's exactly one case (a guest hitting the free-prompt
// limit, see server/src/routes/chat.ts), surfaced via `code` rather than
// string-matching the message text.
export class ChatError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "ChatError";
    this.code = code;
  }
}

// Every event on the wire is one JSON object with a `type` discriminator —
// see server/src/routes/chat.ts and chatRunner.ts for the emitting side.
// runId is the durable AgentRun id: it's what a reconnect (see
// useAgentRunRecovery.ts and ChatWindow's own resume-on-load logic) uses to
// recover a run's state via GET /api/agent/runs/:id after this stream dies,
// completely independent of whether this exact connection survives.
export interface ChatStreamHandlers {
  onRunStarted?: (info: { runId: string; conversationId: string; requestId: string }) => void;
  onStatus?: (status: "thinking" | "streaming") => void;
  onDelta: (text: string) => void;
  onDone: (sources: Source[]) => void;
  // Fired when this specific run was cancelled (see cancelChatRun below) —
  // distinct from onDone/an error: whatever text streamed before
  // cancellation is already shown, this just tells the caller to stop
  // waiting for more and clear the "sending" state without treating it as
  // a failure.
  onCancelled?: () => void;
  // Guest-only, non-blocking — fires alongside a message that's already
  // generating normally. `nudge` is true every Nth guest message (see
  // server/src/routes/chat.ts's GUEST_NUDGE_INTERVAL) and is what the
  // caller uses to (re)show the dismissible sign-up modal without touching
  // the in-flight request.
  onGuestProgress?: (info: { count: number; nudge: boolean }) => void;
}

// History lives server-side keyed by conversationId — the client no longer
// resends the whole transcript on every message, just which conversation
// this belongs to (undefined/null starts a new one).
export async function sendChatMessage(
  message: string,
  conversationId: string | null,
  handlers: ChatStreamHandlers
): Promise<void> {
  const res = await authFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversationId: conversationId ?? undefined }),
  });

  if (!res.ok) {
    let detail = "";
    let code: string | undefined;
    try {
      const body = await res.json();
      detail = body?.error ?? "";
      code = body?.code;
    } catch {
      // response wasn't JSON — ignore, fall back to the generic message below
    }
    throw new ChatError(detail || `Chat request failed (${res.status})`, code);
  }
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    let done: boolean, value: Uint8Array | undefined;
    try {
      ({ done, value } = await reader.read());
    } catch {
      // Connection dropped mid-stream (network blip, tab backgrounded and
      // killed, server restart) — the browser throws a raw, unhelpful
      // TypeError here just like it does for a request that never went out
      // at all. The run itself keeps generating server-side regardless (see
      // chatRunner.ts) — the caller (ChatWindow) is expected to try
      // recovering via the captured runId before treating this as a real
      // failure.
      throw new Error("Lost connection to the server while replying. Please try again.");
    }
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = JSON.parse(line.slice(6));
      switch (payload.type) {
        case "run.started":
          handlers.onRunStarted?.({
            runId: payload.runId,
            conversationId: payload.conversationId,
            requestId: payload.requestId,
          });
          break;
        case "agent.status":
          handlers.onStatus?.(payload.status);
          break;
        case "message.delta":
          if (payload.delta) handlers.onDelta(payload.delta);
          break;
        case "heartbeat":
          break; // keepalive only — no UI action needed
        case "guest.progress":
          handlers.onGuestProgress?.({ count: payload.count, nudge: payload.nudge });
          break;
        case "done":
          handlers.onDone(payload.sources ?? []);
          break;
        case "cancelled":
          handlers.onCancelled?.();
          break;
        case "error":
          throw new ChatError(payload.error, payload.code);
        default:
        // Unknown event type — ignore rather than fail the whole stream, in
        // case a future server version adds one this client doesn't know
        // about yet.
      }
    }
  }
}

export type AgentRunStatus = "queued" | "running" | "streaming" | "completed" | "failed" | "cancelled";

export interface AgentRun {
  id: string;
  conversationId: string;
  userMessage: string;
  responseText: string;
  provider: string | null;
  status: AgentRunStatus;
  error: string | null;
  sources: Source[] | null;
  startedAt: string;
  completedAt: string | null;
  seenAt: string | null;
}

// Recovery surface for "Chrome closed ≠ Jenny stopped": every run still in
// flight, or finished since the last time the client marked it seen. Used
// both on app load (restore what happened while the app was closed) and on
// visibilitychange/online (restore what happened while backgrounded).
export async function fetchActiveRuns(): Promise<AgentRun[]> {
  const res = await authFetch("/api/agent/runs/active");
  if (!res.ok) return [];
  const data = await res.json();
  return data.runs;
}

export async function fetchRun(runId: string): Promise<AgentRun | null> {
  const res = await authFetch(`/api/agent/runs/${runId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.run;
}

export async function markRunSeen(runId: string): Promise<void> {
  await authFetch(`/api/agent/runs/${runId}/seen`, { method: "POST" }).catch(() => {});
}

// Run-scoped — cancels exactly this runId server-side (see
// agentRuns.ts's /cancel route) and has no effect on any other run,
// including other runs in the same conversation.
export async function cancelChatRun(runId: string): Promise<boolean> {
  const res = await authFetch(`/api/agent/runs/${runId}/cancel`, { method: "POST" }).catch(() => null);
  if (!res || !res.ok) return false;
  const data = await res.json().catch(() => null);
  return data?.cancelled ?? false;
}

export interface ConversationSummary {
  id: string;
  title: string;
  titleSource: "auto" | "manual";
  updatedAt: string;
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await authFetch("/api/conversations");
  const data = await res.json();
  return data.conversations;
}

export async function fetchConversationMessages(id: string): Promise<(ChatTurn & { sources?: Source[] })[]> {
  const res = await authFetch(`/api/conversations/${id}`);
  if (!res.ok) throw new Error(`Failed to load conversation (${res.status})`);
  const data = await res.json();
  return data.messages;
}

export async function deleteConversation(id: string): Promise<void> {
  await authFetch(`/api/conversations/${id}`, { method: "DELETE" });
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const res = await authFetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Failed to rename conversation (${res.status})`);
  }
}

export interface DocumentInfo {
  id: string;
  filename: string;
  uploadedAt: string;
  chunkCount: number;
}

export async function fetchDocuments(): Promise<DocumentInfo[]> {
  const res = await authFetch("/api/documents");
  const data = await res.json();
  return data.documents;
}

export async function uploadDocument(file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch("/api/documents", { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed");
}

export async function deleteDocument(id: string): Promise<void> {
  await authFetch(`/api/documents/${id}`, { method: "DELETE" });
}

export interface GeneratedImage {
  mimeType: string;
  data: string; // base64
}

export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const res = await authFetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Image generation failed (${res.status})`);
  return data;
}

export interface GeneratedSpeech {
  mimeType: string;
  data: string; // base64
}

export async function generateSpeech(text: string, voice: string): Promise<GeneratedSpeech> {
  const res = await authFetch("/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Speech generation failed (${res.status})`);
  return data;
}
