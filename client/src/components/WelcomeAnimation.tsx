import { useEffect, useState, type CSSProperties } from "react";
import { Sparkles } from "lucide-react";

const RING_COUNT = 5;
const STAR_COUNT = 24;
const AUTO_DISMISS_MS = 4200;
const EXIT_DURATION_MS = 650; // matches the portal-zoom-out keyframe duration

function randomStarEnd(): string {
  const angle = Math.random() * Math.PI * 2;
  const distance = 300 + Math.random() * 500;
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;
  return `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
}

// A one-time "stepping into another dimension" moment on a brand-new
// account — built from the same orb/brand-gradient visual language as the
// rest of the app (see VoiceOrb.tsx) rather than a bolted-on unrelated
// effect. Pure CSS transforms/opacity, no canvas or WebGL, so it stays
// smooth on low-end hardware and respects prefers-reduced-motion via the
// motion-safe: variants used throughout.
export function WelcomeAnimation({ name, onDone }: { name: string; onDone: () => void }) {
  const [exiting, setExiting] = useState(false);
  const [stars] = useState(() =>
    Array.from({ length: STAR_COUNT }, () => ({
      end: randomStarEnd(),
      delay: Math.random() * 1.6,
      size: 2 + Math.random() * 3,
    }))
  );

  useEffect(() => {
    const timer = setTimeout(handleDone, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDone() {
    setExiting(true);
    setTimeout(onDone, EXIT_DURATION_MS);
  }

  const firstName = name.trim().split(/\s+/)[0] || name;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#05040c] ${
        exiting ? "motion-safe:animate-portal-zoom-out" : ""
      }`}
      role="dialog"
      aria-label="Welcome"
    >
      <div className="absolute inset-0">
        {stars.map((s, i) => (
          <span
            key={i}
            className="absolute left-1/2 top-1/2 rounded-full bg-white motion-safe:animate-portal-star"
            style={
              {
                width: s.size,
                height: s.size,
                animationDelay: `${s.delay}s`,
                "--star-end": s.end,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="absolute h-[140vmin] w-[140vmin] motion-safe:animate-portal-spin rounded-full bg-[conic-gradient(from_0deg,theme(colors.brand.500),theme(colors.fuchsia.500),theme(colors.rose.500),theme(colors.brand.500))] opacity-20 blur-3xl" />
      <div className="absolute h-[90vmin] w-[90vmin] motion-safe:animate-portal-spin-slow rounded-full bg-[conic-gradient(from_180deg,theme(colors.fuchsia.400),theme(colors.brand.400),theme(colors.rose.400),theme(colors.fuchsia.400))] opacity-25 blur-2xl" />

      {Array.from({ length: RING_COUNT }).map((_, i) => (
        <div
          key={i}
          className="absolute h-40 w-40 rounded-full border-2 border-brand-300/70 motion-safe:animate-portal-ring sm:h-56 sm:w-56"
          style={{ animationDelay: `${i * 0.45}s` }}
        />
      ))}

      <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-gradient shadow-2xl shadow-brand-500/50 motion-safe:animate-orb-breathe">
          <Sparkles size={34} className="text-white" />
        </div>
        <div className="motion-safe:animate-fade-in">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Welcome, {firstName}</h1>
          <p className="mt-2 text-sm text-white/60">Stepping into Jennysol AI…</p>
        </div>
        <button
          onClick={handleDone}
          className="mt-2 rounded-full border border-white/20 px-5 py-2 text-xs font-medium text-white/70 transition hover:border-white/40 hover:text-white"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
