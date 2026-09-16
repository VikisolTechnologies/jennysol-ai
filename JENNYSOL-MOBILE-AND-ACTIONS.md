# JENNYSOL-MOBILE-AND-ACTIONS.md
### Mobile apps and real-world actions. Read `VIKISOL-BUILD-DOCTRINE.md` first.
### This runs AFTER the twelve-screen UI rebuild and after providers are working.

---

## 0. What the founder asked for, and what is actually buildable

The ask: Jenny should operate the apps on a phone. Say "find biryani at Viceroy
on Zomato" and she asks what kind, reports prices and coupons, and places the
order.

Three parts of that are not buildable, and one is. Be straight with the founder
about which is which — do not build a demo that fakes the rest.

**Not buildable — iOS app control.** iOS provides no API for one app to drive
another. The only sanctioned mechanisms are URL schemes, Universal Links, and
App Intents / Shortcuts — and App Intents only work if the target app publishes
them. Do not plan around controlling Zomato on iOS.

**Buildable but commercially fatal — Android accessibility automation.**
`AccessibilityService` can read the screen and inject taps. Google Play
restricts that API to genuine accessibility use; automation apps get removed.
It also breaks on every target-app UI change. **Do not use it.** If the founder
insists, state this consequence in writing first.

**Not buildable — reading Zomato's catalogue.** There is no public consumer
ordering API. Scraping a logged-in session violates their terms, breaks
constantly, and would mean handling the user's Zomato credentials. Do not do it.
Therefore Jenny cannot report real dish prices or live coupons.

**Buildable, and genuinely valuable — intent capture plus handoff.** Jenny takes
the spoken request, asks the clarifying question, resolves the location, and
deep-links the user straight into the target app with the search pre-filled.
The user completes the order themselves.

This removes the tedious part — deciding, specifying, typing — and leaves the
part that must stay human: spending money.

---

## PART A — The action layer

### A.1 The model

```
VOICE → INTENT + SLOTS → CLARIFY → RESOLVE → HANDOFF → USER COMPLETES
```

Jenny never completes a transaction. Not in v1, not behind a setting.

### A.2 Intent capture

Parse an utterance into an intent and slots, then ask **one** question at a
time for what is missing.

"Find biryani at Viceroy on Zomato" →
`intent: food_order`, `dish: biryani`, `place: Viceroy`, `app: zomato`,
missing: variant, quantity.

Jenny asks what she genuinely needs and nothing more. Two questions maximum
before handoff. A clarifying interrogation is worse than typing it yourself.

### A.3 Handoff — the registry

Build an **action registry**: a declarative table of targets, each with the
platforms it supports, its deep-link template, its web fallback, and the slots
it needs. Adding a new app must be a registry entry, not new code.

Start with a handful that have documented, stable link formats: food delivery,
ride hailing, maps and navigation, calendar, phone and messaging, music, and
web search. Verify every template actually opens correctly on a real device
before shipping it — do not ship a link you have not personally opened.

**Rules:**
- Always fall back to the web URL when the app isn't installed. Never a dead end.
- Show the user what will open, before it opens.
- Never store credentials for a third-party service.
- Never claim a price, an availability, or a coupon Jenny did not retrieve from
  a source she can cite. If she doesn't know, she says so and hands off.

### A.4 Platform mechanisms

- **Android:** deep links and `Intent` with `ACTION_VIEW` / `ACTION_SEND`.
  Sanctioned and stable.
- **iOS:** URL schemes and Universal Links. Additionally, publish JennySol's own
  **App Intents** so users can invoke Jenny from Siri and Shortcuts — that is
  the legitimate iOS automation surface, and it works in the direction that is
  actually permitted.
- **Web:** target the web URL directly.

### A.5 If a real partnership appears

Where an official partner API exists, the registry can hold a real integration
returning genuine data. That is business development, not engineering. Note
which targets would benefit most and leave it there.

---

## PART B — Mobile apps

### B.1 Build order — do not skip to native

**Step 1 — PWA (days, not months).** The web app becomes installable: manifest,
icons, splash, service worker, offline shell, and web push where supported. The
founder gets a real icon on his home screen this week, with no store review.

**Step 2 — React Native via Expo, once the web app is stable.** One TypeScript
codebase for both platforms, sharing types and API client with the existing
client. Native shell, native mic, native push, native deep-link handling, plus
the intent registry from Part A.

**Step 3 — Native Swift/Kotlin: not planned.** Revisit only if something
genuinely requires it. Two separate native codebases would triple the surface
area of a product that currently cannot answer a question.

### B.2 Precondition — do not start Step 2 until these are true

- The twelve-screen UI rebuild is complete and approved.
- The provider chain works. Shipping a mobile app whose assistant cannot respond
  is worse than shipping nothing.
- The app store requirements in B.4 are satisfied.

State plainly if these are not met rather than proceeding.

### B.3 What the native app adds over the PWA

Only build Step 2 for what the PWA genuinely cannot do: reliable background push
on iOS, native audio session handling and barge-in, wake word, Siri and App
Intents, widgets, and reliable deep-linking into other apps. List anything else
honestly as "works fine in the PWA."

### B.4 App store requirements — founder tasks, flag them now

Blockers, none of them code:

- **A published privacy policy at a public URL.** Both stores reject without it.
  Already on the launch-gate list; now on the critical path.
- **In-app account deletion.** Apple requires it for any app with accounts.
- **Microphone usage description strings** that accurately describe use.
- Apple Developer Program and Google Play Console enrolment, with the
  organisation verification each requires.
- Data safety and privacy disclosures that match what the app actually does —
  including voice handling and anything sent to a model provider.

Write these into `BLOCKERS.md` with the exact action needed for each.

### B.5 Things that will bite

- App review rejects assistants that appear to automate other apps. Describe
  JennySol accurately: it prepares and hands off; it does not control other apps.
- Background microphone access is heavily restricted, and a continuously running
  wake word drains battery and draws review scrutiny. Foreground-only, opt-in.
- Anything resembling in-app purchase flows through store billing rules.

---

## PART C — Order of work

1. Action registry and intent capture on the web app, with three verified
   targets end to end.
2. PWA installability.
3. Founder blockers from B.4 raised and tracked.
4. React Native shell, once B.2 holds.
5. App Intents for Siri.

Ship and verify each before the next.

---

## Definition of done for this run

1. `ACTIONS.md` documents the registry format and every target, with each
   deep-link template **tested on a real device**.
2. Voice → clarify → handoff works end to end for at least three targets, on a
   real phone, opening the real app with the search pre-filled.
3. Jenny never states a price, coupon or availability she did not retrieve from
   a citable source.
4. No accessibility-service automation anywhere in the codebase.
5. No third-party credentials stored.
6. The PWA installs on Android and iOS and works offline for the shell.
7. `BLOCKERS.md` lists every app-store requirement with the exact founder action.
8. A written, honest statement of what was asked for that cannot be built, so
   nobody rediscovers it later.

Close with verified / inferred / blocked.
