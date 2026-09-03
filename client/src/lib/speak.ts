import { generateSpeech } from "./api";
import type { VoiceId } from "./voices";

export const speechSynthesisSupported = typeof window !== "undefined" && "speechSynthesis" in window;

// Strips markdown syntax so it doesn't get read aloud literally (e.g. "asterisk asterisk bold asterisk asterisk").
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_#>`]/g, "")
    .replace(/\[(\d+)\]/g, "")
    .trim();
}

let currentAudio: HTMLAudioElement | null = null;

function speakWithBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!speechSynthesisSupported) return resolve();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

async function speakWithGemini(text: string, voice: string): Promise<void> {
  const { mimeType, data } = await generateSpeech(text, voice);
  const audio = new Audio(`data:${mimeType};base64,${data}`);
  currentAudio = audio;
  await new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}

// Resolves once playback actually finishes — callers (like the voice
// conversation loop) use this to know when it's safe to start listening
// again instead of picking up the assistant's own voice as input.
export async function speak(text: string, voice: VoiceId = "browser"): Promise<void> {
  const clean = stripMarkdown(text);
  if (!clean) return;

  if (voice === "browser") {
    return speakWithBrowser(clean);
  }

  try {
    await speakWithGemini(clean, voice);
  } catch {
    // Gemini TTS unavailable (quota, network, etc.) — fall back rather than
    // go silent, since for the voice-conversation loop a spoken answer is
    // the whole point.
    await speakWithBrowser(clean);
  }
}

export function stopSpeaking() {
  if (speechSynthesisSupported) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}
