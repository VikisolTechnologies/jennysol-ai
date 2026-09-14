# JENNYSOL-VISION-AND-IMAGERY.md
### Vision understanding + local image generation.
### Read `VIKISOL-BUILD-DOCTRINE.md` first. Run after `JENNYSOL-MODEL-FLEET.md`.

---

## 0. Two capabilities, deliberately separated

These are often discussed together and should not be built together.

**Vision understanding** — a model that looks at an image and reports what is
there. Runs in Ollama beside the existing LLMs, fits the memory budget, and
unblocks the Visual QA role in the agent platform. **Build this first.**

**Image generation** — FLUX / Qwen-Image / Stable Diffusion. A different
runtime, a different memory profile, and on this hardware it is mutually
exclusive with live inference. **Build this second, as a scheduled service.**

Do not attempt to make image generation a live in-conversation capability on
this Mac. Say so plainly if asked.

---

## 1. The hardware reality, restated

M1 Pro, 16GB unified. Usable budget after macOS is roughly **11GB**, shared
between everything resident at once.

A diffusion model loading will evict the keep-warm LLM. The next chat request
then cold-starts — the exact failure the cold-start work was built to prevent.
This is not a tuning problem; it is a memory arithmetic problem. Design around
it rather than trying to defeat it.

---

## PART A — Vision understanding (build now)

### A.1 Pick one vision model, by measurement

Evaluate current-generation vision models in the 7-9B class against the existing
Moondream2, using the harness from `JENNYSOL-MODEL-FLEET.md`. Measure on this
hardware: peak resident memory, time to first token, and accuracy on the tasks
below — not on published benchmarks.

Check what the current tags actually are before pulling; the vision model
generation has moved since the fleet was last chosen.

### A.2 The evaluation set that matters

The agent platform's real need is UI inspection, so build the prompt set from
that, not from generic captioning:

- **Screenshot reading** — given a screenshot of an Arena page, describe the
  layout, identify the visible components, read the text.
- **Defect detection** — given a screenshot, identify blank regions, overlapping
  elements, cut-off text, missing images, obviously broken layout.
- **Comparison** — given two screenshots, describe what changed.
- **Contrast and legibility judgement** — flag text that is hard to read against
  its background. This is directly useful given the known WCAG failures.
- **Structured output** — the model must return findings as valid JSON matching
  a fixed schema, first attempt. Weight this heavily. A vision model that sees
  correctly but emits malformed JSON is useless inside a DAG.

Record the failure modes in prose, not just a score. Hallucinated UI elements
are the dangerous failure here — a model that invents a button that isn't there
will send an agent chasing nothing.

### A.3 Wire it into the router

- Register it as its own capability (`vision`), routed by task type, with an
  assertion test proving image tasks reach it and never reach a text-only model.
- Same treatment as every other provider: first-token budget, hedging where a
  cloud fallback exists, circuit breaker, metrics.
- Respect `OLLAMA_MAX_LOADED_MODELS`. If loading the vision model evicts the
  general model, decide deliberately which stays warm and document the choice.

### A.4 Serve the Visual QA role

This is the point of the whole exercise. The screenshot mechanism for Visual QA
was already flagged as needing its own design pass — do that now:

- How screenshots are captured (Playwright already exists in the Arena repo —
  reuse that mechanism rather than inventing one).
- Where they are stored, and for how long.
- The fixed schema the vision model must return.
- What the agent does with a finding: a Visual QA agent reports, it does not
  autonomously edit UI.

---

## PART B — Image generation (build second)

### B.1 Runtime

Not Ollama. On this Mac the practical option is a native Metal engine — Draw
Things supports SD, FLUX.1/2 and Qwen-Image with on-device execution. ComfyUI is
the alternative if a programmatic API matters more than speed; verify MPS is
actually selected if you use it, since a CPU fallback is catastrophically slow.

Evaluate both against one criterion: **can JennySol call it programmatically as
a tool?** A generator that requires a human in a GUI is not an ecosystem
capability.

### B.2 What fits

At this memory tier, expect SDXL plus 4-bit FLUX to be the practical ceiling,
and expect roughly half a minute or worse per image. Measure it; do not quote
the figures above as results.

The larger Qwen-Image and FLUX.2 variants belong in `GPU-FLEET-PLAN.md` for the
RTX 5090 machine, not here.

### B.3 Scheduled, never live

- Image generation is a **queued job**, not a synchronous request.
- Before a job starts: unload or pause the keep-warm LLM deliberately, generate,
  then restore the previous model state. Never let these two compete silently.
- Refuse to start a generation job while an agent run is in flight; queue it.
- Emit the same metrics as every other provider: queue time, generation time,
  peak memory, failures.

### B.4 Register it as a scoped tool

It goes in the tool registry like everything else: a capability, not free access.
The agent supplies a prompt and gets back an image reference. It does not get a
shell, a file path of its own choosing, or the ability to write generated images
anywhere it likes.

---

## PART C — The rule that does not bend

**Never generate images of people for Arena.**

No AI-generated faces as seed profiles, no synthetic avatars, no invented users
in screenshots that reach production. Arena's most important promise is that it
never fakes activity. A user who discovers the faces in the feed aren't real
people loses trust permanently, and trust is the entire basis of a product where
strangers meet in person.

For anything depicting humans, use licensed stock photography. Record the source
and licence for every image that ships.

**Where generated imagery is legitimately useful:**

- abstract backgrounds, textures, gradients, the Arena ring and hairline motifs
- empty-state and error-state illustration
- category, topic and skill artwork
- OG share images generated at scale from a template
- Vikisol brand and marketing iterations

**Also required:**

- Generated images that reach a user-facing surface are labelled as such in the
  asset metadata, so nobody six months from now has to guess.
- No generation of real identifiable people, no reproduction of brand marks or
  copyrighted characters, no imitation of a named living artist's style for
  commercial output.

---

## Definition of done

1. One vision model selected **on measured evidence from this hardware**,
   registered as its own routed capability, with an assertion test.
2. Its structured-output reliability measured and reported — this is the number
   that decides whether it can be trusted inside a DAG.
3. The Visual QA screenshot mechanism designed and documented, reusing the
   existing Playwright capture rather than a new one.
4. Memory contention documented: what is resident when, and what gets evicted.
5. Image generation available as a **queued, scoped tool** that explicitly
   manages LLM eviction around each job — or, if measurement shows it is not
   viable on this hardware, a written statement saying so and deferring it to
   the GPU plan. That is an acceptable outcome; forcing it is not.
6. The no-generated-people rule written into the tool's own guardrails, not just
   into this document.

Close with verified / inferred / blocked, plus one sentence on whether the
vision model is good enough to trust with Visual QA findings without a human
checking every one.
