import { useEffect, useRef, useState } from "react";
import { getCurrentAudioElement } from "../../lib/speak";

// JENNYSOL-UI-BUILD.md §3 — "The orb — one component, five states." The
// product's signature, used at three sizes (xl 150px welcome, lg 52px
// screen-level presence, sm 34px inline marker). Every other orb-shaped
// thing in the app (VoiceOrb.tsx's richer 7-state chat integration) wraps
// this rather than duplicating it, so "one single component" is actually
// true rather than aspirational.
export type OrbState = "asleep" | "speaking" | "listening" | "thinking" | "unavailable";

const SIZE_PX = { xl: 150, lg: 52, sm: 34 } as const;
export type OrbSize = keyof typeof SIZE_PX;

// One shared AudioContext for outgoing (speaking) playback analysis — same
// reasoning as the old VoiceOrb.tsx: browsers cap concurrent contexts, and
// only one orb is ever actually speaking at a time.
let sharedPlaybackCtx: AudioContext | null = null;
function getPlaybackAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedPlaybackCtx) sharedPlaybackCtx = new Ctor();
  return sharedPlaybackCtx;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// Pauses continuous animation on a hidden tab — JENNYSOL-UI-BUILD.md §3's
// explicit rule: "Continuous CSS animation on every screen is a real
// battery cost on phones." Toggled via a data attribute rather than
// unmounting anything, so state (e.g. an in-progress ripple) resumes
// cleanly rather than restarting.
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

// Real microphone-amplitude bars for the "listening" state — JENNYSOL-UI-
// BUILD.md §3 rule 1: "Listening is driven by actual microphone amplitude.
// Never a looping animation. A waveform that moves while the mic is dead is
// worse than no voice feature." Opens its own getUserMedia stream scoped to
// this component instance (independent of whatever speech-recognition
// mechanism a caller may separately be running against the same physical
// mic) and tears it down the instant the state stops being "listening" or
// the component unmounts. Returns 4 bar heights in [0.12, 1] — 0.12 (not 0)
// so a silent mic still reads as "a live, held-open meter", not a dead one.
function useMicAmplitudeBars(active: boolean): number[] {
  const [bars, setBars] = useState<number[]>([0.12, 0.12, 0.12, 0.12]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setBars([0.12, 0.12, 0.12, 0.12]);
      return;
    }
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // Permission denied/no device — the bars simply hold at the flat
        // resting height above rather than faking motion (see rule 1).
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      // 4 bars, each reading a distinct slice of the real frequency data
      // (not 4 copies of the same average) so the meter has real texture,
      // not a single pulsing block rendered 4 times.
      const sliceSize = Math.floor(data.length / 4) || 1;

      function tick() {
        analyser.getByteFrequencyData(data);
        const next = [0, 1, 2, 3].map((i) => {
          const start = i * sliceSize;
          const slice = data.slice(start, start + sliceSize);
          const avg = slice.reduce((a, b) => a + b, 0) / (slice.length * 255 || 1);
          return Math.max(0.12, Math.min(1, avg * 1.8));
        });
        setBars(next);
        rafRef.current = requestAnimationFrame(tick);
      }
      tick();
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    };
  }, [active]);

  return bars;
}

export function Orb({
  state,
  size = "lg",
  onInterrupt,
  className = "",
}: {
  state: OrbState;
  size?: OrbSize;
  /** Speaking is interruptible by design — clicking stops playback. */
  onInterrupt?: () => void;
  className?: string;
}) {
  const px = SIZE_PX[size];
  const reducedMotion = usePrefersReducedMotion();
  const pageVisible = usePageVisible();
  const animate = !reducedMotion && pageVisible && state !== "asleep";
  const coreRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const bars = useMicAmplitudeBars(state === "listening");

  // Real outgoing-audio-reactive core scale while speaking, same mechanism
  // as the retired VoiceOrb.tsx — an AnalyserNode on the actual <audio>
  // element playing Jenny's TTS, not a simulated pulse layered on top of it.
  useEffect(() => {
    if (state !== "speaking") return;
    const audio = getCurrentAudioElement();
    const ctx = getPlaybackAudioContext();
    if (!audio || !ctx) return;
    let source: MediaElementAudioSourceNode;
    try {
      source = ctx.createMediaElementSource(audio);
    } catch {
      return; // already wired elsewhere this play-through
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
      if (coreRef.current) coreRef.current.style.transform = `scale(${(1 + avg * 0.3).toFixed(3)})`;
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

  const coreSizePx = Math.round(px * (size === "xl" ? 0.32 : 0.38));
  const isInteractive = state === "speaking" && !!onInterrupt;

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center ${isInteractive ? "cursor-pointer" : ""} ${className}`}
      style={{ width: px, height: px }}
      onClick={isInteractive ? onInterrupt : undefined}
      role={isInteractive ? "button" : undefined}
      aria-label={
        isInteractive
          ? "Tap to interrupt"
          : state === "unavailable"
            ? "Jenny is unavailable"
            : state === "listening"
              ? "Listening"
              : state === "thinking"
                ? "Thinking"
                : undefined
      }
      title={isInteractive ? "Tap to interrupt" : undefined}
    >
      {/* ASLEEP — outline only, slow breath, no core. Real bug found live:
          at sm (34px) a 1px jenny-gold-deep (#5A4720, deliberately low-
          contrast) ring was faint enough to read as invisible, leaving only
          whatever solid-core state was rendered next to it (e.g. the old
          hardcoded "speaking" on auth screens) as "the thing you can see" --
          exactly the "small static filled dot" complaint. gold-mid + a
          thicker stroke keeps this the calmest state (still the only one
          with no core) while actually being visible at small sizes. */}
      {state === "asleep" && (
        <span
          className={`block rounded-full border-[1.5px] border-jenny-gold-mid ${animate ? "motion-safe:animate-jenny-orb-breathe" : "opacity-60"}`}
          style={{ width: px * 0.65, height: px * 0.65 }}
        />
      )}

      {/* SPEAKING — 2-3 rippling rings + pulsing gold core, real audio-reactive scale layered on top via coreRef. */}
      {state === "speaking" && (
        <>
          <span
            className={`absolute rounded-full border-[1.5px] border-jenny-gold ${animate ? "motion-safe:animate-jenny-orb-ripple" : "opacity-0"}`}
            style={{ width: px, height: px }}
          />
          <span
            className={`absolute rounded-full border-[1.5px] border-jenny-gold-mid ${animate ? "motion-safe:animate-jenny-orb-ripple" : "opacity-0"}`}
            style={{ width: px, height: px, animationDelay: "0.9s" }}
          />
          {size === "xl" && (
            <span
              className={`absolute rounded-full border-[1.5px] border-jenny-gold-deep ${animate ? "motion-safe:animate-jenny-orb-ripple" : "opacity-0"}`}
              style={{ width: px, height: px, animationDelay: "1.8s" }}
            />
          )}
          <div
            ref={coreRef}
            className={`rounded-full bg-jenny-gold transition-transform ${animate ? "motion-safe:animate-jenny-orb-core" : ""}`}
            style={{ width: coreSizePx, height: coreSizePx }}
          />
          {/* Twinkle points, offset delays — omitted at sm (34px) where they'd be imperceptible. */}
          {size !== "sm" && (
            <>
              <span
                className={`absolute rounded-full bg-jenny-champagne ${animate ? "motion-safe:animate-jenny-orb-breathe" : ""}`}
                style={{ width: 3, height: 3, top: "18%", right: "20%" }}
                aria-hidden="true"
              />
              <span
                className={`absolute rounded-full bg-jenny-champagne ${animate ? "motion-safe:animate-jenny-orb-breathe" : ""}`}
                style={{ width: 2, height: 2, bottom: "22%", left: "16%", animationDelay: "0.8s" }}
                aria-hidden="true"
              />
            </>
          )}
        </>
      )}

      {/* LISTENING — 4 bars, real mic amplitude, never a canned loop. */}
      {state === "listening" && (
        <div className="flex items-end gap-[3px]" style={{ height: px * 0.5 }}>
          {bars.map((h, i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-jenny-gold transition-[height] duration-75 ease-out"
              style={{ height: `${Math.max(12, h * 100)}%` }}
            />
          ))}
        </div>
      )}

      {/* THINKING — single gold arc rotating, core dimmed. */}
      {state === "thinking" && (
        <>
          <span
            className={`absolute rounded-full border border-transparent border-t-jenny-champagne ${animate ? "motion-safe:animate-jenny-orb-think" : ""}`}
            style={{ width: px * 0.7, height: px * 0.7 }}
          />
          <div className="rounded-full bg-jenny-gold-deep" style={{ width: coreSizePx * 0.4, height: coreSizePx * 0.4 }} />
        </>
      )}

      {/* UNAVAILABLE — grey ring, diagonal strike, no motion, ever. */}
      {state === "unavailable" && (
        <>
          <span className="block rounded-full border border-jenny-faint" style={{ width: px * 0.65, height: px * 0.65 }} />
          <span
            className="absolute bg-jenny-bad/70"
            style={{ width: px * 0.72, height: 1, transform: "rotate(-45deg)" }}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
}
