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
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #7645ff 0%, #a855f7 50%, #ec4899 100%)",
        "brand-gradient-soft": "linear-gradient(135deg, #7645ff15 0%, #a855f715 50%, #ec489915 100%)",
      },
    },
  },
  plugins: [typography],
};
