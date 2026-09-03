import { useEffect, useRef, useState } from "react";
import {
  getSpeechRecognitionCtor,
  speechRecognitionSupported,
  type SpeechRecognitionLike,
} from "./speechRecognitionTypes";

const WAKE_PHRASES = ["hey jenny", "hi jenny", "hello jenny", "wake up jenny", "ok jenny", "okay jenny"];

function matchWakePhrase(text: string): { woke: boolean; rest: string } {
  const lower = text.toLowerCase();
  for (const phrase of WAKE_PHRASES) {
    const idx = lower.indexOf(phrase);
    if (idx !== -1) {
      return { woke: true, rest: text.slice(idx + phrase.length).trim() };
    }
  }
  return { woke: false, rest: "" };
}

export type WakeWordStatus = "sleeping" | "awake";

// Always-on "Hey Jenny" listening. Two-phase: SLEEPING (passively listening
// only for a wake phrase) -> hearing one flips to AWAKE (next thing you say is
// the actual command, sent via onCommand) -> back to SLEEPING. If the wake
// phrase and the command arrive in the same breath ("hey jenny what's up"),
// it skips straight to firing onCommand.
//
// continuous:true speech recognition drops out on its own (silence timeouts,
// network hiccups) — the onend handler restarts it whenever the feature is
// still toggled on, which is what makes this "always" listening rather than
// "until the browser feels like stopping."
export function useWakeWord(onCommand: (transcript: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<WakeWordStatus>("sleeping");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const enabledRef = useRef(false);
  const statusRef = useRef<WakeWordStatus>("sleeping");
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  function setStatusBoth(s: WakeWordStatus) {
    statusRef.current = s;
    setStatus(s);
  }

  function launchRecognition() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (!transcript) continue;

        if (statusRef.current === "sleeping") {
          const { woke, rest } = matchWakePhrase(transcript);
          if (!woke) continue;
          if (rest && result.isFinal) {
            onCommandRef.current(rest);
          } else {
            setStatusBoth("awake");
          }
        } else if (result.isFinal && transcript.trim()) {
          onCommandRef.current(transcript.trim());
          setStatusBoth("sleeping");
        }
      }
    };

    recognition.onerror = () => {
      // Common on silence/network blips; onend fires right after and
      // restarts things, so there's nothing to do here but not crash.
    };
    recognition.onend = () => {
      if (enabledRef.current) {
        try {
          recognition.start();
        } catch {
          // Already starting/started — ignore, this fires occasionally
          // when start() races the browser's own restart.
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function toggle() {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      setStatusBoth("sleeping");
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    } else {
      enabledRef.current = true;
      setEnabled(true);
      launchRecognition();
    }
  }

  useEffect(() => {
    return () => {
      enabledRef.current = false;
      recognitionRef.current?.stop();
    };
  }, []);

  return { enabled, status, toggle, supported: speechRecognitionSupported };
}
