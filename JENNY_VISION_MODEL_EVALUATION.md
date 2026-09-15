# Jenny — Vision Model Evaluation (Part A of JENNYSOL-VISION-AND-IMAGERY.md)

Real evaluation, this session, against three candidate vision models on this Mac (M1 Pro, 16GB) —
`moondream` (the JENNY_MODEL_FLEET.md-recommended baseline, not previously pulled or tested — that
recommendation was a paper-based license/size vet, never a live behavioral test), `qwen3-vl:4b`, and
`qwen3-vl:8b` (the current-generation 7-9B-class candidate the brief specifically asked to check,
since "the vision model generation has moved since the fleet was last chosen" — confirmed true:
neither Moondream2 nor Qwen2.5-VL-7B, the fleet doc's own named models, are what a fresh check of
Ollama's library surfaces as current-generation today).

## Method

Six controlled HTML/CSS fixtures with **known ground truth** (not real Arena screenshots — a
deliberate choice, explained below), rendered to real PNGs via Playwright (reusing Arena FE's
already-installed Playwright + Chromium exactly as the brief instructs, rather than installing a
second screenshot mechanism): a clean baseline UI, and four fixtures each with exactly one deliberately
introduced, precisely known defect (overlapping elements, mid-sentence cut-off text, near-invisible
low-contrast text, a blank region where an image should be), plus a "changed" variant of the baseline
for the comparison task. Each candidate model was sent every fixture through Ollama's real
`/api/chat` multimodal endpoint (not a mocked call) with one fixed structured-JSON-output prompt,
scored automatically against the known ground truth — never scored by another model's opinion.

**Why controlled fixtures instead of real Arena screenshots**: with known, exact ground truth for
every fixture, "did the model actually find the real defect" is a fact, not a judgment call. An
uncontrolled real Arena screenshot would require *me* to first decide what's "correct" before scoring
a model against it — which would make this evaluation only as good as my own manual read of that one
screenshot, not a rigorous instrument. A real Arena screenshot pass is still valuable as a second,
product-specific check once a model is chosen (flagged below, not done this session — Arena FE's dev
server would need real backend dependencies running first).

## Results

| Model | Structured-JSON reliability | Real defect-detection accuracy | Peak resident memory |
|---|---|---|---|
| `moondream` (1.7GB) | **0/6** — never once produced valid JSON | 1/5 (see caveat below — not genuine) | not captured (see gap below) |
| `qwen3-vl:4b` (3.3GB) | **6/6** — every single response was valid, schema-matching JSON | 2/5 — correctly caught the blank-region defect and correctly reported none on the clean baseline; missed the subtler overlap/cutoff/contrast defects, but never hallucinated a defect that wasn't there | **3.57GB** (`size_vram` from `/api/ps`) |
| `qwen3-vl:8b` (6.1GB) | 0/6 — see real cause below, not a fair reliability score | not meaningful | 5.8GB **before it crashed** |

**The 1/5 accuracy scores for `moondream` and `qwen3-vl:8b` are not genuine correct identifications —
recorded honestly, not smoothed over**: both never produced valid JSON at all, so the scorer's
"no valid JSON → treat as no defect reported" default happened to coincidentally match the one
fixture (`clean-ui`) that genuinely has no defect. Read their real defect-detection accuracy as
**0/5**, not 1/5 — the automated number is a scoring artifact of how "no answer" was defaulted, and
this is exactly the kind of raw-number-vs-real-meaning gap this document's own doctrine says to catch
and state plainly, not let stand uncorrected.

## Real failure modes, in prose (per the brief's own explicit request — a score alone hides this)

**`moondream`**: On the clean baseline, ignored the JSON instruction entirely and returned free
prose — and the prose was a **hallucination**: *"The image shows a screenshot of a job application
form... welcoming the user to the application process"* — the real image is a dashboard welcome card
with job-match notifications, not an application form, and there is no "welcome to the application
process" text anywhere in it. On a defect fixture, its failure mode was different and, if anything,
more concerning: it echoed the prompt's own JSON *schema template* back verbatim (`"a short
description of what is visible"`, `"list of UI component types visible, e.g. heading, paragraph,
button"`) as if those placeholder strings were real observations, rather than analyzing the image at
all. **Hallucinated content and echoed instructions are exactly the "dangerous failure" the brief
warns about** — a Visual QA agent acting on either would send a human chasing a problem that doesn't
exist, or silently do nothing while believing it inspected something.

**`qwen3-vl:8b`**: Real, root-caused, not inferred. The first call took 8.8s and returned empty
content; every call after that returned in 30-60ms with empty content — far too fast to be genuine
fast inference. Ollama's own server log (this Mac's real, currently-running instance) shows exactly
why:
```
ggml_metal_synchronize: error: command buffer 0 failed with status 5
error: Insufficient Memory (00000008:kIOGPUCommandBufferCallbackErrorOutOfMemory)
...
ggml_metal_graph_compute: backend is in error state from a previous command buffer failure - recreate the backend to recover
```
A genuine **Metal/GPU out-of-memory error** on this Mac's unified memory, confirmed by `sysctl
vm.swapusage` showing **7.1GB of this Mac's 8GB swap already in use (87%)** at the time. This is
direct, live confirmation — not a repeated assumption — of `JENNY_MODEL_FLEET.md`'s own prior finding
for the previous model generation (Qwen2.5-VL-7B: *"its footprint doesn't coexist with a loaded chat
model in a 6-8GB budget"*) and this brief's own opening framing (*"A diffusion model loading will
evict the keep-warm LLM... this is not a tuning problem; it is a memory arithmetic problem"*) — the
same arithmetic holds for the current model generation too, re-verified live rather than assumed to
still be true.

**`qwen3-vl:4b`**: The only model that never hallucinated and never echoed the prompt back. Its
comparison-task output quoted the two real, exact changes between the baseline and the modified
fixture correctly and specifically (*"The button's background color changed from blue to green"*,
*"The button's label text changed from 'View matches' to 'Get started'"*) — both true, both specific,
neither invented. Its one real weakness: it under-reports subtler defects (overlap, cut-off text,
low-contrast text) rather than over-reporting — a real accuracy gap, but the *safer* failure direction
for this use case (a missed defect is a human catching it later; a hallucinated one sends an agent
chasing nothing).

## Recommendation

**`qwen3-vl:4b`, on measured evidence, not the fleet doc's earlier (reasonable, but never
live-tested) Moondream2 recommendation.** Apache 2.0 (confirmed directly against Qwen's own Hugging
Face license file, matching every other Qwen model already in this fleet — no new license class
introduced). Its own real resident size (3.57GB) is comfortably under this Mac's `m1_16gb` profile's
`usableMemoryGb: 10` on its own — in a way the 7-9B class measurably is not (`qwen3-vl:8b` alone at
5.8GB, alongside a resident chat model, is what triggered the real GPU OOM above; 3.57GB alone leaves
real headroom that model never had). 100% structured-output reliability (the brief's own most
heavily-weighted metric) against Moondream's 0%. Its own description ("Visual Agent Tasks: Operating
computer and mobile interfaces, recognizing UI elements") is a direct match for the Visual QA use
case this whole exercise exists to unblock.

**Correction, found live while directly testing memory contention (this document's own §4
requirement) rather than left as arithmetic**: an earlier draft of this section reasoned that
`qwen3:8b` (general chat, 5.2GB) and `qwen3-vl:4b` (3.57GB) *should* coexist resident together, since
5.2+3.57 ≈ 8.8GB is under the 10GB budget. **That reasoning was never actually tested, and the real,
live behavior is different**: on this Mac, right now, with no `OLLAMA_MAX_LOADED_MODELS` override set
anywhere, Ollama evicts the previously-resident model **immediately** on any request for a
*different* model — confirmed directly: warming `qwen3:8b` evicted an already-resident
`qwen2.5-coder:7b` outright (not "eventually, once memory got tight" — instantly, on the very next
request), and requesting `qwen3-vl:4b` right after evicted `qwen3:8b` in turn, even though both would
fit the stated budget together. **The real, honest implication**: on this specific machine, as
configured today, a vision request and a text-chat request will always cold-start against each
other in practice — there is no "both stay warm" scenario here, regardless of what the raw memory
arithmetic alone would suggest. This is exactly the class of number this document exists to report
plainly rather than let stand as a plausible-sounding assumption.

**Real, honest limitation to carry forward, not hide**: 2/5 raw defect accuracy on *subtle* UI defects
is a real number, not a rounding error — this model will miss some genuine problems. Given the safer
failure direction (miss, don't hallucinate) and that no evaluated alternative did meaningfully better
on structured output, this is the right call for a first real integration, with the explicit
expectation that a real Visual QA agent's findings **need a human to spot-check them before being
trusted as the sole signal**, not treated as ground truth — this document's own closing question below
answers that directly, not just implicitly.

## Eviction policy (definition-of-done item 4 — what is resident when, what evicts what)

Written down as its own section per explicit review feedback, not left as something only
"understood" from the correction paragraph above. Grounded in this session's actual code
(`keepWarm.ts`, `ollama.ts`) and two further live measurements taken specifically for this section —
not arithmetic.

**Root cause, stated precisely**: it is not a memory-arithmetic problem in the sense of "these two
models don't both fit." `qwen3:8b` (5.2GB) + `qwen3-vl:4b` (3.57GB) ≈ 8.8GB, comfortably under the
`m1_16gb` profile's 10GB usable budget. The real cause is `OLLAMA_MAX_LOADED_MODELS` — confirmed via
`launchctl print gui/$(id -u)/sh.brew.ollama` to be **unset** anywhere in this deployment (only
`OLLAMA_HOST` is set). Ollama's own default for that setting on a GPU this size is **1** resident
model, full stop, regardless of whether a second model would technically fit. This is a policy knob,
not a hard ceiling — raising it is possible, but was not done here (see "what would have to change"
below).

**What is resident, by default**: `qwen3:8b` (`general` capability), kept warm by `keepWarm.ts`'s
background ping every `OLLAMA_KEEP_WARM_INTERVAL_MS` (default **4 minutes**), deliberately shorter
than Ollama's own 5-minute default unload window (`ollama.ts`'s `WARM_WINDOW_MS`) so a healthy Mac
never actually goes cold on its own between pings. This is the model production chat traffic through
the tunnel depends on.

**What evicts what — confirmed live, not inferred**, via a direct four-step measurement (warm the
general model → real `describeImage()` vision call → general model call again → general model call
again immediately) with `/api/ps` polled after every step:

| Step | Call | Resident afterward | Wall-clock |
|---|---|---|---|
| 1 | `qwen3:8b` chat ping | `qwen3:8b` only | 10,441 ms |
| 2 | real `describeImage()` (vision) | `qwen3-vl:4b` only — `qwen3:8b` evicted | 9,876 ms |
| 3 | `qwen3:8b` chat ping again | `qwen3:8b` only — vision model evicted | 9,280 ms |
| 4 | `qwen3:8b` chat ping, immediately after (already warm) | `qwen3:8b` | 7,457 ms |

`/api/ps` never showed more than one model resident at any point in this sequence — the eviction is
total and immediate on every switch, exactly as the correction paragraph above found, now with an
exact mechanism (`OLLAMA_MAX_LOADED_MODELS` defaulting to 1) rather than just an observed symptom.
Note steps 1/3 (post-eviction reload) and step 4 (already warm) are close — 9-10s vs 7.5s — because
`qwen3:8b`'s own "thinking" mode generation time dominates the call, not raw model-load time; the
codebase's own separately-measured figure for load time alone is ~2.2s (`keepWarm.ts`'s comment,
from `JENNYSOL-LOCAL-CUTOVER.md` Phase 2.1), consistent with the ~3s gap between those numbers here.

**What happens to keep-warm when a vision task arrives**: `keepWarm.ts` has no awareness of vision at
all — it just pings `pickOllamaModel("general")` on its own fixed interval regardless of what else is
resident. So the real sequence is: a Visual QA task calls `describeImage()` → evicts `qwen3:8b` →
the *next* real user chat request, if it lands before the next keep-warm tick (up to 4 minutes later)
or before keep-warm's own next ping fires, pays a real ~9-10s cold-start reload. Keep-warm does not
detect or react to this eviction; it simply does its job on schedule and happens to reload the general
model the next time it fires, whether or not a real user needed it sooner.

**The deliberate design choice, restated now that the mechanism is documented**: this is accepted,
not fixed, because Visual QA is an asynchronous agent task inside a DAG (latency-tolerant, already
budgeted at 60-136s wall-clock per Stage C's own multi-node numbers above), not a synchronous,
in-conversation path a real user is staring at. A real user's chat message losing its warm model to a
vision task that ran moments earlier is a real, accepted cost of this trade — general chat traffic
still gets keep-warm's protection on its own normal schedule, it just isn't vision-aware.
**Consequence for the multi-agent DAG specifically**: `tryAcquireLocalRunSlot()` already serializes
all local calls to one concurrent run (`maxConcurrentLocalRuns: 1`), so a Coder task and a Visual QA
task in the same or different sessions were already forced to queue behind each other before any
model-loading is considered; the eviction behavior above is an *additional* real cost stacked on top
of that queuing, not a separate failure mode.

**What would have to change to be acceptable at higher volume** (reporting, not implementing, per
this document's own precedent): (1) set `OLLAMA_MAX_LOADED_MODELS=2` on the `sh.brew.ollama` launchd
service and re-measure whether both models genuinely coexist resident (the raw 8.8GB arithmetic
allows it; untested because the current default already answered "no" before that knob was ever
touched); (2) make `keepWarm.ts` vision-aware — re-ping the general model immediately after any real
vision call completes, instead of waiting for the next fixed-interval tick.

## Closing: is this model trustworthy enough for Visual QA findings without a human checking every one?

**No — not yet, and not on this evidence.** 100% JSON reliability means its *output can be trusted to
parse*, not that its *content* can be trusted unchecked. A real 0/5 (or a generous 2/5) accuracy rate
on deliberately obvious, textbook UI defects is a real, low number for a signal a human would act on
unsupervised. The honest, evidence-based design for Visual QA (Part A.4) is: real findings, always
shown to a human before any downstream action, never auto-applied — exactly the same "reports, does
not decide" shape already built for every other reviewer role in the agent system
(`JENNY_IMPLEMENTATION_STATUS.md`'s Stage D group 2 entry).

**Verified**: three real models pulled and run through Ollama's real API on this Mac; one root-caused
real GPU OOM with the exact server-log error text; real license confirmation for the winning
candidate; real memory-fit arithmetic against this Mac's actual configured hardware profile.
**Inferred**: that `qwen3-vl:4b`'s real-world accuracy on genuine Arena screenshots will resemble its
accuracy on these synthetic fixtures — a reasonable extrapolation, not directly measured.
**Blocked**: nothing in Part A required founder input to complete for real; Part B (below) is a real,
evidence-based deferral, not a blocker being carried forward silently.

## Update — Part A.3/A.4 completed, Visual QA is real

Everything this section originally flagged as remaining is now done, in the same session:
- **A.3 (router integration)**: `providers/ollamaVision.ts` — a real, separate `describeImage()`
  function (not bolted onto `routeChatCompletion()`'s hedging/tool-calling machinery, since there is
  exactly one vision provider and nothing to hedge against yet), sharing the same local-concurrency
  gate as text chat (the exact shared resource whose real violation caused the GPU OOM this document
  found), with real circuit-breaker and metrics integration. `capabilityRegistry.ts`'s `VISION` entry
  now reports `implemented: true`.
- **A.4 (screenshot mechanism + Visual QA role)**: `agentScreenshotTool.ts` (Playwright, reusing
  Arena FE's own already-installed library and cached Chromium build — no second download) +
  `agentOrchestrator.ts`'s `runVisualQaTask`. Live-verified end-to-end: a real objective produced a
  real file with a real, deliberate low-contrast defect, and the real Visual QA role's finding named
  that exact defect precisely, with no hallucination. Full detail in
  `JENNY_IMPLEMENTATION_STATUS.md`'s "Visual QA — the loop closed for real" entry.

**The keep-warm decision A.3 explicitly asks for, made deliberately, not left implicit**: given the
real, tested eviction behavior above (any model switch evicts the previous one on this machine,
regardless of `OLLAMA_MAX_LOADED_MODELS` being unset), something has to be the default warm model —
**the general chat model stays it.** General chat is JennySol's primary, high-frequency, user-facing
path; Visual QA is a comparatively rare, occasional step inside an agent session, not something a
real user waits on directly. A vision call accepting a real, occasional cold-start cost is the right
tradeoff; making every general chat message pay that cost so a rare Visual QA task can stay warm
would not be. No code change was needed to make this the actual behavior (nothing currently forces
the vision model to stay resident), so this is a documented operating decision, not a shipped
feature — flagged here so a future session doesn't have to re-derive it from scratch.

## Part B — Image generation: a real, evidence-based deferral

Not built this session. This is the outcome the brief itself names as acceptable
("if measurement shows it is not viable on this hardware, a written statement saying so and
deferring it to the GPU plan. That is an acceptable outcome; forcing it is not.") — not a blocker
being carried forward silently.

**Real evidence, not assumption**:
1. **Neither runtime the brief names is installed on this Mac.** `/Applications` has no Draw Things;
   `comfyui` is not on `PATH` and no ComfyUI checkout exists anywhere checked. Draw Things is a Mac
   App Store GUI application — there is no command-line path to install it non-interactively, and an
   App Store install requires interactive Apple ID/GUI steps outside what this session can perform.
   ComfyUI's install path (git clone + a real Python venv + real pip installs, likely several more
   GB) is genuinely scriptable, but it is a separate, substantial undertaking — a real Python ML
   runtime with its own dependency surface, not a small addition.
2. **This Mac was already under severe, measured real memory pressure from vision-model testing
   alone, before any diffusion workload was even attempted**: `sysctl vm.swapusage` showed **7.1GB of
   8GB swap in use (87%)** at the point `qwen3-vl:8b` hit its real, measured Metal/GPU OOM (see Part
   A above). The brief's own opening framing — *"A diffusion model loading will evict the keep-warm
   LLM... this is not a tuning problem; it is a memory arithmetic problem"* — is not a hypothetical on
   this machine; it is what this session's own real vision-model testing already demonstrated,
   without a diffusion model in the picture at all yet.
3. Installing and then load-testing a full diffusion runtime on top of that, in the same session that
   already produced one real GPU OOM, would risk genuine system instability for evidence this
   document can already report without taking that risk: **this Mac's real, current memory headroom
   does not support adding a diffusion workload on top of what already runs here.**

**What this means concretely**: Part B (B.1 runtime choice, B.2 what fits, B.3 scheduled/never-live
design, B.4 scoped-tool registration) is deferred to the GPU server plan referenced throughout
`JENNY_MODEL_FLEET.md`, not attempted piecemeal on this Mac. If a real need for local image
generation arises before that hardware exists, the concrete next step is a dedicated, separate
session scoped specifically to installing and measuring ComfyUI (the programmatically-callable
option per the brief's own B.1 criterion) in isolation — not bundled into other work, and not
attempted while any other memory-hungry local model work is in flight.

## Part C — guardrails, recorded now for whenever Part B is eventually built

Part B has no tool yet to write these into (the brief's own definition-of-done #6 asks for them "in
the tool's own guardrails, not just into this document") — recorded here prominently so they are not
rediscovered or renegotiated later, and treated as a hard requirement for Part B's eventual first
implementation, not a nice-to-have:

1. **Never generate images of people for Arena.** No AI-generated faces as seed profiles, no
   synthetic avatars, no invented users in any screenshot or asset that reaches production. Arena's
   real product promise depends on every person being real.
2. Legitimate uses only: abstract backgrounds/textures/gradients, empty-state/error-state
   illustration, category/topic/skill artwork, templated OG share images, Vikisol brand/marketing
   iterations.
3. Any generated image reaching a user-facing surface must be labeled as such in its asset metadata.
4. No generation of real identifiable people, no reproduction of brand marks or copyrighted
   characters, no imitation of a named living artist's style for commercial output.
5. For anything depicting real humans, licensed stock photography only, with source and licence
   recorded per image — never a generated substitute.

**Verified**: no Draw Things or ComfyUI installation exists on this Mac (checked directly, not
assumed); real, current swap pressure (87%) measured at the point of Part A's own real GPU OOM.
**Inferred**: nothing — this deferral rests on direct measurement, not extrapolation.
**Blocked**: a real Part B implementation needs either different (GPU-server) hardware, or a founder
decision to accept the real risk of installing and load-testing a diffusion runtime on this Mac
specifically, which this document does not recommend given the evidence above.

## Update — real Arena screenshot pass, 2026-09-14 (closing the inferred gap above)

Done in direct response to review feedback: the earlier "inferred, not measured" extrapolation
(synthetic fixtures → real Arena screens) has now been tested directly against real, production
Arena UI at `arena.vikisol.in`, logged in with a real account (founder-provided credentials, used
once). **Screenshots only, real account browsing, no Arena data access** — no API calls, no database
queries, nothing exported; the automated harness itself was blocked mid-run by the auto-mode
classifier from navigating into `/map`, `/rooms`, `/identity` (flagged PII-sensitive), which was
respected rather than routed around — the test pivoted to the public, pre-auth login page plus the
authenticated home page instead, both legitimate real Arena UI with no PII risk.

**Method**: Playwright navigated and logged into the real site; known defects were planted with
`page.evaluate()` DOM-only style mutations on top of the real, live-rendered page (never written to
Arena's codebase, database, or deployment — gone the instant the tab closed), same category set as
the original synthetic evaluation (low-contrast/invisible text, cut-off text, overlap, blank region).
Each resulting screenshot was run through the exact real production path: `describeImage()` with the
real `VISUAL_QA_SYSTEM_PROMPT` from `agentRolePrompts.ts` — the same code the live Visual QA role
calls, not a re-implementation.

**Results — 4 real cases attempted, ground truth confirmed by direct visual inspection of each
screenshot before scoring:**

| # | Screenshot | Ground truth | Model verdict | Outcome |
|---|---|---|---|---|
| 1 | real login page, untouched | clean | `pass`, no findings | **Correct** |
| 2 | real home page, untouched (empty state) | clean | `pass`, no findings | **Correct** |
| 3 | planted: Sign-in button text color set to match its own background (fully invisible) | defect | `pass`, no findings | **MISSED** — a real, unambiguous, fully-invisible button label went unreported |
| 4 | planted: "Password" label clipped to "Passw" | defect | — | **Could not be scored** — real request failure, twice (see below) |

**0 hallucinations** — same real strength as the synthetic-fixture evaluation held here too; the
model never reported a defect that wasn't there. But **real defect-detection accuracy on genuine
Arena screenshots is worse than the synthetic-fixture number, not comparable to it**: 0/1 scored
correctly here, against 2/5 (40%) on the earlier small, simple synthetic fixtures. One data point is
not a statistically confident rate, but the direction is real and worth stating plainly rather than
rounded up: full-size, real-world screenshots are harder for this model than the synthetic set
suggested, not easier.

**A second, more operationally serious finding — case 4 failed the same way twice in a row, not a
fluke:**

```
elapsed: 115470ms, FAILED: Ollama returned no content (model=qwen3-vl:4b, done=true) —
likely a local resource failure
```

Root-caused via the real production Ollama log (`/opt/homebrew/var/log/ollama.log`), both attempts:

```
msg="llama-server model predicted to exceed available memory, evicting"
predicted="3.4 GiB" available="2.0 GiB" gpu_free="6.6 GiB" system_free="2.0 GiB" system_limited=true
```

This is a **different failure shape from the earlier-documented `qwen3-vl:8b` hard GPU-OOM crash**
(that one was a Metal command-buffer error; this one is Ollama's own scheduler proactively evicting
because macOS system RAM — not GPU VRAM — dropped to ~2GB free under this Mac's ordinary daily load,
`system_limited=true` both times). The model `qwen3-vl:4b` was specifically chosen in Part A.1 above
*because* it never showed this failure — but that conclusion was reached testing small, simple
synthetic fixtures on an otherwise-idle Mac. Real, full-resolution screenshots (1280x900, encoded and
processed) plus this Mac's real, ordinary background load (VS Code, other apps — not an artificially
stressed test) reproduced a real request failure twice in a row. The eviction log line at case 3
(88.9s, 2208 completion tokens — unusually long/verbose) suggests memory pressure was already
building before case 4 outright failed.

**Two corrections to the earlier "is this trustworthy" framing, carried forward, not softened**:
1. The earlier verdict ("no — not yet, not on this evidence") was already appropriately cautious, but
   for the wrong completeness reason (small accuracy numbers on toy fixtures). The real reason to stay
   cautious is now stronger: on real screenshots, this model can miss an unmissable defect (case 3)
   and can fail to respond at all under this Mac's ordinary memory conditions (case 4, twice).
2. **A Visual QA agent task on this Mac, today, has a real, non-trivial chance of hard-failing before
   it ever produces a verdict** — not a hypothetical edge case, a reproduced-twice real outcome. Any
   session budget or retry policy for the `visual_qa` role should account for this specific failure
   mode explicitly, not assume a vision call either succeeds or cleanly returns "pass"/"concerns."

Not fixed here (reporting, not implementing, per this document's own established precedent) — real
candidates for a future pass: retry-once-on-this-specific-error for the `visual_qa` role specifically
(the general system has no automatic retry anywhere today, a gap already flagged in
`JENNY_IMPLEMENTATION_STATUS.md`'s Stage C §5.4); or downscaling/compressing a screenshot before
sending it to `describeImage()`, since a smaller image is a smaller real memory footprint at decode
time — untested, a plausible mitigation not a confirmed one.

**Revised closing answer, superseding the one above**: no, more firmly than before — a real Visual QA
finding on this Mac today needs a human check not only because the model's judgment is unproven, but
because the call itself has a demonstrated, real chance of never completing.
