import { useEffect, useState } from "react";
import {
  Cpu,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Mic,
  Search,
  Sparkles,
  Sun,
  Clock,
  type LucideIcon,
} from "lucide-react";

// The cinematic ~5s first-run intro (see docs reference: a futuristic glass
// terrace at sunset, a glowing central orb/portal, capability chips popping
// into place). Supersedes the old WelcomeAnimation.tsx — same integration
// point in RequireAuth.tsx (gated by user.hasSeenWelcome, so it's purely a
// one-time visual layer with zero effect on auth/session/conversation
// state), same onDone contract.
//
// The reference photo (public/intro/scene.jpg) IS the environment layer —
// nothing here tries to redraw a photorealistic sunset/glass terrace in
// CSS. Everything animated (orb, portal rings, capability chips, text) is a
// design overlay on TOP of that photo, which is how the reference image
// itself is composed (the chips in it are flat glass UI elements over a
// photo backdrop, not photographed objects) — see JENNY_IMPLEMENTATION
// notes in the PR/commit for the fuller reasoning.

interface Capability {
  Icon: LucideIcon;
  label: string;
  side: "left" | "right";
  delay: number; // seconds from mount
  mobileOrder?: number; // undefined = desktop-only (hidden below sm:)
}

const CAPABILITIES: Capability[] = [
  { Icon: MessageCircle, label: "Chat Naturally", side: "left", delay: 2.0, mobileOrder: 0 },
  { Icon: Search, label: "Search the Web", side: "left", delay: 2.2, mobileOrder: 1 },
  { Icon: FileText, label: "Understand Your Files", side: "left", delay: 2.4, mobileOrder: 2 },
  { Icon: ImageIcon, label: "Generate Images", side: "left", delay: 2.6 },
  { Icon: Sun, label: "Live Weather", side: "right", delay: 2.8, mobileOrder: 3 },
  { Icon: Clock, label: "Real-time Answers", side: "right", delay: 3.0 },
  { Icon: Mic, label: "Voice Enabled", side: "right", delay: 3.1, mobileOrder: 4 },
  { Icon: Cpu, label: "Powered by Advanced AI", side: "right", delay: 3.2 },
];

const FULL_AUTO_DISMISS_MS = 4300;
const FULL_EXIT_MS = 850;
const REDUCED_AUTO_DISMISS_MS = 450;
const REDUCED_EXIT_MS = 300;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function CapabilityChip({ cap }: { cap: Capability }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 opacity-0 shadow-[0_0_20px_-4px_rgba(139,107,255,0.5)] backdrop-blur-md motion-safe:animate-intro-card-pop motion-reduce:animate-fade-in motion-reduce:opacity-100 ${
        cap.mobileOrder === undefined ? "hidden sm:flex" : "flex"
      }`}
      style={{ animationDelay: `${cap.delay}s` }}
    >
      <cap.Icon size={15} className="shrink-0 text-brand-200" />
      <span className="whitespace-nowrap text-[11px] font-medium text-white/90 sm:text-xs">{cap.label}</span>
    </div>
  );
}

export function JennySolIntro({ name, onDone }: { name: string; onDone: () => void }) {
  const [exiting, setExiting] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const dismissMs = reducedMotion ? REDUCED_AUTO_DISMISS_MS : FULL_AUTO_DISMISS_MS;
    const exitMs = reducedMotion ? REDUCED_EXIT_MS : FULL_EXIT_MS;
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(onDone, exitMs);
    }, dismissMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  function handleSkip() {
    setExiting(true);
    setTimeout(onDone, reducedMotion ? REDUCED_EXIT_MS : FULL_EXIT_MS);
  }

  const firstName = name.trim().split(/\s+/)[0] || name;
  const leftCaps = CAPABILITIES.filter((c) => c.side === "left");
  const rightCaps = CAPABILITIES.filter((c) => c.side === "right");

  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden bg-[#05070f] ${
        exiting ? "motion-safe:animate-intro-exit motion-reduce:animate-intro-exit-reduced" : ""
      }`}
      role="dialog"
      aria-label="Welcome to JennySol"
    >
      {/* Environment — the reference photo, deliberately blurred: the photo
          itself already has its own baked-in mock UI (cards/input bar/copy)
          at full sharpness, which — confirmed by screenshot testing — reads
          as a second, misaligned set of "Chat Naturally" etc. text sitting
          right behind our OWN real animated cards below. Blurring turns
          that into ambient light/shape (sunset glow, glass silhouettes,
          the palette) rather than a competing, illegible-but-still-there UI
          — the environment is intentionally lower priority than the actual
          animated capability cards (see the design-hierarchy note in this
          component's header comment / the PR description).
      */}
      <img
        src="/intro/scene.jpg"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-20 blur-[18px] motion-safe:animate-intro-scene-in motion-reduce:opacity-35"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#05070f] via-[#05070f]/45 to-[#05070f]/55" aria-hidden="true" />
      {/* Extra dimming concentrated where our OWN text/cards sit (center,
          and the two card columns) — this is what keeps the photo's own
          baked-in mock UI from ghosting through behind our real one, while
          leaving the photo's corners/edges (sky, mountains, terrace floor —
          nothing of ours overlaps there) more visible than a uniform blur
          would allow. */}
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_75%_70%_at_50%_45%,rgba(5,7,15,0.75),transparent_70%)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(139,107,255,0.25),transparent_60%)]"
        aria-hidden="true"
      />

      {/* Vikisol Labs mark, top-right — kept minimal per spec (no bio dump) */}
      <div className="absolute right-4 top-4 text-right opacity-0 motion-safe:animate-intro-title-in motion-reduce:opacity-100 sm:right-8 sm:top-6" aria-hidden="true">
        <p className="text-xs font-semibold tracking-wide text-white/90 sm:text-sm">Vikisol Labs</p>
        <p className="hidden text-[9px] uppercase tracking-[0.2em] text-white/40 sm:block">Built for a brighter tomorrow</p>
      </div>

      {/* Skip */}
      <button
        onClick={handleSkip}
        className="absolute left-4 top-4 z-10 rounded-full border border-white/15 px-3.5 py-1.5 text-[11px] font-medium text-white/60 transition hover:border-white/35 hover:text-white sm:left-8 sm:top-6"
      >
        Skip
      </button>

      {/* Core scene */}
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-6 px-4 sm:gap-8">
        {/* Portal rings + orb */}
        <div className="relative flex items-center justify-center">
          <div
            className="absolute inset-0 m-auto h-64 w-64 opacity-0 motion-safe:animate-intro-core-in motion-reduce:opacity-30 sm:h-80 sm:w-80"
            aria-hidden="true"
          >
            <div className="h-full w-full rounded-full bg-[conic-gradient(from_0deg,theme(colors.brand.500),theme(colors.sky.400),theme(colors.fuchsia.400),theme(colors.brand.500))] blur-2xl motion-safe:animate-portal-spin-slow" />
          </div>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute inset-0 m-auto h-28 w-28 rounded-full border border-brand-200/60 opacity-0 motion-safe:animate-portal-ring motion-reduce:hidden sm:h-40 sm:w-40"
              style={{ animationDelay: `${1.3 + i * 0.6}s` }}
              aria-hidden="true"
            />
          ))}

          {/* The orb itself */}
          <div className="relative opacity-0 motion-safe:animate-intro-core-in motion-reduce:opacity-100" aria-hidden="true">
            <div className="motion-safe:animate-orb-breathe motion-safe:[animation-delay:1.3s]">
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-b from-[#161a2e] to-[#0a0c18] shadow-[0_0_50px_-5px_rgba(139,107,255,0.7)] ring-1 ring-white/10 sm:h-28 sm:w-28">
                {/* sprout */}
                <Sparkles
                  size={13}
                  className="absolute -top-2.5 text-brand-200 drop-shadow-[0_0_6px_rgba(172,198,255,0.9)]"
                />
                {/* eyes */}
                <div className="flex gap-3">
                  <span className="h-2 w-3.5 rounded-full bg-brand-200 shadow-[0_0_8px_2px_rgba(172,198,255,0.8)]" />
                  <span className="h-2 w-3.5 rounded-full bg-brand-200 shadow-[0_0_8px_2px_rgba(172,198,255,0.8)]" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="text-center opacity-0 motion-safe:animate-intro-title-in motion-reduce:opacity-100">
          <h1 className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-3xl font-bold tracking-tight text-transparent drop-shadow-[0_0_20px_rgba(139,107,255,0.5)] sm:text-4xl">
            JennySol
          </h1>
          <p className="mt-1 text-xs text-white/50 sm:text-sm">Hey {firstName} — good to see you.</p>
        </div>

        {/* Capability chips */}
        <div className="pointer-events-none absolute inset-0 hidden items-center justify-between px-6 sm:flex md:px-12 lg:px-20">
          <div className="flex flex-col gap-3">
            {leftCaps.map((c) => (
              <CapabilityChip key={c.label} cap={c} />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            {rightCaps.map((c) => (
              <CapabilityChip key={c.label} cap={c} />
            ))}
          </div>
        </div>
        {/* Mobile: a compact single row of the highest-priority capabilities */}
        <div className="flex flex-wrap items-center justify-center gap-2 px-2 sm:hidden">
          {CAPABILITIES.filter((c) => c.mobileOrder !== undefined)
            .sort((a, b) => (a.mobileOrder ?? 0) - (b.mobileOrder ?? 0))
            .map((c) => (
              <CapabilityChip key={c.label} cap={c} />
            ))}
        </div>

        {/* Tagline */}
        <p
          className="absolute bottom-10 text-center text-[10px] font-medium uppercase text-white/50 opacity-0 motion-safe:animate-intro-tagline-in motion-reduce:opacity-100 sm:bottom-14 sm:text-xs"
          aria-live="off"
        >
          Thinks · Helps · Explores · With You
        </p>
      </div>
    </div>
  );
}
