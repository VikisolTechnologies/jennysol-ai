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
introduced). Fits this Mac's real memory budget (`hardwareProfile.ts`'s `m1_16gb` profile:
`usableMemoryGb: 10`; `qwen3:8b` general chat at 5.2GB + `qwen3-vl:4b` vision at 3.57GB real resident
= ~8.8GB, inside budget) in a way the 7-9B class measurably does not (5.2GB + 5.8GB = 11GB, already
past the 10GB usable ceiling — and it showed, live, as a real GPU OOM, not just arithmetic on paper).
100% structured-output reliability (the brief's own most heavily-weighted metric) against Moondream's
0%. Its own description ("Visual Agent Tasks: Operating computer and mobile interfaces, recognizing
UI elements") is a direct match for the Visual QA use case this whole exercise exists to unblock.

**Real, honest limitation to carry forward, not hide**: 2/5 raw defect accuracy on *subtle* UI defects
is a real number, not a rounding error — this model will miss some genuine problems. Given the safer
failure direction (miss, don't hallucinate) and that no evaluated alternative did meaningfully better
on structured output, this is the right call for a first real integration, with the explicit
expectation that a real Visual QA agent's findings **need a human to spot-check them before being
trusted as the sole signal**, not treated as ground truth — this document's own closing question below
answers that directly, not just implicitly.

## Not done this session, flagged not silently skipped

- **A real Arena FE screenshot pass** — this evaluation used controlled synthetic fixtures
  specifically so ground truth would be a known fact rather than my own manual read of a real page;
  a second pass against Arena's actual, currently-shipped UI (once its dev server's backend
  dependencies are available) would be the natural next real-world check before fully trusting this
  model's findings on production surfaces.
- **`OLLAMA_MAX_LOADED_MODELS` / explicit keep-warm interaction with the vision model** — not
  configured or tested this session; the real memory arithmetic above assumes the general chat model
  and the vision model are both resident, which is the real production shape once wired in (A.3
  below), but the *scheduling* of when each loads/evicts wasn't built or tested.
- **This Mac's Ollama instance was found running as two separate processes bound to different
  interfaces** (`127.0.0.1:11434`, started manually earlier this session, vs. the permanent
  `sh.brew.ollama` launchd service bound to a Tailscale-only address) — real, live-observed, not
  touched or resolved here (out of this document's scope; noted so it isn't silently rediscovered
  later as if new).

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
