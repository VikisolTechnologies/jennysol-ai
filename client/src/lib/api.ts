export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface Source {
  documentId: string;
  text: string;
}

export async function sendChatMessage(
  message: string,
  history: ChatTurn[],
  onDelta: (text: string) => void,
  onDone: (sources: Source[]) => void
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });

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
  const res = await fetch("/api/documents");
  const data = await res.json();
  return data.documents;
}

export async function uploadDocument(file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/documents", { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed");
}

export async function deleteDocument(id: string): Promise<void> {
  await fetch(`/api/documents/${id}`, { method: "DELETE" });
}
