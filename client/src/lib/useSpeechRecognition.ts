import { useEffect, useRef, useState } from "react";
import {
  getSpeechRecognitionCtor,
  speechRecognitionSupported,
  type SpeechRecognitionLike,
} from "./speechRecognitionTypes";

export { speechRecognitionSupported };

// Push-to-talk: one click, one utterance, auto-stops. For always-on wake-word
// listening see useWakeWord.ts — that needs a different (continuous) mode.
export type SpeechRecognitionError = "mic-denied" | "mic-unavailable" | null;

export function useSpeechRecognition(onResult: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechRecognitionError>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  function start() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    setError(null);
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (e) => {
      const transcript = e.results[e.results.length - 1]?.[0]?.transcript;
      if (transcript) onResult(transcript);
    };
    recognition.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("mic-denied");
      } else if (e.error === "audio-capture") {
        setError("mic-unavailable");
      }
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return { listening, error, start, stop, supported: speechRecognitionSupported };
}
