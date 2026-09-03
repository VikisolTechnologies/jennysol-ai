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
// stopSpeaking() needs to make an in-flight speak() promise resolve even
// when it's cut short — audio.pause() alone never fires 'ended', so without
// this a manual interrupt would leave the caller (the voice-conversation
// loop) permanently thinking playback is still in progress and never start
// listening again.
let resolveActivePlayback: (() => void) | null = null;

// Lets the voice orb hook an analyser up to whatever's actually playing, so
// "speaking" can be a real reaction to the audio rather than a canned loop.
export function getCurrentAudioElement(): HTMLAudioElement | null {
  return currentAudio;
}

function speakWithBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!speechSynthesisSupported) return resolve();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    resolveActivePlayback = resolve;
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
    resolveActivePlayback = resolve;
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

  try {
    if (voice === "browser") {
      await speakWithBrowser(clean);
    } else {
      try {
        await speakWithGemini(clean, voice);
      } catch {
        // Gemini TTS unavailable (quota, network, etc.) — fall back rather
        // than go silent, since for the voice loop a spoken answer is the
        // whole point.
        await speakWithBrowser(clean);
      }
    }
  } finally {
    currentAudio = null;
    resolveActivePlayback = null;
  }
}

export function stopSpeaking() {
  if (speechSynthesisSupported) window.speechSynthesis.cancel();
  currentAudio?.pause();
  resolveActivePlayback?.(); // unstick a caller awaiting speak() on a manual interrupt
}
