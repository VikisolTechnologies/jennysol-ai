import { test, expect } from "@playwright/test";
import { completeAdminSignup } from "./fixtures";

// Admin screens (Sessions/Run view/Approval/Providers) were explicitly left
// out of the original visual-regression pass — see JENNYSOL-UI-SPEC.md §6,
// "they need a real, seeded admin account as a test fixture, which this
// pass didn't build." completeAdminSignup() (fixtures.ts) closes that gap
// using the same real promote-admin.ts script this project already uses to
// bootstrap its very first admin, rather than inventing a second way in.
// Real data throughout: this suite's own local dev DB already has real
// agent_sessions/agent_tasks rows from earlier in this engagement, so these
// screens render their actual current content, not a fabricated fixture.

// Every one of these four pages uses the exact same real "Loading…" text
// while its own fetch is in flight (AgentSessions.tsx, AgentApprovals.tsx,
// AgentSessionDetail.tsx, Providers.tsx all share this convention) — waiting
// for it to disappear is the real signal that the real data actually
// arrived, not a fixed-timeout guess. Found live and worth fixing for real:
// a fixed wait here failed intermittently (~1 in 10 runs) once this file
// started running its own real promote-admin.ts subprocesses alongside
// other specs' real signups — genuine, if occasional, extra load on the
// same shared server settings.spec.ts's fetch was also racing (see that
// file's own fix for the identical class of bug).
async function waitForRealDataLoaded(page: import("@playwright/test").Page) {
  await page.getByText("Loading…").waitFor({ state: "hidden", timeout: 8000 });
}

test("admin — sessions list", async ({ page }) => {
  await completeAdminSignup(page);
  await page.goto("/admin/agent-sessions");
  await page.waitForSelector("text=What Jenny did");
  await waitForRealDataLoaded(page);
  // Real, live, shared data (this page's own promise: "nothing shown is
  // invented") — the DB backing this list is the same one every other spec
  // in this suite runs against, so its rows can genuinely shift between
  // baseline-recording and verification if anything else touches
  // agent_sessions concurrently. Same reasoning, same tolerance, as
  // admin-session-detail.png and admin-providers.png just below.
  await expect(page).toHaveScreenshot("admin-sessions.png", { maxDiffPixelRatio: 0.01 });
});

test("admin — session run view", async ({ page }) => {
  await completeAdminSignup(page);
  await page.goto("/admin/agent-sessions");
  await page.waitForSelector("text=What Jenny did");
  // Real navigation through the real list — whatever the oldest/first real
  // session actually is, not a hardcoded id that could go stale.
  const firstSession = page.locator('a[href^="/admin/agent-sessions/"]').first();
  await firstSession.waitFor({ state: "visible", timeout: 8000 });
  await firstSession.click();
  await page.waitForURL(/\/admin\/agent-sessions\/.+/, { timeout: 8000 });
  await waitForRealDataLoaded(page);
  await expect(page).toHaveScreenshot("admin-session-detail.png", { maxDiffPixelRatio: 0.01 });
});

test("admin — approvals", async ({ page }) => {
  await completeAdminSignup(page);
  await page.goto("/admin/agent-approvals");
  await waitForRealDataLoaded(page);
  await expect(page).toHaveScreenshot("admin-approvals.png");
});

test("admin — providers", async ({ page }) => {
  await completeAdminSignup(page);
  await page.goto("/admin/providers");
  await waitForRealDataLoaded(page);
  await expect(page).toHaveScreenshot("admin-providers.png", { maxDiffPixelRatio: 0.01 });
});
