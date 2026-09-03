export const speechSynthesisSupported = typeof window !== "undefined" && "speechSynthesis" in window;

// Strips markdown syntax so it doesn't get read aloud literally (e.g. "asterisk asterisk bold asterisk asterisk").
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_#>`]/g, "")
    .replace(/\[(\d+)\]/g, "")
    .trim();
}

export function speak(text: string) {
  if (!speechSynthesisSupported) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (speechSynthesisSupported) window.speechSynthesis.cancel();
}
