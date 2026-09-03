import { authFetch } from "./auth";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface Source {
  documentId: string;
  text: string;
}

// History lives server-side keyed by conversationId — the client no longer
// resends the whole transcript on every message, just which conversation
// this belongs to (undefined/null starts a new one, id returned via
// onConversationId).
export async function sendChatMessage(
  message: string,
  conversationId: string | null,
  onConversationId: (id: string) => void,
  onDelta: (text: string) => void,
  onDone: (sources: Source[]) => void
): Promise<void> {
  const res = await authFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversationId: conversationId ?? undefined }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error ?? "";
    } catch {
      // response wasn't JSON — ignore, fall back to the generic message below
    }
    throw new Error(detail || `Chat request failed (${res.status})`);
  }
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = JSON.parse(line.slice(6));
      if (payload.error) throw new Error(payload.error);
      if (payload.conversationId) onConversationId(payload.conversationId);
      if (payload.delta) onDelta(payload.delta);
      if (payload.done) onDone(payload.sources ?? []);
    }
  }
}

export interface ConversationSummary {
  id: string;
  title: string;
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
