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
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #7645ff 0%, #a855f7 50%, #ec4899 100%)",
        "brand-gradient-soft": "linear-gradient(135deg, #7645ff15 0%, #a855f715 50%, #ec489915 100%)",
      },
    },
  },
  plugins: [typography],
};
