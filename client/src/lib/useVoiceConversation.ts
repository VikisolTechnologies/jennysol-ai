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

// A real back-and-forth voice conversation, not "press start / say the wake
// phrase before every single turn": clicking Start is itself the activation
// — that already IS explicit consent, so it goes straight to LISTENING
// rather than making you also say "hey jenny" on top of it. The wake phrase
// stays available as an opt-in hands-free entry point (pass
// requireWakeWord: true to start()) for anyone who wants to arm listening
// without touching the UI at all; sleeping is that armed-but-not-yet-woken
// state. Once listening, every turn goes straight through and Jenny returns
// to listening automatically after each answer — no re-arming needed.
// PAUSE is the explicit way to step out of that (talk to someone else in the
// room without Jenny jumping in); resume goes back to listening directly,
// not back through the wake phrase.
export function useVoiceConversation(
  onCommand: (transcript: string) => void,
  onBargeIn?: () => void
) {
  const [state, setState] = useState<VoiceConversationState>("off");
  const stateRef = useRef<VoiceConversationState>("off");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // True while the assistant's TTS audio is actually playing — drives voice
  // barge-in (see onresult below), not a mute switch. Real interruption-by-
  // talking, not just click-to-interrupt, was explicitly asked for; it rides
  // on whatever echo cancellation the browser's getUserMedia pipeline
  // applies by default, since a web app has no way to verify or improve on
  // that itself. On hardware/browsers with weak AEC this can misfire (Jenny
  // hearing her own voice through open speakers) — clicking the orb to
  // interrupt stays the fully reliable fallback regardless.
  const speakingRef = useRef(false);
  const bargedInRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const onBargeInRef = useRef(onBargeIn);
  onBargeInRef.current = onBargeIn;

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
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (!transcript) continue;

        // Barge-in: the instant we hear anything while Jenny is talking,
        // cut her off — don't wait for the final transcript, a real
        // assistant stops the moment you start talking over it.
        if (speakingRef.current && !bargedInRef.current) {
          bargedInRef.current = true;
          onBargeInRef.current?.();
        }

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

  // requireWakeWord: true arms wake-word-only listening (sleeping) instead
  // of jumping straight into listening — an opt-in for hands-free arming,
  // not the default (see the module doc comment above for why).
  function start(requireWakeWord = false) {
    if (stateRef.current !== "off") return;
    setStateBoth(requireWakeWord ? "sleeping" : "listening");
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

  // Called around TTS playback so barge-in has something to compare against.
  function notifySpeakingStart() {
    bargedInRef.current = false;
    speakingRef.current = true;
  }
  function notifySpeakingEnd() {
    speakingRef.current = false;
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
    notifySpeakingStart,
    notifySpeakingEnd,
    supported: speechRecognitionSupported,
  };
}
