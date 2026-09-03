import { useEffect, useRef, useState } from "react";
import {
  getSpeechRecognitionCtor,
  speechRecognitionSupported,
  type SpeechRecognitionLike,
} from "./speechRecognitionTypes";

export { speechRecognitionSupported };

// Push-to-talk: one click, one utterance, auto-stops. For always-on wake-word
// listening see useWakeWord.ts — that needs a different (continuous) mode.
export function useSpeechRecognition(onResult: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  function start() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (e) => {
      const transcript = e.results[e.results.length - 1]?.[0]?.transcript;
      if (transcript) onResult(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return { listening, start, stop, supported: speechRecognitionSupported };
}
