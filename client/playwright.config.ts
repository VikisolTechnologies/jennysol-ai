import { defineConfig, devices } from "@playwright/test";

// JENNYSOL-UI-BUILD.md §9's own QA checklist: "Screenshots of all twelve
// committed as the visual baseline, with Playwright visual regression
// tests." Runs against a real, isolated server instance (port 8788 — never
// the production LaunchAgent on 8787) so a test run never touches real
// production data, and a real vite dev server pointed at it via
// VITE_API_BASE_URL (bypassing the app's default same-origin proxy, which
// is hardcoded to 8787 for real local development and deliberately left
// untouched here).
const API_PORT = 8788;
const CLIENT_PORT = 5175;

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: false, // shares one guest/account lifecycle per spec file — see tests/visual/fixtures.ts
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev",
      cwd: "../server",
      port: API_PORT,
      // NODE_ENV=test — server/src/routes/auth.ts's own real signup/login/
      // guest rate limiter already special-cases this exact scenario ("real
      // HTTP-layer tests... exercise signup/login/guest dozens of times...
      // a real production abuse-prevention concern, not something that
      // should also make correctness tests flaky"), the same precedent
      // httpRoutes.test.ts already relies on — not a limiter this suite is
      // weakening for its own convenience.
      env: { PORT: String(API_PORT), NODE_ENV: "test" },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run dev -- --port ${CLIENT_PORT} --strictPort`,
      port: CLIENT_PORT,
      env: { VITE_API_BASE_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"] } },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 800 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "desktop-1920", use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
