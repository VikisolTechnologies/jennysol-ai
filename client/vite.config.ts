import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
