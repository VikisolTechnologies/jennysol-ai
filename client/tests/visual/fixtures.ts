import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Stubs the real chat send + its follow-up run-metadata fetch, so any
// spec that needs to *see* a reply on screen (layout/chrome screenshots)
// never makes a real call to the shared, real, production-adjacent Gemini
// key. Found live and worth fixing for real: this suite's own real sends
// were a genuine contributor to a real quota/timeout incident on the
// shared backend (see JENNY_IMPLEMENTATION_STATUS.md's 2026-09-15 entry) —
// a visual-regression run asserting on layout has no real reason to touch
// a live model at all. Mirrors lib/api.ts's exact real SSE event shape
// (run.started/message.delta/done) and the real AgentRun shape fetchRun
// expects, so ChatWindow's real parsing/rendering code runs unmodified —
// only the network boundary is fake, not the client logic under test.
export async function mockChatReply(
  page: Page,
  replyText = "This is a stubbed reply for visual testing.",
  // Real delay before the stubbed stream starts — 0 by default (every
  // existing caller wants the reply settled as fast as possible). A caller
  // that specifically needs to observe the real, brief "thinking" window
  // between send and reply (see ChatWindow.tsx's own orbState — driven by
  // its real `sending` flag) passes a real delay here instead of racing a
  // fixed timeout against however fast this stub happens to resolve.
  delayMs = 0
): Promise<void> {
  const runId = `test-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const conversationId = `test-conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // ChatWindow's real eyebrow (formatSeconds) computes completedAt-startedAt
  // in ms from these two strings, but ISO milliseconds get truncated away by
  // the slice(0, 19) below (matching the real second-precision timestamps
  // agentRunStore.ts actually persists) — a small Date.now()-derived gap
  // (e.g. 900ms) can silently round to 0s or 1s depending on where the two
  // reads land relative to a second boundary, which is exactly the kind of
  // flake a deterministic stub shouldn't have. Anchoring both ends to the
  // same whole-second instant and offsetting by a full 2 seconds survives
  // that truncation exactly, every run.
  const anchorMs = Math.floor(Date.now() / 1000) * 1000;
  const startedAt = new Date(anchorMs - 2000).toISOString().replace("T", " ").slice(0, 19);
  const completedAt = new Date(anchorMs).toISOString().replace("T", " ").slice(0, 19);
  // A real send flips ChatWindow's own conversationId state the instant
  // run.started arrives — for a brand-new conversation that re-triggers its
  // conversationId-keyed effect (ChatWindow.tsx ~L213), which synchronously
  // resets `sending` to false and then re-derives the real answer from
  // fetchActiveRuns(): true again if a matching run is still genuinely
  // queued/running/streaming server-side, unchanged otherwise. Found live,
  // the hard way: with no mock for /api/agent/runs/active, that lookup hits
  // the real server, finds nothing (this run only ever existed client-side),
  // and `sending` never gets re-armed — collapsing "thinking" to false
  // within tens of milliseconds regardless of `delayMs`, entirely a gap in
  // this mock's fidelity, not real app behavior (the real backend has
  // already created the real row by the time run.started reaches the
  // client, so this same reconciliation is a same-tick no-op in production).
  // Mirroring that: report this run as still "streaming" for exactly the
  // requested delay window, "completed" after — same shape a real backend
  // would return if asked the same question at either moment.
  const sendStartedAt = Date.now();
  function stillInFlight(): boolean {
    return Date.now() - sendStartedAt < delayMs;
  }

  await page.route("**/api/chat", async (route) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const body = [
      `data: ${JSON.stringify({ type: "run.started", runId, conversationId, requestId: `test-req-${Date.now()}` })}\n\n`,
      `data: ${JSON.stringify({ type: "agent.status", status: "streaming" })}\n\n`,
      `data: ${JSON.stringify({ type: "message.delta", delta: replyText })}\n\n`,
      `data: ${JSON.stringify({ type: "done", sources: [] })}\n\n`,
    ].join("");
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });

  // The same conversationId-change effect awaits this real endpoint first
  // (ChatWindow.tsx ~L225, fetchConversationMessages) before it ever reaches
  // the fetchActiveRuns() reconciliation above — unmocked, it 404s against
  // the real server for this purely client-side conversationId, the
  // `.then()` chain that reconciliation lives in never runs at all, and
  // `sending` never gets re-armed regardless of the /active fix. A brand
  // new conversation genuinely has no messages yet, so an empty list here
  // is not a simplification of the real response shape, it's the real one.
  await page.route(`**/api/conversations/${conversationId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: [] }) });
  });

  await page.route(`**/api/agent/runs/active`, async (route) => {
    const inFlight = stillInFlight();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: inFlight
          ? [
              {
                id: runId,
                conversationId,
                userMessage: "test",
                responseText: "",
                provider: "gemini",
                status: "streaming",
                error: null,
                sources: [],
                startedAt,
                completedAt: null,
                seenAt: null,
              },
            ]
          : [],
      }),
    });
  });

  await page.route(`**/api/agent/runs/${runId}`, async (route) => {
    const inFlight = stillInFlight();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run: {
          id: runId,
          conversationId,
          userMessage: "test",
          responseText: inFlight ? "" : replyText,
          provider: "gemini",
          status: inFlight ? "streaming" : "completed",
          error: null,
          sources: [],
          startedAt,
          completedAt: inFlight ? null : completedAt,
          seenAt: null,
        },
      }),
    });
  });
}

// Every spec starts from a genuinely fresh guest (AuthContext's real
// auto-guestLogin on first visit — see lib/AuthContext.tsx), not a shared
// or mocked identity: clearing storage first is what makes the guest
// created for THIS test's run new, so screens gated on hasSeenWelcome
// (Welcome/mic-permission/first-run) actually show rather than being
// skipped because a previous test's guest already "saw" them.
export async function freshVisit(page: Page, path = "/"): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(path);
}

// Drives a real signup (real API calls, a real new guest-upgrade account
// each time — the random email guarantees no collision across parallel/
// repeated runs) through to the real /mic-permission screen, for specs
// that need a screen only reachable after account creation. Returns the
// real email used, so a caller that needs to act on this exact account
// afterward (see completeAdminSignup below) doesn't have to guess it.
export async function completeSignup(page: Page): Promise<string> {
  await freshVisit(page, "/signup");
  await page.locator('input[placeholder="Your name"]').fill("Syam");
  await page.locator('button[type="submit"]').click();
  const email = `visual-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  await page.locator('input[type="email"]').fill(email);
  await page.locator('button[type="submit"]').click();
  await page.locator('input[type="password"]').fill("Str0ngPassword!123");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/mic-permission", { timeout: 8000 });
  return email;
}

// Admin screens (Sessions/Run view/Approval/Providers) have no consumer
// signup path to admin — by design, per JENNYSOL-UI-SPEC.md §5, there is no
// in-app way to grant the first admin either (see promote-admin.ts's own
// comment: "there's no in-app way to grant the first admin ... this exists
// to break that chicken-and-egg problem from the command line"). Reuses
// that exact same real script against this suite's own real, local,
// isolated test-server database (server/data/jennysol.db — the same file
// `npm run dev` uses locally, never the separate production Railway volume)
// rather than inventing a second, parallel way to mint an admin. The
// server checks role fresh from the DB on every single request
// (middleware/auth.ts's requireAdmin), never a value cached in the session
// token, so the already-logged-in browser session from completeSignup sees
// the promotion take effect on its very next API call — no re-login needed.
export async function completeAdminSignup(page: Page): Promise<void> {
  const email = await completeSignup(page);
  execFileSync("npx", ["tsx", "scripts/promote-admin.ts", email], {
    cwd: join(__dirname, "../../../server"),
    stdio: "pipe",
  });
  // RequireAuth.tsx redirects anywhere it guards (/admin/* included) back to
  // /start while user.hasSeenWelcome is false — completeSignup alone only
  // reaches /mic-permission, one screen short of that becoming true.
  // dismissWelcome() is real app state, only ever set from FirstRun.tsx's
  // own suggestion-tap handler (see AuthContext.tsx) — going through it for
  // real, same as chat.spec.ts's enterChat(), rather than reaching into
  // AuthContext from the test to fake the flag directly.
  await mockChatReply(page);
  await page.getByText("Not now").click();
  await page.waitForURL("**/first-run", { timeout: 8000 });
  await page.getByText("What do I have tomorrow?").click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 8000 });
}
