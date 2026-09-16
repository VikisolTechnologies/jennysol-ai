import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // JENNYSOL-MOBILE-AND-ACTIONS.md Part B.1: "PWA (days, not months)...
    // installable: manifest, icons, splash, service worker, offline shell."
    // generateSW (Workbox's default precache strategy) only ever caches
    // this build's own static output (JS/CSS/HTML/icons via globPatterns
    // below) — real API requests (/api/*) are never matched by those
    // globs, so chat/auth/everything else always hits the real network
    // exactly as it does today. "Offline" here means the app shell still
    // loads and renders with no connection, not that chat works offline,
    // which would be a fabricated capability for an assistant that
    // fundamentally needs a live backend.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: "JennySol",
        short_name: "JennySol",
        description: "JennySol — your intelligence layer.",
        theme_color: "#0B0A09",
        background_color: "#0B0A09",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        // Workbox's navigateFallback only ever intercepts full-page
        // navigations (not the fetch()/XHR calls every real /api/* request
        // in this app actually is), so this is defense-in-depth rather
        // than a fix for an observed problem: even a future full-page
        // navigation to an /api/ path is guaranteed to hit the real server,
        // never a cached index.html.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  define: {
    // Vercel sets VERCEL_GIT_COMMIT_SHA automatically for every build
    // triggered by a git push — baked in at build time (Vite `define` is a
    // literal source replacement, same as any other build-time constant),
    // never read at runtime, so this is safe/static per deployed bundle.
    // Falls back to "dev" for a local `vite build` outside Vercel.
    __BUILD_VERSION__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev"),
  },
});
