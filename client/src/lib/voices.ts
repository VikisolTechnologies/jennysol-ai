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
