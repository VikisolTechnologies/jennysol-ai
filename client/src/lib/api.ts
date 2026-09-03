export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface Source {
  documentId: string;
  text: string;
}

// Same-origin ("") when the server serves the built client itself, or when
// the Vite dev proxy handles /api. Set VITE_API_BASE_URL when the frontend
// and backend are deployed separately (e.g. client on Vercel, API on Railway).
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export async function sendChatMessage(
  message: string,
  history: ChatTurn[],
  onDelta: (text: string) => void,
  onDone: (sources: Source[]) => void
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
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
      if (payload.delta) onDelta(payload.delta);
      if (payload.done) onDone(payload.sources ?? []);
    }
  }
}

export interface DocumentInfo {
  id: string;
  filename: string;
  uploadedAt: string;
  chunkCount: number;
}

export async function fetchDocuments(): Promise<DocumentInfo[]> {
  const res = await fetch(`${API_BASE}/api/documents`);
  const data = await res.json();
  return data.documents;
}

export async function uploadDocument(file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/documents`, { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed");
}

export async function deleteDocument(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/documents/${id}`, { method: "DELETE" });
}

export interface GeneratedImage {
  mimeType: string;
  data: string; // base64
}

export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const res = await fetch(`${API_BASE}/api/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Image generation failed (${res.status})`);
  return data;
}
