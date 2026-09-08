import { useEffect, useRef } from "react";
import { Wrench } from "lucide-react";
import { getCurrentAudioElement } from "../lib/speak";

export type OrbState = "idle" | "sleeping" | "paused" | "listening" | "thinking" | "tool" | "speaking";

const BAR_DELAYS = [0, 150, 300, 100, 250];

const SIZES = {
  sm: { wrap: "h-9 w-9", bars: "h-3", gap: "gap-[2px]", barW: "w-[2.5px]" },
  lg: { wrap: "h-28 w-28 sm:h-36 sm:w-36", bars: "h-7", gap: "gap-1", barW: "w-1" },
} as const;

// One shared AudioContext — browsers cap how many you can create, and only
// one orb is ever actively speaking at a time anyway.
let sharedCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  return sharedCtx;
}

/**
 * The voice orb: idle (tiny, calm) -> sleeping (dim, armed) -> listening
 * (expanded + waveform) -> thinking (rotating swirl) -> tool (orbiting
 * activity ring) -> speaking (pulses with the actual outgoing audio, not a
 * canned loop, whenever a Gemini TTS <audio> element is available — falls
 * back to a steady pulse for the browser-voice path, which exposes no
 * analyzable audio stream). Click during "speaking" to interrupt.
 */
export function VoiceOrb({
  state,
  size = "lg",
  onInterrupt,
}: {
  state: OrbState;
  size?: "sm" | "lg";
  onInterrupt?: () => void;
}) {
  const coreRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const dims = SIZES[size];

  // Real audio-reactive scaling while speaking through Gemini TTS: an
  // AnalyserNode on the actual <audio> element, not a simulated pulse.
  useEffect(() => {
    if (state !== "speaking") return;
    const audio = getCurrentAudioElement();
    const ctx = getAudioContext();
    if (!audio || !ctx) return;

    let source: MediaElementAudioSourceNode;
    try {
      source = ctx.createMediaElementSource(audio);
    } catch {
      // Already wired to a node elsewhere (e.g. a previous render) — a
      // <audio> element can only be connected to one MediaElementSource
      // ever, so just skip reactive scaling for this play-through.
      return;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
      if (coreRef.current) {
        const scale = 1 + avg * 0.35;
        coreRef.current.style.transform = `scale(${scale.toFixed(3)})`;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (coreRef.current) coreRef.current.style.transform = "";
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        // already torn down
      }
    };
  }, [state]);

  const stateAnimation: Record<OrbState, string> = {
    idle: "motion-safe:animate-orb-breathe",
    sleeping: "motion-safe:animate-orb-sleep",
    paused: "motion-safe:animate-orb-sleep",
    listening: "motion-safe:animate-orb-listen",
    thinking: "",
    tool: "motion-safe:animate-orb-breathe",
    speaking: "", // driven imperatively above when a real audio source exists
  };

  const stateGradient: Record<OrbState, string> = {
    idle: "from-brand-300 via-brand-500 to-fuchsia-400 opacity-70",
    sleeping: "from-neutral-400 via-neutral-500 to-neutral-600 opacity-60",
    paused: "from-amber-300 via-amber-500 to-orange-500 opacity-80",
    listening: "from-brand-300 via-fuchsia-400 to-rose-400",
    thinking: "from-brand-300 via-fuchsia-400 to-brand-500",
    tool: "from-sky-300 via-brand-400 to-fuchsia-400",
    speaking: "from-brand-300 via-fuchsia-400 to-rose-400",
  };

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center ${dims.wrap} ${
        state === "speaking" ? "cursor-pointer" : ""
      }`}
      onClick={state === "speaking" ? onInterrupt : undefined}
      role={state === "speaking" ? "button" : undefined}
      aria-label={state === "speaking" ? "Tap to interrupt" : undefined}
      title={state === "speaking" ? "Tap to interrupt" : undefined}
    >
      {/* Faint outer energy ring — same visual family as the intro's portal
          rings (JennySolIntro.tsx), so the idle chat hero and the intro's
          final state read as the same object, not two different graphics.
          Static (no spin) so it stays calm/premium rather than busy. */}
      <div
        className="absolute inset-[-18%] rounded-full border border-brand-300/20 dark:border-brand-300/25"
        aria-hidden="true"
      />
      {/* ambient glow */}
      <div
        className={`absolute inset-0 rounded-full bg-gradient-to-br blur-xl ${stateGradient[state]} ${
          state === "listening" || state === "idle" ? stateAnimation[state] : "opacity-40"
        }`}
      />
      {/* thinking swirl */}
      {state === "thinking" && (
        <div className="absolute inset-[8%] motion-safe:animate-orb-think rounded-full bg-[conic-gradient(from_0deg,theme(colors.brand.300),theme(colors.fuchsia.400),theme(colors.brand.500),theme(colors.brand.300))] opacity-80" />
      )}
      {/* tool activity ring */}
      {state === "tool" && (
        <div className="absolute inset-[2%] motion-safe:animate-orb-tool-ring rounded-full border-2 border-dashed border-sky-400/70" />
      )}
      {/* core sphere */}
      <div
        ref={coreRef}
        className={`relative overflow-hidden rounded-full bg-gradient-to-br shadow-lg transition-transform ${dims.wrap} ${stateGradient[state]} ${
          state !== "thinking" && state !== "tool" ? stateAnimation[state] : ""
        }`}
        style={{ width: "78%", height: "78%" }}
      >
        {/* Slow-drifting inner light — depth/"energy" rather than a flat
            fill, without adding a face or any new per-state logic. Uses the
            same conic-spin language as the intro's core glow. */}
        <div className="absolute inset-[-40%] motion-safe:animate-portal-spin-slow rounded-full bg-[conic-gradient(from_0deg,rgba(255,255,255,0.35),transparent_35%,transparent_65%,rgba(255,255,255,0.2))] opacity-60" />
        <div className="absolute inset-[18%] rounded-full bg-white/30 blur-sm" />
        {state === "tool" && (
          <Wrench size={size === "lg" ? 22 : 12} className="absolute inset-0 m-auto text-white/90" />
        )}
      </div>
      {/* listening waveform */}
      {state === "listening" && (
        <div className={`absolute inset-0 flex items-center justify-center ${dims.gap}`}>
          {BAR_DELAYS.map((delayMs, i) => (
            <span
              key={i}
              className={`${dims.barW} ${dims.bars} motion-safe:animate-[orb-bar_0.9s_ease-in-out_infinite] rounded-full bg-white/90`}
              style={{ animationDelay: `${delayMs}ms` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
