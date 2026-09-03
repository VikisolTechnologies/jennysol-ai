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

export type VoiceConversationState = "off" | "sleeping" | "listening" | "paused";

// A real back-and-forth voice conversation, not "repeat the wake word every
// turn": say "hey jenny" (or any of its variants) once to start, then just
// keep talking — every reply you give afterward is sent straight through
// until you pause or end it. PAUSE is a first-class control here (not an
// afterthought) precisely because "listening" now means "anything you say
// gets sent," so you need a fast, obvious way to step out of that when you
// want to talk to someone else in the room.
//
// States: off (nothing running) -> sleeping (armed, only matching the wake
// phrase) -> listening (every utterance is a command) <-> paused (mic off,
// but resume goes back to listening, not back to needing the wake phrase
// again — you're still "in" the conversation, just stepped away).
export function useVoiceConversation(onCommand: (transcript: string) => void) {
  const [state, setState] = useState<VoiceConversationState>("off");
  const stateRef = useRef<VoiceConversationState>("off");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mutedForPlaybackRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  function setStateBoth(s: VoiceConversationState) {
    stateRef.current = s;
    setState(s);
  }

  function launchRecognition() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (e) => {
      if (mutedForPlaybackRef.current) return;

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (!transcript) continue;

        if (stateRef.current === "sleeping") {
          const { woke, rest } = matchWakePhrase(transcript);
          if (!woke) continue;
          if (rest && result.isFinal) {
            setStateBoth("listening");
            onCommandRef.current(rest);
          } else {
            setStateBoth("listening");
          }
        } else if (stateRef.current === "listening" && result.isFinal && transcript.trim()) {
          onCommandRef.current(transcript.trim());
        }
      }
    };

    recognition.onerror = () => {
      // Common on silence/network blips; onend fires right after and
      // restarts things, so there's nothing to do here but not crash.
    };
    recognition.onend = () => {
      const active = stateRef.current === "sleeping" || stateRef.current === "listening";
      if (active) {
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

  function start() {
    if (stateRef.current !== "off") return;
    setStateBoth("sleeping");
    launchRecognition();
  }

  function pause() {
    if (stateRef.current === "off") return;
    setStateBoth("paused");
    recognitionRef.current?.stop();
  }

  function resume() {
    if (stateRef.current !== "paused") return;
    setStateBoth("listening");
    launchRecognition();
  }

  function stop() {
    setStateBoth("off");
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }

  // Called around TTS playback so the mic doesn't hear the assistant's own
  // voice and treat it as the next thing to respond to.
  function suspendForPlayback() {
    mutedForPlaybackRef.current = true;
  }
  function resumeAfterPlayback() {
    mutedForPlaybackRef.current = false;
  }

  useEffect(() => {
    return () => {
      stateRef.current = "off";
      recognitionRef.current?.stop();
    };
  }, []);

  return {
    state,
    start,
    pause,
    resume,
    stop,
    suspendForPlayback,
    resumeAfterPlayback,
    supported: speechRecognitionSupported,
  };
}
