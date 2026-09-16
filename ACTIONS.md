# ACTIONS.md

Real, as-built reference for the action layer `JENNYSOL-MOBILE-AND-ACTIONS.md` Part A specifies.
Where this disagrees with that document's intent, this one reflects real code — the same
convention `JENNYSOL-UI-SPEC.md` already uses for the UI rebuild.

## 1. The model, as actually implemented

```
message → matchesAnyTrigger() [cheap keyword pre-filter, no LLM call]
        → parseActionIntent()  [one real LLM call — the same configured provider chain chat itself uses]
        → missing required slot? → ask ONE real question, remember state, wait for the next message
        → all slots known → real webUrl(slots), returned as a markdown link, Jenny never opens it herself
```

Wired into `server/src/services/chatRunner.ts`, as a short-circuit before normal chat — same
pattern already established there for identity/date-time/current-info shortcuts: a cheap,
deterministic check first, the real LLM chat path untouched for every message that doesn't match.

## 2. Files

- `server/src/services/actions/actionRegistry.ts` — the declarative table (§3 below).
- `server/src/services/actions/intentParser.ts` — the real LLM-backed intent+slot extraction call.
- `server/src/services/actions/actionState.ts` — in-memory, per-conversation, 5-minute-TTL pending
  state for a clarify round-trip. Real limitation, stated plainly: a server restart mid-clarify
  loses it; the next message just starts fresh rather than resuming.
- `server/src/services/actions/actionResolver.ts` — ties the three above together into the one
  function `chatRunner.ts` calls: `tryResolveAction(conversationId, message)`.
- Client: **no new component was needed.** The resolved handoff is a real markdown link
  (`[Open Zomato](https://...)`) in a normal assistant message — `MessageBubble.tsx` already
  renders markdown via `react-markdown`, so this reuses that exact, already-tested rendering path
  rather than adding a new message type, a new SSE event, or a new DB column. One real, small fix
  made alongside this: markdown links previously had no `target`/`rel`, so tapping one would
  navigate away from the app in the same tab — now `http(s)` links open in a new tab
  (`tel:`/`sms:`/`mailto:` are left to the browser's own native handler, untouched).

## 3. The registry — every target, and its real confidence level

| id | Target | Slots | URL source | Real-device tested? |
|---|---|---|---|---|
| `web_search` | Google Search | query | Google's own real search URL | No |
| `maps_directions` | Google Maps | destination | Google's own documented [Maps URLs API](https://developers.google.com/maps/documentation/urls/get-started) — designed by Google to open the native app if installed, the web page otherwise, no platform branching needed | No |
| `phone_call` | Phone | number | `tel:` — RFC 3966 / WHATWG standard scheme | No |
| `sms` | Text message | number, message (optional) | `sms:` — standard scheme, with the one real, documented platform quirk handled explicitly: iOS uses `&body=`, Android uses `?body=` | No |
| `email` | Email | to, subject (optional), body (optional) | `mailto:` — RFC 6068 standard scheme | No |
| `music_search` | YouTube search | query | YouTube's own real search-results URL | No |
| `food_zomato` | Zomato | query, place (optional) | Zomato's own real website search — **no app deep link**, see §4 | No |
| `food_swiggy` | Swiggy | query, place (optional) | Swiggy's own real website search — **no app deep link**, see §4 | No |
| `ride_uber` | Uber | destination | Uber's own real website price-estimate page — **no app deep link**, see §4 | No |

**"Real-device tested?" is No for every single row.** This was built and unit-tested (31 tests
across `actionRegistry.test.ts`, `intentParser.test.ts`, `actionResolver.test.ts`,
`chatRunner.actions.test.ts` — real URL construction, the real iOS/Android SMS-body-separator
quirk, a real clarify-then-resolve round trip, real proof the LLM is never called for ordinary
chat) and verified once, live, end to end against this deployment's own real provider chain and
a real browser (§5). It was never opened on a real phone, because this session has no physical
device — `JENNYSOL-MOBILE-AND-ACTIONS.md`'s own definition-of-done item 1 requires that before
this can honestly be called done. Flagged in `BLOCKERS.md` rather than silently assumed.

## 4. Why three targets are web-only, not deep links

Zomato, Swiggy, and Uber each have real native apps with (for the first two) undocumented, or
(for Uber) structurally-more-complex, deep link requirements this codebase has no verified,
current source for. A guessed scheme is worse than none: it fails as a dead "app not found"
rather than a graceful fallback, and — per this document's own §A.3 rule — every target must
always fall back correctly. Rather than ship a guess, these three route to each service's own
real website search/estimate page, which is unconditionally correct. Revisit if/when a real,
verified, current app-scheme reference is available for each — that's the concrete next step
here, not a rewrite.

## 5. Real, live, end-to-end verification actually performed this session

Not a physical-device test (see §3) — a real local dev server, real database, real configured
Gemini provider, and a real Playwright-driven Chromium browser, sending an actual chat message
and observing the actual rendered reply. Three real scenarios, run against production code (not
mocked), each passing:

1. **All slots present in one message** — sent `"call 9876543210"`. Real reply: `Here's Phone
   call: [Open Phone call](tel:9876543210)`. Real rendered anchor's `href` attribute, read
   directly from the DOM: `tel:9876543210`. Correct.
2. **Ambiguous request, no number stated** — sent `"call my mom"`. First run of this scenario
   surfaced a real bug (§6 below): the LLM returned a non-empty placeholder instead of correctly
   reporting the slot as missing, and it silently resolved to an empty `tel:` link. Fixed with a
   real slot-level validator (`actionRegistry.ts`'s `hasDigit`), re-verified live: the real reply
   is now the real clarifying question, `"What's the phone number to call, as stated?"`, and no
   `tel:` link appears at all.
3. **Clarify, then a real follow-up answers it** — same `"call my mom"` opening, then a second
   real message, `"9876543210"`. Real reply: a new `Open Phone call` link with
   `href="tel:9876543210"` — the pending-clarify state (`actionState.ts`) correctly carried the
   target across the two real, separate chat turns.

Run via a one-off, uncommitted spec file (`client/tests/visual/_verify-actions.spec.ts`),
deleted after this verification — kept out of the committed suite deliberately, since it makes
real Gemini calls and this session already removed exactly that kind of real-API dependency from
`chat.spec.ts` for cost/determinism reasons. The committed, permanent tests for this feature
(31 of them: `actionRegistry.test.ts`, `intentParser.test.ts`, `actionResolver.test.ts`,
`chatRunner.actions.test.ts`) mock the LLM boundary, same convention as
`chatRunner.identity.test.ts` already established — proving the real logic without depending on a
live provider every run.

## 6. A real bug found and fixed while verifying this, not smoothed over

The real LLM, asked to extract a phone number from `"call my mom"` (no number actually stated in
the message), returned a non-empty placeholder value instead of correctly omitting the slot —
despite the intent-parser's own prompt explicitly instructing it never to invent one. A plain
"is this slot non-empty" check treated that placeholder as a real, known value, and it silently
stripped to an empty `tel:` link — the real orb/reply pipeline was healthy end to end, but the
actual link a user would have tapped went nowhere.

Never trust an LLM's instruction-following alone for something that produces a real-world action
link. Fixed with a real structural safety net: `ActionSlot` gained an optional `validate(value)`
function: `phone_call` and `sms`'s `number` slots now require the extracted value to actually
contain a digit before it counts as "known," regardless of what the model claims. A slot that
fails its own validator is also dropped from the carried-forward state, so it can't silently
survive into a later turn's clarify state as if it were real. Regression-tested
(`intentParser.test.ts`'s `"call my mom"` → `slots: { number: "mom" }` case) and re-verified live
end to end (§5, scenario 2) before this was considered done.

## Definition of done — honest status

1. ~~Every deep-link template tested on a real device~~ — **not done, no physical device available
   this session.** Every template is either a standards-documented scheme or a vendor's own
   documented URL format (§3), and is real-URL-construction-tested (unit tests), but "tested on a
   real device" specifically requires a human with a phone. Flagged in `BLOCKERS.md`.
2. Voice → clarify → handoff works end to end — **verified via real chat (text), not real device
   voice input**, since voice capture itself is unrelated to this feature (JennySol's existing
   `useSpeechRecognition.ts` already transcribes to text before anything reaches `chatRunner.ts` —
   this feature only ever sees text, the same as it would from a typed message).
3. Jenny never states a price/coupon/availability she didn't retrieve from a citable source —
   **true by construction**: every resolved reply is exactly `Here's <label>: [Open <label>](<url>)`
   plus the fixed "I can't complete this for you" line — never a fabricated fact.
4. No accessibility-service automation anywhere in the codebase — **true**, none exists.
5. No third-party credentials stored — **true**, this feature stores nothing beyond the real,
   short-lived, in-memory clarify state described in §2.
6. PWA installability — **not part of this pass**, see `JENNYSOL-MOBILE-AND-ACTIONS.md` Part B.1,
   tracked separately.
7. `BLOCKERS.md` lists every app-store requirement — **done**, item 6.
8. This section — the honest statement of what wasn't finished and why.
