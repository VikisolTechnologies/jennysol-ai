// All 30 current Gemini TTS prebuilt voices. Their actual tone/character isn't
// documented anywhere reliable enough to label honestly, so the picker lists
// them plainly by name with a "Preview" button — you judge by ear, not by a
// guessed description.
export const GEMINI_VOICES = [
  "Achernar",
  "Achird",
  "Aoede",
  "Algenib",
  "Algieba",
  "Alnilam",
  "Autonoe",
  "Callirrhoe",
  "Charon",
  "Despina",
  "Enceladus",
  "Erinome",
  "Fenrir",
  "Gacrux",
  "Iapetus",
  "Kore",
  "Laomedeia",
  "Leda",
  "Orus",
  "Puck",
  "Pulcherrima",
  "Rasalgethi",
  "Sadachbia",
  "Sadaltager",
  "Schedar",
  "Sulafat",
  "Umbriel",
  "Vindemiatrix",
  "Zephyr",
  "Zubenelgenubi",
] as const;

export type VoiceId = "browser" | (typeof GEMINI_VOICES)[number];

export const DEFAULT_VOICE: VoiceId = "Kore";

const STORAGE_KEY = "jennysol-voice";

export function getStoredVoice(): VoiceId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "browser" || (GEMINI_VOICES as readonly string[]).includes(stored ?? "")) {
      return stored as VoiceId;
    }
  } catch {
    // storage unavailable (private browsing etc.) — fall through to default
  }
  return DEFAULT_VOICE;
}

export function storeVoice(voice: VoiceId) {
  try {
    localStorage.setItem(STORAGE_KEY, voice);
  } catch {
    // ignore — non-critical
  }
}

// "Spoken replies" was chat-session-local state before JENNYSOL-UI-BUILD.md's
// Settings screen (§6.7) needed it to actually mean something outside of
// ChatWindow.tsx — persisted the same way the voice choice above already is,
// so Settings and chat both read/write the one real value instead of Settings
// showing a toggle that quietly diverges from what chat is actually doing.
const SPOKEN_REPLIES_KEY = "jennysol-spoken-replies";

export function getStoredSpokenReplies(): boolean {
  try {
    return localStorage.getItem(SPOKEN_REPLIES_KEY) === "1";
  } catch {
    return false;
  }
}

export function storeSpokenReplies(enabled: boolean) {
  try {
    localStorage.setItem(SPOKEN_REPLIES_KEY, enabled ? "1" : "0");
  } catch {
    // ignore — non-critical
  }
}
