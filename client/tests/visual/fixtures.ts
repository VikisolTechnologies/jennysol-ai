import type { Page } from "@playwright/test";

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
export async function mockChatReply(page: Page, replyText = "This is a stubbed reply for visual testing."): Promise<void> {
  const runId = `test-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  await page.route("**/api/chat", async (route) => {
    const body = [
      `data: ${JSON.stringify({ type: "run.started", runId, conversationId: `test-conv-${Date.now()}`, requestId: `test-req-${Date.now()}` })}\n\n`,
      `data: ${JSON.stringify({ type: "agent.status", status: "streaming" })}\n\n`,
      `data: ${JSON.stringify({ type: "message.delta", delta: replyText })}\n\n`,
      `data: ${JSON.stringify({ type: "done", sources: [] })}\n\n`,
    ].join("");
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });

  await page.route(`**/api/agent/runs/${runId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run: {
          id: runId,
          conversationId: `test-conv-${Date.now()}`,
          userMessage: "test",
          responseText: replyText,
          provider: "gemini",
          status: "completed",
          error: null,
          sources: [],
          startedAt,
          completedAt,
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
// that need a screen only reachable after account creation.
export async function completeSignup(page: Page): Promise<void> {
  await freshVisit(page, "/signup");
  await page.locator('input[placeholder="Your name"]').fill("Syam");
  await page.locator('button[type="submit"]').click();
  await page
    .locator('input[type="email"]')
    .fill(`visual-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await page.locator('button[type="submit"]').click();
  await page.locator('input[type="password"]').fill("Str0ngPassword!123");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/mic-permission", { timeout: 8000 });
}
