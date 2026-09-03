// Chrome/Edge/Safari expose SpeechRecognition under a vendor prefix; Firefox
// has no implementation at all, so every caller must feature-detect via
// speechRecognitionSupported before using this.
export interface SpeechRecognitionResultLike {
  transcript: string;
}
export interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<ArrayLike<SpeechRecognitionResultLike> & { isFinal: boolean }>;
}
export interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}

export function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const speechRecognitionSupported = typeof window !== "undefined" && !!getSpeechRecognitionCtor();
