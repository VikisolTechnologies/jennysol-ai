import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        // JENNYSOL-UI-BUILD.md's "display serif at weight 400" for questions,
        // screen titles and numbers — Fraunces, loaded in index.html.
        voice: ["Fraunces", "ui-serif", "Georgia", "serif"],
      },
      colors: {
        brand: {
          50: "#f2f0ff",
          100: "#e6e2ff",
          200: "#cfc6ff",
          300: "#ac9bff",
          400: "#8b6bff",
          500: "#7645ff",
          600: "#6425f5",
          700: "#5619d1",
          800: "#4717a8",
          900: "#3c1786",
          950: "#240a5c",
        },
        // The "JennySol Aurora" system — used by the public marketing/landing
        // page (see pages/Landing.tsx) and legal pages. Deliberately additive
        // alongside `brand` above rather than replacing it: `brand` is load-
        // bearing throughout the existing authenticated app (Sidebar,
        // MainApp, GuestLimitModal, JennySolIntro) and changing it there
        // wasn't part of this task's scope.
        aurora: {
          bg: "#070A12",
          surface: "#0D111C",
          elevated: "#121827",
          blue: "#3B82F6",
          indigo: "#6366F1",
          purple: "#8B5CF6",
          violet: "#A855F7",
          cyan: "#22D3EE",
          lavender: "#C4B5FD",
          text: "#F8FAFC",
          "text-secondary": "#A7B0C0",
          "text-muted": "#667085",
          border: "#20283A",
          success: "#34D399",
          warning: "#FBBF24",
          error: "#F87171",
          info: "#60A5FA",
        },
        // JennySol product palette (JENNYSOL-UI-BUILD.md's token table) — the
        // twelve authenticated/entry-flow screens only. Named `jenny` rather
        // than reusing `brand` (still load-bearing for anything this pass
        // didn't touch) or `aurora` (the marketing/legal-page skin, out of
        // this spec's scope). Backed by the CSS custom properties in
        // index.css so arbitrary values (`bg-[var(--js-surface)]`) and these
        // named utilities (`bg-jenny-surface`) both work; the two are kept
        // in sync by hand since Tailwind can't read CSS vars at build time.
        jenny: {
          void: "#0B0A09",
          surface: "#0F0D0B",
          raised: "#1A1613",
          "raised-2": "#2A241D",
          hairline: "#1C1815",
          "hairline-card": "#241F1A",
          border: "#2A241D",
          text: "#F7F1EA",
          "text-2": "#E8DFD2",
          "text-3": "#C9BFB1",
          muted: "#8A7F6E",
          dim: "#6B6157",
          faint: "#4A443C",
          gold: "#D6A84F",
          champagne: "#F3D79B",
          "gold-mid": "#8A6A2E",
          "gold-deep": "#5A4720",
          ok: "#7E9173",
          warn: "#C8A85A",
          bad: "#B58A8A",
          "ink-on-gold": "#2A1C06",
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out",
        "slide-up": "slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
        "orb-breathe": "orb-breathe 3.4s ease-in-out infinite",
        "orb-sleep": "orb-sleep 4.5s ease-in-out infinite",
        "orb-listen": "orb-listen 1.6s ease-in-out infinite",
        "orb-think": "orb-think 2.2s linear infinite",
        "orb-tool-ring": "orb-tool-ring 1.8s linear infinite",
        "portal-ring": "portal-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite",
        "portal-spin": "portal-spin 6s linear infinite",
        "portal-spin-slow": "portal-spin 11s linear infinite reverse",
        "portal-star": "portal-star 1.8s ease-out infinite",
        "portal-zoom-out": "portal-zoom-out 0.7s cubic-bezier(0.6, 0, 0.9, 0.4) forwards",
        "intro-spark": "intro-spark 0.5s ease-out forwards",
        "intro-scene-in": "intro-scene-in 3.5s ease-out 0.5s forwards",
        "intro-core-in": "intro-core-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.5s forwards",
        "intro-title-in": "intro-title-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) 1.3s forwards",
        "intro-card-pop": "intro-card-pop 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "intro-tagline-in": "intro-tagline-in 0.8s ease-out 3.3s forwards",
        "intro-exit": "intro-exit 0.85s cubic-bezier(0.6, 0, 0.85, 0.35) forwards",
        "intro-exit-reduced": "intro-exit-reduced 0.3s ease-in forwards",
        // --- Landing page hero orb (see pages/Landing.tsx) ---
        // Deliberately slow (20s+) and linear — a continuous, ambient
        // rotation meant to sit in peripheral vision, not draw the eye the
        // way the post-auth intro's faster portal-spin does. Pure CSS
        // transform, no JS/rAF/React state involved.
        "aurora-ring-spin": "aurora-ring-spin 24s linear infinite",
        "aurora-ring-spin-reverse": "aurora-ring-spin 32s linear infinite reverse",
        "aurora-core-spin": "aurora-core-spin 18s linear infinite",
        "aurora-drift": "aurora-drift 9s ease-in-out infinite",
        "aurora-fade-up": "aurora-fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        // --- components/orb/Orb.tsx (JENNYSOL-UI-BUILD.md §3) ---
        "jenny-orb-ripple": "jenny-orb-ripple 2.8s ease-out infinite",
        "jenny-orb-core": "jenny-orb-core 2.2s ease-in-out infinite",
        "jenny-orb-breathe": "jenny-orb-breathe 4s ease-in-out infinite",
        "jenny-orb-think": "jenny-orb-think 1.6s linear infinite",
        "jenny-orb-bar": "jenny-orb-bar 0.9s ease-in-out infinite",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        "slide-up": {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 80%, 100%": { transform: "scale(0.6)", opacity: 0.4 },
          "40%": { transform: "scale(1)", opacity: 1 },
        },
        "orb-breathe": {
          "0%, 100%": { transform: "scale(1)", opacity: 0.9 },
          "50%": { transform: "scale(1.05)", opacity: 1 },
        },
        "orb-sleep": {
          "0%, 100%": { transform: "scale(0.94)", opacity: 0.55 },
          "50%": { transform: "scale(0.98)", opacity: 0.7 },
        },
        "orb-listen": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.12)" },
        },
        "orb-think": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "orb-tool-ring": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "orb-bar": {
          "0%, 100%": { transform: "scaleY(0.3)" },
          "50%": { transform: "scaleY(1)" },
        },
        "portal-ring": {
          "0%": { transform: "scale(0.15)", opacity: 0 },
          "12%": { opacity: 0.9 },
          "100%": { transform: "scale(3.2)", opacity: 0 },
        },
        "portal-spin": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "portal-star": {
          "0%": { transform: "translate(0, 0) scale(0.4)", opacity: 0 },
          "15%": { opacity: 1 },
          "100%": { transform: "var(--star-end, translate(120px, 120px)) scale(1)", opacity: 0 },
        },
        "portal-zoom-out": {
          "0%": { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
          "100%": { transform: "scale(2.4)", opacity: 0, filter: "blur(12px)" },
        },
        // --- JennySolIntro (see components/intro/) ---
        "intro-spark": {
          "0%": { transform: "scale(0)", opacity: 0 },
          "100%": { transform: "scale(1)", opacity: 1 },
        },
        "intro-scene-in": {
          "0%": { opacity: 0 },
          "60%": { opacity: 0.22 },
          "100%": { opacity: 0.38 },
        },
        "intro-core-in": {
          "0%": { transform: "scale(0.2)", opacity: 0, filter: "blur(8px)" },
          "70%": { filter: "blur(0px)" },
          "100%": { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
        },
        "intro-title-in": {
          "0%": { opacity: 0, transform: "translateY(10px)", filter: "blur(4px)" },
          "100%": { opacity: 1, transform: "translateY(0)", filter: "blur(0px)" },
        },
        // Cards start slightly inset/blurred (as if still inside the
        // portal) and settle into place sharp — the "pop into existence"
        // motion the spec calls for, driven per-card by an inline
        // animation-delay (see JennySolIntro.tsx), one shared keyframe.
        "intro-card-pop": {
          "0%": { opacity: 0, transform: "scale(0.82) translateY(6px)", filter: "blur(6px)" },
          "70%": { filter: "blur(0px)" },
          "100%": { opacity: 1, transform: "scale(1) translateY(0)", filter: "blur(0px)" },
        },
        "intro-tagline-in": {
          "0%": { opacity: 0, letterSpacing: "0.05em" },
          "100%": { opacity: 1, letterSpacing: "0.25em" },
        },
        // The transition mechanism: the whole scene brightens and expands
        // toward the camera, then dissolves — never a hard cut/white flash.
        // The parent unmounts this component once the matching JS timeout
        // fires (see JennySolIntro.tsx), revealing the real app underneath.
        // Expand-and-brighten (the portal opening wide), THEN contract back
        // down to a small bright point before fading — reads as "the
        // portal collapsed into the core" rather than just dissolving
        // outward, which is what actually sells the "this became the
        // glowing orb now sitting in the chat screen" continuity.
        "intro-exit": {
          "0%": { transform: "scale(1)", opacity: 1, filter: "brightness(1) blur(0px)" },
          "40%": { transform: "scale(1.2)", opacity: 1, filter: "brightness(1.7) blur(1px)" },
          "72%": { transform: "scale(0.82)", opacity: 0.95, filter: "brightness(2.1) blur(0px)" },
          "100%": { transform: "scale(0.62)", opacity: 0, filter: "brightness(1.3) blur(6px)" },
        },
        "intro-exit-reduced": {
          "0%": { opacity: 1 },
          "100%": { opacity: 0 },
        },
        "aurora-ring-spin": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "aurora-core-spin": {
          "0%": { transform: "rotate(0deg) scale(1)" },
          "50%": { transform: "rotate(180deg) scale(1.03)" },
          "100%": { transform: "rotate(360deg) scale(1)" },
        },
        "aurora-drift": {
          "0%, 100%": { transform: "translate(0, 0)", opacity: 0.5 },
          "50%": { transform: "translate(6px, -8px)", opacity: 1 },
        },
        "aurora-fade-up": {
          "0%": { opacity: 0, transform: "translateY(14px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "jenny-orb-ripple": {
          "0%": { transform: "scale(0.5)", opacity: 0.75 },
          "80%": { opacity: 0 },
          "100%": { transform: "scale(1.7)", opacity: 0 },
        },
        "jenny-orb-core": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.22)" },
        },
        "jenny-orb-breathe": {
          "0%, 100%": { opacity: 0.45 },
          "50%": { opacity: 0.85 },
        },
        "jenny-orb-think": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "jenny-orb-bar": {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #7645ff 0%, #a855f7 50%, #ec4899 100%)",
        "brand-gradient-soft": "linear-gradient(135deg, #7645ff15 0%, #a855f715 50%, #ec489915 100%)",
        // The signature JennySol Aurora gradient and its button variant.
        "aurora-gradient": "linear-gradient(135deg, #3B82F6 0%, #6366F1 35%, #8B5CF6 70%, #A855F7 100%)",
        "aurora-button-gradient": "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
      },
    },
  },
  plugins: [typography],
};
