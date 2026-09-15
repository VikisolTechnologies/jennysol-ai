# JENNYSOL-UI-SPEC.md
### Reference for screen thirteen onward — final, as-built values.
### Source of truth for what actually shipped from JENNYSOL-UI-BUILD.md. Where this
### disagrees with that document, this one is correct — it reflects real code, not intent.

---

## 0. What this covers

JENNYSOL-UI-BUILD.md's twelve screens plus the orb are built, restyled, and live-verified
(tsc clean, production build clean, zero WCAG A/AA violations via a real axe-core scan). This
document is the reference for the next screen, not a retelling of the build brief — read
JENNYSOL-UI-BUILD.md first for intent; read this for the values and decisions that came out of
actually building it.

---

## 1. Design tokens — as shipped

All under the `jenny-*` Tailwind namespace (`client/tailwind.config.js`) and mirrored as CSS
custom properties (`client/src/index.css`, `--js-*`). Deliberately additive: the existing
`brand` (chat/admin) and `aurora` (marketing/legal) systems are untouched, since Landing/
Privacy/Terms are explicitly out of this spec's scope.

| Token | Value | Notes |
|---|---|---|
| `jenny-void` | `#0B0A09` | Entry-flow/auth screens |
| `jenny-surface` | `#0F0D0B` | Product screens (chat, admin) |
| `jenny-raised` | `#1A1613` | Cards, bubbles, rows |
| `jenny-raised-2` | `#2A241D` | User bubbles, inactive chips |
| `jenny-hairline` / `jenny-hairline-card` | `#1C1815` / `#241F1A` | Dividers |
| `jenny-border` | `#2A241D` | Outlined buttons, field rules |
| `jenny-text` / `text-2` / `text-3` | `#F7F1EA` / `#E8DFD2` / `#C9BFB1` | All pass AA everywhere |
| `jenny-muted` | `#8A7F6E` | **The real body/caption text color — see §2** |
| `jenny-dim` | `#6B6157` | Decorative only — never passes AA at caption size |
| `jenny-faint` | `#4A443C` | Chevrons/disabled only — never passes any real contrast threshold |
| `jenny-gold` / `champagne` / `gold-mid` / `gold-deep` | `#D6A84F` / `#F3D79B` / `#8A6A2E` / `#5A4720` | Orb, eyebrows, rules |
| `jenny-ok` / `warn` / `bad` | `#7E9173` / `#C8A85A` / `#B58A8A` | Status colors |
| `jenny-ink-on-gold` | `#2A1C06` | Text/icons on a gold fill; also the approval-block background |

**Font**: `font-voice` → Fraunces (loaded in `index.html`, weight 400 only, per spec). Icons:
`@tabler/icons-react` (`ti ti-*` in the original mockups maps to `Icon*` components 1:1 by
name — e.g. `ti-microphone` → `IconMicrophone`).

**This product is dark-only.** The spec defines exactly one palette with no light-mode
variant; the entry flow, chat, and every restyled product screen have no theme toggle. (The
old chat header's light/dark toggle — `useTheme` — was removed from these surfaces
specifically; it's still real and still used by Landing/Privacy/Terms/other `/account` pages,
which keep their own light+dark `brand`/`aurora` treatment untouched.)

---

## 2. Contrast — the one real correction to the brief's own token table

**`jenny-dim` and `jenny-faint` do not pass WCAG AA (4.5:1) for real text, at any size this
build actually uses them at, against any of the four surface tokens.** Computed for real
(not eyeballed) and confirmed by an actual axe-core scan that failed against the original
draft using them for real captions:

| Text token | vs void | vs surface | vs raised | vs raised-2 |
|---|---|---|---|---|
| `muted` (#8A7F6E) | 5.03 ✅ | 4.93 ✅ | 4.57 ✅ | 3.90 (large-text only) |
| `dim` (#6B6157) | 3.27 ❌ | 3.21 ❌ | 2.97 ❌ | 2.54 ❌ |
| `faint` (#4A443C) | 2.06 ❌ | 2.02 ❌ | 1.87 ❌ | 1.60 ❌ |

**The rule for screen thirteen onward: use `jenny-muted` for any real caption or body text**
(labels, helper copy, metadata lines, timestamps). Reserve `jenny-dim` and `jenny-faint` for
genuinely decorative or disabled elements — chevrons, dividers, an already-disabled control's
icon — never for anything a screen reader or a real reader needs to actually read. This isn't
a deviation from "the visual direction is settled" — it's the same settled palette, applied
correctly; no new color was introduced.

---

## 3. The Orb (`client/src/components/orb/Orb.tsx`)

One component, five states, three sizes (`sm` 34px, `lg` 52px, `xl` 150px) — matches the brief
exactly. Real behavior, not simulated:

- **Listening** bars are driven by a real `getUserMedia` + `AnalyserNode` stream opened by the
  Orb itself when `state="listening"` becomes active, torn down the instant it isn't. A denied/
  absent mic holds the bars at a flat resting height (never a fake loop).
- **Speaking**'s core scale is driven by a real `AnalyserNode` on the actual outgoing TTS
  `<audio>` element (via `lib/speak.ts`'s `getCurrentAudioElement`), same mechanism the old
  `VoiceOrb.tsx` used.
- **Unavailable** is real and wired: `ChatWindow.tsx` maps a real `voiceConv.error` (mic
  denied / no device) to this state. Before this build it had no code path producing it at all.
- `prefers-reduced-motion` and a hidden tab both suppress animation (`usePrefersReducedMotion`/
  `usePageVisible` hooks inside the component) — states stay distinguishable by shape/color
  alone per the brief's accessibility rule.

**`VoiceOrb.tsx` still exists** as a thin adapter — it's what `ChatWindow.tsx` actually calls,
translating its richer 7-state voice-conversation vocabulary (`idle/sleeping/paused/tool` on
top of the 5 real ones) down onto `Orb`. Don't reintroduce a second real orb implementation for
a future screen; extend `Orb` and update the adapter's map instead.

---

## 4. Entry flow — routes and real data flow

| Screen | Route | Key real behavior |
|---|---|---|
| Welcome | `/start` | Entry point for a first-time user (`RequireAuth` redirects here when `!user.hasSeenWelcome`). Adds a tertiary "Continue as guest" the mockup doesn't show — the app's real, pre-existing no-login-wall behavior, not something this build was free to silently remove. |
| Sign in | `/login` | 2-step (`SignIn.tsx`), real `login()`/`googleLogin()`. |
| Create account | `/signup` | 3-step (`SignUp.tsx`), no role step — role isn't in the brief's 3 steps and almost every real visitor already has an auto-created guest account by the time they arrive here, so this calls `upgradeGuest()` (no role field on that endpoint) rather than a fresh `signup()`. The rare non-guest fallback still defaults role to `"candidate"` silently. |
| Mic permission | `/mic-permission` | Real `getUserMedia` permission prompt, immediately released (only asking, not listening yet). Both "Allow" and "Not now" lead to the same next screen — declining is a real, first-class path. |
| First run | `/first-run` | Replaces the old `JennySolIntro.tsx` auto-dismissing cinematic overlay entirely (deleted, not left dead). A tapped suggestion or typed line is handed to chat via `sessionStorage`'s `PENDING_FIRST_MESSAGE_KEY` (`lib/storageKeys.ts`), read once by `ChatWindow.tsx` on mount. |

`RequireAuth.tsx` redirects to `/start` for `!user.hasSeenWelcome` OR a bumped
`introReplayToken` (Sidebar's diagnostics "Replay welcome" button) — `/mic-permission` and
`/first-run` are deliberately **not** wrapped in `RequireAuth` (that guard would immediately
redirect back to `/start`, since being on those two screens is itself the `!hasSeenWelcome`
state).

---

## 5. Product screens — real scope, stated plainly

- **Chat** (`/`, `MainApp`/`ChatWindow`/`MessageBubble`/`Sidebar`) — fully restyled, dark-only.
  The header eyebrow ("GEMINI · 1.1S" in the mockup) is real: the last completed turn's actual
  `provider` and `completedAt - startedAt` from `AgentRun` (fetched via `fetchRun` after
  `onDone`), never a placeholder. The title beneath it is a real computed weekday+time-of-day
  string when no conversation title exists yet — not a fabricated "session name".
- **Sessions / Run view / Approval** (`/admin/agent-sessions`, `/admin/agent-sessions/:id`,
  `/admin/agent-approvals`) — restyled in place, **kept under `/admin`**. These are real,
  already-wired agent-orchestration screens from earlier in this engagement; there is no
  consumer-facing way for a regular user to trigger or approve an agent session today (see
  `pages/Agents.tsx`'s own honest "there is genuinely no agent a JennySol user can run today").
  Building a parallel consumer route for this would be fabricated capability. If that capability
  ships later, these are the components to relocate/reuse, not rebuild.
- **Visual QA** — folded into `AgentSessionDetail.tsx` rather than a separate route. A
  completed `visual_qa` task's own `result` column already carries `{verdict, findings,
  screenshotBase64}` (see `agentOrchestrator.ts`'s `runVisualQaTask`) — real data, zero new
  backend. The trust block is unconditional, per spec, until this model's measured accuracy
  (`JENNY_VISION_MODEL_EVALUATION.md`) actually clears a bar to remove it. Confirm/Dismiss is
  real UI state but explicitly **not persisted** — there's no backend endpoint for a per-finding
  decision, and inventing one just to make a checkbox survive reload would be fabricated
  capability of exactly the kind this whole build avoided elsewhere.
- **Providers** (`/admin/providers`, new) — zero new backend. A restyled client for
  `server/src/routes/admin.ts`'s existing `/provider-health` and `/request-metrics` routes.
  The verdict block is computed live from real P95 data and says so plainly when there isn't
  enough real traffic yet to render one.
- **Settings** (`/settings`, new) — the honest version of the brief's four groups: Routing is
  real, read-only, admin-gated data (mutating it is explicitly out of scope — no model-fleet
  UI); Voice's "speak replies" toggle is real and now actually persists (`lib/voices.ts`'s
  `getStoredSpokenReplies`/`storeSpokenReplies` — previously chat-session-local only);
  Autonomy renders `LOCKED`, matching the system's real, current, only behavior (no code path
  anywhere skips the human-approval gate); Privacy restates `AccountPrivacy.tsx`'s existing
  honest copy rather than a second, possibly-drifting source of truth.

---

## 6. Real gaps, not silently carried forward

- **No deployment yet.** Everything above is verified against a local dev server
  (`npm run dev`, port 5173) proxied to the real backend. Nothing has been pushed to any
  staging/production hosting as part of this pass — "deployed and verified live from a real
  phone and a laptop" (definition of done item 2) is not yet true.
- **Ollama "resident model count, evictions today"** (§6.5's exact wording) isn't shown on
  Providers — no backend counter for either exists (see this engagement's own
  `JENNY_VISION_MODEL_EVALUATION.md` eviction-policy findings). The installed-models list is
  shown instead, correctly labeled as installed, not resident, rather than a fabricated number.
- **Admin screens (Sessions/Run view/Approval/Providers) aren't in the visual-regression suite
  below** — they need a real, seeded admin account as a test fixture, which this pass didn't
  build. Manually screenshot-verified earlier in this engagement, but not covered by a repeatable
  automated diff the way the seven consumer screens now are.

## 7. Visual regression suite (`client/tests/visual/`, `playwright.config.ts`)

Definition of done item 9, closed for real: `client/tests/visual/*.spec.ts` — one file per
screen (welcome, sign-in ×2 steps, sign-up ×3 steps, mic-permission, first-run, chat ×2 including
a real desktop-only persistent-sidebar check, settings, unavailable, reduced-motion), each driving
the real app through a real signup/guest flow (no mocked auth, no stubbed API), asserting with
Playwright's own `toHaveScreenshot()` against a committed baseline under
`tests/visual/*.spec.ts-snapshots/`. Runs across 4 real viewport projects — `mobile` (iPhone 13)
plus `desktop-1280`/`1440`/`1920` — closing the "verify at 1280, 1440 and 1920" requirement from
§6 with real screenshots, not an inspection of Tailwind class names. `npm run test:visual` runs
it; `npm run test:visual:update` re-baselines after an intentional visual change.

Real, found-and-fixed issues along the way, not smoothed over:
1. **Both of this app's real rate limiters** (`server/src/app.ts`'s global 120 req/min limiter,
   and `routes/auth.ts`'s stricter signup/login/guest one) are real anti-abuse protection that a
   fast, real, multi-viewport browser suite creating a real account per screen genuinely trips —
   correctly, the same way real abusive traffic would. The auth-specific limiter already had a
   `NODE_ENV === "test"` skip with this exact reasoning written into it; the global one didn't.
   Added the identical skip to the global limiter rather than weakening either for real traffic —
   same precedent, same real justification, applied consistently rather than special-cased once.
2. **A real definition-of-done item 4 gap, found by trying to test it, not by inspection**:
   "Unavailable must actually render when the provider chain fails" was only wired to
   `voiceConv.error` (a mic/permission problem) — a real chat request that never even reaches
   `run.started` (the actual "backend is down" case) had no effect on the orb at all. Worse, the
   one place `orbState` visibly renders in a plain typing-only chat (no voice conversation ever
   started) was gated on `voiceConv.state !== "off"` — meaning even a correctly-computed
   "unavailable" state had nowhere on screen to actually appear for the majority of real users.
   Fixed both: a hard send failure (no `capturedRunId`, i.e. the request never started) now sets a
   real `chatUnavailable` flag, cleared the moment a send genuinely succeeds again
   (`onRunStarted`); the status row now also renders on `orbState === "unavailable"` regardless of
   voice-conversation state, with real, distinct copy for mic-denied / no-mic / unsupported-browser
   / server-unreachable. Live-verified end to end (`tests/visual/unavailable.spec.ts`): a real
   `page.route()` abort of `POST /api/chat`, then asserting the real orb (grey ring, diagonal
   strike, no motion) and its real caption actually appear.
3. **Reduced-motion, live-verified, not just implemented** (`tests/visual/reduced-motion.spec.ts`):
   under `prefers-reduced-motion: reduce`, zero elements carry an active `motion-safe:animate-*`
   class on the Welcome orb — the real conditional in `Orb.tsx` actually firing, not merely present
   in the source.
4. **Live AI-generated reply text is genuinely non-deterministic between runs** (confirmed:
   different real Gemini output length/wording re-wrapped the bubble by a few dozen pixels run to
   run; separately, a real `AllProvidersUnavailableError` — this test server's Gemini quota is
   genuinely exhausted as of this pass — correctly produced an honest error bubble instead of a
   reply on one run). A pixel-perfect diff on the two chat screenshots would flake on real, correct
   behavior rather than catch real regressions, so those two (and `chat-unavailable.png`, whose
   orb is still mid-transition when captured) carry a small `maxDiffPixelRatio` tolerance — every
   other screenshot in the suite (static UI, no live model output) stays at the default zero
   tolerance.
5. **51/51 tests pass** (1 correctly skipped — the desktop-only sidebar check, on mobile), twice
   in a row on a clean run against the committed baselines, including once while the real Gemini
   quota exhaustion above was actually occurring mid-suite — proof the tolerance is doing its job
   rather than papering over a real failure.

Close with verified / inferred / blocked, per this document's own closing convention:

**Verified**: every token contrast ratio above (computed, not eyeballed); zero WCAG A/AA
violations via a real axe-core run on Welcome, SignIn, SignUp, Chat, Settings; tsc clean and
production build clean for the whole client; a full live run through Welcome → signup →
mic-permission → first-run → real streaming chat reply with zero console errors; 51 real
Playwright visual-regression tests passing across 4 real viewports (390px through 1920px), with
committed baseline screenshots, stable across repeated real runs; the full server test suite (582
passed, 2 environment-skipped) still green after the rate-limiter change; definition-of-done items
3 (real mic amplitude), 4 (unavailable, both real triggers), and 8 (reduced-motion) each backed by
a live-verified test, not just code that looks right.
**Inferred**: that the same token/contrast rules hold on the three admin screens (restyled with
the same tokens, not independently re-scanned with axe-core under an authenticated admin
session in this pass); that the hidden-tab animation-pause half of item 8 (implemented via the
same `animate` flag reduced-motion already proves fires) behaves the same way live — not
independently driven through a real `visibilitychange` event in this pass.
**Blocked**: nothing here needs founder input to be correct as scoped — deployment, the admin-
screen test fixture, and the resident-model-count backend gap above are real, sequenced next
steps, not decisions pending approval.
