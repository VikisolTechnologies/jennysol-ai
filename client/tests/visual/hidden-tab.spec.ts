import { test, expect } from "@playwright/test";
import { freshVisit } from "./fixtures";

// JENNYSOL-UI-BUILD.md §3 rule 4 / definition-of-done item 8's other half —
// reduced-motion.spec.ts already covers "pause under prefers-reduced-motion"
// (usePrefersReducedMotion, a media query); this covers Orb.tsx's sibling
// mechanism, usePageVisible() (the real Page Visibility API, a
// document.visibilitychange listener — see Orb.tsx's own comment: "a real
// battery cost on phones"). Both gate the same `animate` boolean but react
// to independent real browser signals, so one passing doesn't prove the
// other. Reuses the exact same real, persistently-animating orb
// reduced-motion.spec.ts already relies on — Welcome.tsx's `<Orb
// state="speaking" size="xl" />` — rather than chasing a state (like
// ChatWindow's brief mid-send "thinking" orb, which only exists for the
// ~420ms hero-collapse window before it unmounts entirely — see
// ChatWindow.tsx's own heroPhase effect) whose window is real but far
// narrower and racier than the thing actually under test here.
//
// Playwright has no emulateMedia-style helper for tab visibility, so this
// drives the real underlying platform primitive directly: overriding
// document.visibilityState and dispatching a real "visibilitychange" event
// is the standard, documented way to exercise Page-Visibility-API code
// under test — usePageVisible() only ever reads that property and listens
// for that exact event, so this exercises the real code path, not a
// simulation of one.
async function setTabHidden(page: import("@playwright/test").Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { value: h ? "hidden" : "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("welcome orb animation pauses on a hidden tab and resumes when visible again", async ({ page }) => {
  await freshVisit(page);
  await page.waitForURL("**/start", { timeout: 8000 });
  await page.waitForTimeout(400); // real ripple/twinkle settle, same as welcome.spec.ts

  const animated = page.locator('[class*="motion-safe:animate-"]');
  await expect(animated).not.toHaveCount(0);

  await setTabHidden(page, true);
  await expect(animated).toHaveCount(0);

  await setTabHidden(page, false);
  await expect(animated).not.toHaveCount(0);
});
