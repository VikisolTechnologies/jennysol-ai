import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Brain,
  Clock,
  FileText,
  Image as ImageIcon,
  Lock,
  Menu,
  MessageCircle,
  Mic,
  Search,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { fetchLiveCapabilities, type LiveCapability } from "../lib/api";

// The public marketing/discovery page — reachable at /welcome. Deliberately
// NOT the "/" route: this app's actual, tested product decision (see
// AuthContext.tsx) is that every visitor to "/" gets a real guest session
// created automatically and lands straight in a working chat with zero
// friction. Gating a marketing page in front of that would either (a) never
// actually be seen, since guest login resolves before render in the normal
// case, or (b) require removing that deliberate frictionless entry — a real
// behavioral change to a working, already-tested system, not something to
// do silently as a side effect of adding a landing page. This page exists
// for people who land here from a link, an ad, or "Learn more" — not as a
// gate in front of the app.

function useLiveCapabilities(): Record<string, boolean> {
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    fetchLiveCapabilities()
      .then((caps: LiveCapability[]) => {
        if (cancelled) return;
        const map: Record<string, boolean> = {};
        for (const c of caps) map[c.id] = c.available;
        setAvailable(map);
      })
      .catch(() => {
        // Network hiccup — every gated card below defaults to its honest
        // "unavailable" copy rather than assuming it works.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-sm font-medium text-[var(--aurora-text-secondary)] transition hover:text-[var(--aurora-text)]"
    >
      {children}
    </a>
  );
}

function TopNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--aurora-border)]/60 bg-[var(--aurora-bg)]/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <span className="text-sm font-semibold tracking-[0.15em] text-[var(--aurora-text)]">VIKISOL LABS</span>

        <nav className="hidden items-center gap-8 md:flex">
          <NavLink href="#capabilities">Product</NavLink>
          <NavLink href="#agents">Agents</NavLink>
          <NavLink href="#capabilities">Capabilities</NavLink>
          <NavLink href="#privacy">Security</NavLink>
          <NavLink href="#ecosystem">About</NavLink>
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            to="/login"
            className="rounded-full px-4 py-2 text-sm font-medium text-[var(--aurora-text-secondary)] transition hover:text-[var(--aurora-text)]"
          >
            Sign in
          </Link>
          <Link
            to="/"
            className="rounded-full bg-aurora-button-gradient px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_-6px_rgba(139,92,246,0.7)] transition hover:opacity-90"
          >
            Get started
          </Link>
        </div>

        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-lg p-2 text-[var(--aurora-text)] md:hidden"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-[var(--aurora-border)]/60 bg-[var(--aurora-bg)] px-4 pb-4 pt-2 md:hidden">
          <nav className="flex flex-col gap-1">
            {[
              ["#capabilities", "Product"],
              ["#agents", "Agents"],
              ["#capabilities", "Capabilities"],
              ["#privacy", "Security"],
              ["#ecosystem", "About"],
            ].map(([href, label]) => (
              <a
                key={label}
                href={href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-2 py-2.5 text-sm font-medium text-[var(--aurora-text-secondary)] hover:bg-[var(--aurora-surface)] hover:text-[var(--aurora-text)]"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex flex-col gap-2 border-t border-[var(--aurora-border)]/60 pt-3">
            <Link
              to="/login"
              className="rounded-full border border-[var(--aurora-border)] px-4 py-2 text-center text-sm font-medium text-[var(--aurora-text)]"
            >
              Sign in
            </Link>
            <Link
              to="/"
              className="rounded-full bg-aurora-button-gradient px-4 py-2 text-center text-sm font-semibold text-white"
            >
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

// Pure-CSS, GPU-friendly (transform-only) continuous rotation — no JS
// animation loop, no per-frame React state. Three independently-timed
// layers (outer ring, reverse ring, core) is what reads as "orbital energy"
// rather than one flat spinning disc, while staying cheap: three elements,
// three CSS animations, nothing else.
// Entrance choreography (0.4s environment -> 1.6s core emerges -> 2.6s
// orbital energy -> continues into the headline/chip beats in Landing()
// below), then the orb keeps revolving indefinitely at idle — it never
// settles into a static image. Staged via plain CSS keyframes + per-element
// animationDelay (the same technique JennySolIntro.tsx already uses for its
// portal sequence), not JS timers or per-frame React state — every moving
// piece here is a GPU-composited transform/opacity animation. Reduced
// motion collapses straight to the idle end-state (motion-reduce:opacity-100
// + the continuous spins are motion-safe-only, so they simply don't run).
function HeroOrb() {
  return (
    <div className="relative mx-auto flex h-64 w-64 items-center justify-center sm:h-80 sm:w-80" aria-hidden="true">
      {/* atmosphere: environment glow, 0.4s-1.4s. Two elements, not one —
          the one-time opacity fade and the continuous drift transform are
          two separate `animation` shorthand values, and stacking two
          Tailwind animate-* classes on a single element doesn't merge them
          (the second silently wins); nesting keeps each animation on its
          own element instead. */}
      <div
        className="absolute inset-0 opacity-0 motion-safe:animate-fade-in motion-reduce:opacity-30"
        style={{ animationDelay: "0.4s", animationFillMode: "forwards" }}
      >
        <div className="h-full w-full rounded-full bg-aurora-gradient blur-3xl motion-safe:animate-aurora-drift" />
      </div>

      {/* rings + energy trail: begin orbiting at 2.6s */}
      <div
        className="absolute inset-4 opacity-0 motion-safe:animate-fade-in motion-reduce:opacity-100"
        style={{ animationDelay: "2.6s", animationFillMode: "forwards" }}
      >
        <div className="h-full w-full rounded-full border border-[var(--aurora-indigo)]/30 motion-safe:animate-aurora-ring-spin" />
      </div>
      <div
        className="absolute inset-10 opacity-0 motion-safe:animate-fade-in motion-reduce:opacity-100"
        style={{ animationDelay: "2.7s", animationFillMode: "forwards" }}
      >
        <div className="h-full w-full rounded-full border border-[var(--aurora-violet)]/20 motion-safe:animate-aurora-ring-spin-reverse" />
      </div>

      {/* core: emerges 1.6s-2.4s, then breathes/rotates continuously forever */}
      <div
        className="relative flex h-40 w-40 items-center justify-center rounded-full bg-gradient-to-b from-[var(--aurora-elevated)] to-[var(--aurora-bg)] opacity-0 shadow-[0_0_80px_-10px_rgba(139,92,246,0.6)] ring-1 ring-white/10 motion-safe:animate-intro-core-in motion-reduce:opacity-100 sm:h-48 sm:w-48"
        style={{ animationDelay: "1.6s" }}
      >
        <div className="absolute inset-1 overflow-hidden rounded-full">
          <div className="h-full w-full bg-aurora-gradient opacity-70 motion-safe:animate-aurora-core-spin" />
        </div>
        <div className="absolute inset-[3px] rounded-full bg-[var(--aurora-bg)]/90 backdrop-blur-sm" />
        <Sparkles size={22} className="relative z-10 text-[var(--aurora-cyan)] drop-shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
      </div>
    </div>
  );
}

interface HeroChipDef {
  id: string;
  label: string;
  gate?: string;
}

const HERO_CHIPS: HeroChipDef[] = [
  { id: "chat", label: "Chat" },
  { id: "search", label: "Search", gate: "WEB_SEARCH" },
  { id: "voice", label: "Voice" },
  { id: "create", label: "Create", gate: "IMAGE_GENERATION" },
];

function HeroChip({ label, delay }: { label: string; delay: number }) {
  return (
    <div
      className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-3.5 py-1.5 text-xs font-medium text-[var(--aurora-text)] opacity-0 backdrop-blur-md motion-safe:animate-intro-card-pop motion-reduce:opacity-100"
      style={{ animationDelay: `${delay}s` }}
    >
      {label}
    </div>
  );
}

interface CapabilityCard {
  id: string;
  Icon: typeof MessageCircle;
  label: string;
  description: string;
  href: string;
  gate?: string; // key into live capabilities; undefined = always shown as real
}

const CAPABILITY_CARDS: CapabilityCard[] = [
  { id: "chat", Icon: MessageCircle, label: "Chat", description: "Ask anything, get real answers.", href: "/" },
  { id: "search", Icon: Search, label: "Search", description: "Live web search with real citations.", href: "/", gate: "WEB_SEARCH" },
  { id: "voice", Icon: Mic, label: "Voice", description: "Talk naturally, hear Jenny reply.", href: "/" },
  { id: "create", Icon: ImageIcon, label: "Create", description: "Generate images from a prompt.", href: "/", gate: "IMAGE_GENERATION" },
  { id: "files", Icon: FileText, label: "Files", description: "Upload documents, ask grounded questions.", href: "/" },
  { id: "memory", Icon: Brain, label: "Memory", description: "Jenny remembers your conversation.", href: "#capabilities" },
];

function CapabilityCardView({ card, live }: { card: CapabilityCard; live: Record<string, boolean> }) {
  const gated = card.gate !== undefined;
  const isLive = !gated || live[card.gate!] === true;
  const known = !gated || card.gate! in live;

  return (
    <Link
      to={card.href}
      className="group flex flex-col gap-3 rounded-2xl border border-[var(--aurora-border)] bg-[var(--aurora-surface)]/60 p-5 transition hover:border-[var(--aurora-indigo)]/50 hover:bg-[var(--aurora-elevated)]"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--aurora-elevated)] text-[var(--aurora-lavender)] ring-1 ring-white/10">
        <card.Icon size={18} />
      </div>
      <div>
        <p className="text-sm font-semibold text-[var(--aurora-text)]">{card.label}</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--aurora-text-secondary)]">{card.description}</p>
      </div>
      {gated && known && !isLive && (
        <span className="mt-1 inline-flex w-fit items-center rounded-full bg-[var(--aurora-warning)]/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--aurora-warning)]">
          Currently unavailable
        </span>
      )}
    </Link>
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--aurora-indigo)]">{eyebrow}</p>
      <h2 className="mt-3 max-w-2xl text-2xl font-semibold text-[var(--aurora-text)] sm:text-3xl">{title}</h2>
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function Landing() {
  const live = useLiveCapabilities();

  return (
    <div className="h-[var(--app-vh)] overflow-y-auto bg-[var(--aurora-bg)] text-[var(--aurora-text)]">
      <TopNav />

      {/* Hero */}
      <section className="relative overflow-hidden px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(99,102,241,0.18),transparent_70%)]"
          aria-hidden="true"
        />
        <div
          className="relative mx-auto max-w-3xl text-center opacity-0 motion-safe:animate-aurora-fade-up motion-reduce:opacity-100"
          style={{ animationDelay: "3.4s" }}
        >
          <p className="text-sm font-medium text-[var(--aurora-text-secondary)]">Hello, I&apos;m</p>
          <h1 className="mt-1 bg-gradient-to-r from-[var(--aurora-blue)] via-[var(--aurora-indigo)] to-[var(--aurora-violet)] bg-clip-text text-5xl font-semibold tracking-tight text-transparent sm:text-6xl">
            JennySol
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-[var(--aurora-text-secondary)] sm:text-lg">
            Your AI companion for a brighter tomorrow. Think, search, create and get things done —
            with honest answers about what's actually live right now.
          </p>
        </div>

        <div className="relative mx-auto mt-10 w-64 sm:w-80">
          <HeroOrb />
          {/* Flanking capability chips, hidden below md to keep the small
              viewport hero uncluttered — the fuller capability cards below
              cover the same ground on mobile. */}
          <div className="pointer-events-none absolute inset-y-0 left-0 hidden -translate-x-[calc(100%+16px)] flex-col justify-center gap-3 md:flex">
            {HERO_CHIPS.slice(0, 2).map((chip, i) => {
              const known = !chip.gate || chip.gate in live;
              const isLive = !chip.gate || live[chip.gate] === true;
              if (chip.gate && known && !isLive) return null;
              return <HeroChip key={chip.id} label={chip.label} delay={4.6 + i * 0.15} />;
            })}
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden translate-x-[calc(100%+16px)] flex-col justify-center gap-3 md:flex">
            {HERO_CHIPS.slice(2).map((chip, i) => {
              const known = !chip.gate || chip.gate in live;
              const isLive = !chip.gate || live[chip.gate] === true;
              if (chip.gate && known && !isLive) return null;
              return <HeroChip key={chip.id} label={chip.label} delay={4.9 + i * 0.15} />;
            })}
          </div>
        </div>

        <div
          className="relative mx-auto mt-10 flex max-w-md flex-col items-center gap-3 opacity-0 motion-safe:animate-aurora-fade-up motion-reduce:opacity-100"
          style={{ animationDelay: "3.8s" }}
        >
          <Link
            to="/"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-aurora-button-gradient px-6 py-3.5 text-sm font-semibold text-white shadow-[0_0_30px_-8px_rgba(139,92,246,0.8)] transition hover:opacity-90 sm:w-auto sm:px-8"
          >
            Let&apos;s build your tomorrow
            <ArrowRight size={16} />
          </Link>
          <p className="text-xs text-[var(--aurora-text-muted)]">No sign-up required to start — you can create an account anytime.</p>
        </div>
      </section>

      {/* Capability cards */}
      <Section id="capabilities" eyebrow="What JennySol can do" title="Real capabilities, honestly labeled">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {CAPABILITY_CARDS.map((card) => (
            <CapabilityCardView key={card.id} card={card} live={live} />
          ))}
        </div>
        <p className="mt-6 text-xs text-[var(--aurora-text-muted)]">
          A capability marked "currently unavailable" means the underlying provider is temporarily
          blocked (billing, quota, or configuration) — not that it's fake. It restores itself
          automatically the moment that's resolved, with no code change needed.
        </p>
      </Section>

      {/* Agents — honest: no user-facing agent catalog exists yet */}
      <Section id="agents" eyebrow="Coming next" title="Agents">
        <div className="rounded-2xl border border-[var(--aurora-border)] bg-[var(--aurora-surface)]/40 p-6 sm:p-8">
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--aurora-text-secondary)]">
            JennySol's chat already runs on a durable execution model under the hood — every reply
            is tracked end-to-end, survives a closed tab, and can be resumed. A dedicated, user-facing
            library of purpose-built agents (research, travel, coding, and more) built on that same
            foundation is planned but not yet available.
          </p>
          <span className="mt-4 inline-flex w-fit items-center rounded-full bg-[var(--aurora-elevated)] px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--aurora-text-muted)] ring-1 ring-white/10">
            Coming soon
          </span>
        </div>
      </Section>

      {/* Search / current information */}
      <Section eyebrow="Live information" title="Search &amp; current information">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--aurora-border)] bg-[var(--aurora-surface)]/40 p-6">
            <Search size={18} className="text-[var(--aurora-cyan)]" />
            <p className="mt-3 text-sm leading-relaxed text-[var(--aurora-text-secondary)]">
              When a question needs a real, current answer — the latest news, a live price, today's
              date and time — JennySol runs a real web search and cites where the answer came from.
              It never relies on the model's own training data to answer questions that require live
              verification.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--aurora-border)] bg-[var(--aurora-surface)]/40 p-6">
            <Clock size={18} className="text-[var(--aurora-cyan)]" />
            <p className="mt-3 text-sm leading-relaxed text-[var(--aurora-text-secondary)]">
              If live search genuinely can't be reached for a moment, JennySol says so plainly
              instead of guessing from outdated knowledge. Citations show the source, domain, and
              how recent the information is whenever that's available.
            </p>
          </div>
        </div>
      </Section>

      {/* Voice */}
      <Section eyebrow="Hands-free" title="Voice">
        <div className="rounded-2xl border border-[var(--aurora-border)] bg-[var(--aurora-surface)]/40 p-6 sm:p-8">
          <Mic size={18} className="text-[var(--aurora-lavender)]" />
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--aurora-text-secondary)]">
            Speak naturally and JennySol listens continuously — no wake word needed on the default
            path, real barge-in support (start talking while Jenny is speaking to interrupt her),
            and a click-to-interrupt fallback that always works regardless of your microphone setup.
          </p>
        </div>
      </Section>

      {/* Memory — honest framing */}
      <Section eyebrow="Continuity" title="Memory">
        <div className="rounded-2xl border border-[var(--aurora-border)] bg-[var(--aurora-surface)]/40 p-6 sm:p-8">
          <Brain size={18} className="text-[var(--aurora-lavender)]" />
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--aurora-text-secondary)]">
            JennySol keeps your full conversation history, scoped to your account and never visible
            to anyone else. Today that means real, persistent chat history — not a separate long-term
            memory that extracts and recalls facts across different conversations. If you ask what
            Jenny remembers about you, she'll tell you honestly rather than guess.
          </p>
        </div>
      </Section>

      {/* Privacy & Security */}
      <Section id="privacy" eyebrow="Trust" title="Privacy &amp; security">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--aurora-border)] bg-[var(--aurora-surface)]/40 p-6">
            <Shield size={18} className="text-[var(--aurora-success)]" />
            <p className="mt-3 text-sm leading-relaxed text-[var(--aurora-text-secondary)]">
              Every account is isolated — your conversations, files, and sessions are never visible
              to another user. Passwords are hashed, never stored in plain text, and a password reset
              immediately revokes every other active session.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--aurora-border)] bg-[var(--aurora-surface)]/40 p-6">
            <Lock size={18} className="text-[var(--aurora-success)]" />
            <p className="mt-3 text-sm leading-relaxed text-[var(--aurora-text-secondary)]">
              You can sign out of any single session or all of them at once. See our{" "}
              <Link to="/privacy" className="underline decoration-[var(--aurora-indigo)]/50 underline-offset-2 hover:text-[var(--aurora-text)]">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link to="/terms" className="underline decoration-[var(--aurora-indigo)]/50 underline-offset-2 hover:text-[var(--aurora-text)]">
                Terms of Service
              </Link>{" "}
              for the full details.
            </p>
          </div>
        </div>
      </Section>

      {/* Vikisol ecosystem */}
      <Section id="ecosystem" eyebrow="The bigger picture" title="Part of the Vikisol ecosystem">
        <div className="rounded-2xl border border-[var(--aurora-border)] bg-[var(--aurora-surface)]/40 p-6 sm:p-8">
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--aurora-text-secondary)]">
            JennySol is built by Vikisol Labs as an independent AI platform first. Over time, it's
            intended to become the shared AI foundation across Vikisol's other products — but
            JennySol works fully on its own today, with nothing about its core chat, search, or
            voice experience depending on any other Vikisol product.
          </p>
        </div>
      </Section>

      {/* Final CTA */}
      <section className="mx-auto max-w-3xl px-4 pb-24 pt-4 text-center sm:px-6">
        <h2 className="text-2xl font-semibold text-[var(--aurora-text)] sm:text-3xl">Ready when you are.</h2>
        <div className="mt-6 flex justify-center">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-full bg-aurora-button-gradient px-8 py-3.5 text-sm font-semibold text-white shadow-[0_0_30px_-8px_rgba(139,92,246,0.8)] transition hover:opacity-90"
          >
            Let&apos;s build your tomorrow
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--aurora-border)]/60 px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs text-[var(--aurora-text-muted)] sm:flex-row">
          <span>Vikisol Technologies</span>
          <div className="flex items-center gap-5">
            <Link to="/privacy" className="hover:text-[var(--aurora-text-secondary)]">Privacy</Link>
            <Link to="/terms" className="hover:text-[var(--aurora-text-secondary)]">Terms</Link>
          </div>
          <span>A more capable you</span>
        </div>
      </footer>
    </div>
  );
}
