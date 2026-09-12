# JennySol — Model License Matrix

Written 2026-09-11. This is the full landscape survey behind the model-fleet decisions in
[JENNY_MODEL_FLEET.md](JENNY_MODEL_FLEET.md) — broader than what's actually installed today (that's
[JENNY_LOCAL_MODEL_MATRIX.md](JENNY_LOCAL_MODEL_MATRIX.md), which stays in sync with the real code
registry, `server/src/services/models/modelRegistry.ts`). Every row here was checked against the
model owner's own license page/repo, not a Hugging Face card summary or a third-party blog, and
carries the date it was checked. **Re-verify before relying on an old row** — licenses change (see
the Gemma and Llama/Muse rows below, both of which changed mid-2026).

## Terminology, used consistently below

- **Open source code** — the training/inference *code* is under an OSI-approved license (e.g.
  Apache 2.0, MIT). Says nothing about the weights.
- **Open weights** — the trained model *parameters* are downloadable. Says nothing about what
  you're allowed to do with them — that's the license.
- **Open license** — a license that grants broad rights (commercial use, modification,
  redistribution) with few or no conditions, e.g. Apache 2.0, MIT.
- **Open model** — loosely used industry-wide to mean "open weights," regardless of how permissive
  the license actually is. A model can be "open" (downloadable) and still commercially restricted
  (e.g. Gemma 3's Terms of Use, Qwen2.5-VL-3B's Research License) — this matrix exists specifically
  to not conflate the two.
- **Free API** — no cost to call, but still a hosted service you don't control and can't download;
  orthogonal to "open source." A free API can front a fully closed model.
- **Free software** — the FSF's four-freedoms sense (run/study/modify/redistribute) — used here only
  where a model's license actually meets that bar (Apache 2.0/MIT-class), not as a synonym for
  "free API" or "no cost."
- **Commercial use** — whether the license permits using the model/weights to generate revenue,
  distinct from redistribution or modification rights.
- **Local inference** — the model can actually be run on hardware you control (Ollama, llama.cpp,
  vLLM, etc.) because the weights are downloadable in a compatible format — independent of license.

## Cloud / API-only providers (no downloadable weights — not local models)

| Provider | Type | Officially downloadable weights? | Local inference possible? | Source | Verified |
|---|---|---|---|---|---|
| **Anthropic (Claude)** | Cloud API only | **No** | **No** — no GGUF/safetensors release; Anthropic API / AWS Bedrock / Google Vertex AI / Microsoft Foundry are the only access points, including the "Priority Tier" dedicated-capacity option | [Models overview](https://platform.claude.com/docs/en/models/overview), [Deprecation & preservation commitments](https://www.anthropic.com/research/deprecation-commitments) (explicitly treats public weight release as unresolved/"exploring," not a current offering) | 2026-09-11 |
| **OpenAI (GPT / o-series)** | Cloud API only | **No** | **No** | [Models docs](https://developers.openai.com/api/docs/models) | 2026-09-11 |
| ↳ OpenAI gpt-oss-20b / 120b *(separate release, not the flagship line)* | Open-weight | **Yes** | Yes — official Ollama library entry | Apache 2.0. [HF blog](https://huggingface.co/blog/welcome-openai-gpt-oss), [Ollama library](https://ollama.com/library/gpt-oss) | 2026-09-11 |
| **Google Gemini** | Cloud API only (Gemma is a separate family, see below) | **No** | **No** | [Gemini API models docs](https://ai.google.dev/gemini-api/docs/models) | 2026-09-11 |
| **DeepSeek API** (platform.deepseek.com) | Cloud API — distinct product from DeepSeek's open-weight releases below | **No** (for this product) | **No** (for the API itself) | [Open Platform ToS](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html), [Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) | 2026-09-11 |

**Verdict on Claude specifically**: *"Claude is a cloud/API provider for JennySol, not a local
model"* — confirmed accurate. Do not attempt to source or run Claude weights through Ollama,
llama.cpp, or vLLM; none exist to load.

## General / reasoning / coding open-weight families

| Model | Provider | Version | License | Commercial use | Modification | Redistribution | Hosted-service restrictions | Known restrictions | Source | Verified |
|---|---|---|---|---|---|---|---|---|---|---|
| Qwen3 (0.6B–8B, in production use) | Alibaba | Qwen3 | Apache 2.0 | Yes | Yes | Yes | None | None found, verified straight through to the 235B MoE flagship via the HF LICENSE file, not just the README | [github.com/QwenLM/Qwen3](https://github.com/QwenLM/Qwen3), [HF LICENSE (235B)](https://huggingface.co/Qwen/Qwen3-235B-A22B/blob/main/LICENSE) | 2026-09-11 |
| Qwen2.5-Coder (7B, in production use) | Alibaba | 2.5 | Apache 2.0 | Yes | Yes | Yes | None | None | [HF LICENSE](https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct/blob/main/LICENSE) | 2026-09-11 |
| Qwen2.5-VL-**3B**-Instruct | Alibaba | 2.5 | **Qwen RESEARCH LICENSE — non-commercial** | **No** — commercial use requires a separate license from Alibaba | Research use only | Research use only | N/A | **Do not deploy commercially as shipped.** See discrepancy note below. | [HF LICENSE file](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE) | 2026-09-11 |
| Qwen2.5-VL-**7B**-Instruct | Alibaba | 2.5 | Apache 2.0 | Yes | Yes | Yes | None | Size-specific — do not assume the 3B license applies here or vice versa | [huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct) | 2026-09-11 |
| DeepSeek-R1 (671B, full) | DeepSeek | R1 | MIT | Yes | Yes | Yes | None | ~404GB — not a realistic local target on any planned hardware; treat as cloud/API-scale only | [GitHub LICENSE](https://github.com/deepseek-ai/DeepSeek-R1/blob/main/LICENSE) | 2026-09-11 |
| DeepSeek-R1-Distill-**Qwen**-7B (in production use, `deepseek-r1:7b`) | DeepSeek / Alibaba (dual) | R1 distill | **MIT (DeepSeek) + Apache 2.0 (Qwen2.5 base)** — dual, both permissive | Yes | Yes | Yes | None | Registry previously described this as plain "MIT" — corrected 2026-09-11, see below | [README §7](https://github.com/deepseek-ai/DeepSeek-R1/blob/main/README.md) | 2026-09-11 |
| DeepSeek-R1-0528-Qwen3-8B *(newer revision, not yet adopted)* | DeepSeek / Alibaba (dual) | R1-0528 | MIT (DeepSeek) + Apache 2.0 (Qwen3 base) | Yes | Yes | Yes | None | Recommended future upgrade candidate over the 7B distill above — see Fleet doc | same | 2026-09-11 |
| DeepSeek-R1-Distill-**Llama**-8B/70B | DeepSeek / Meta (dual) | R1 distill | **MIT (DeepSeek) + Llama Community License (base)** — dual, one restrictive | Yes, with Llama's Acceptable Use Policy + "Built with Llama" attribution clause attached | Yes, with Llama naming-derivative rule ("must start with Llama") | Yes, same attribution rule | Llama's 700M-MAU commercial-license gate (irrelevant at Vikisol's scale, but present) | Extra license layer vs. the Qwen-based distill for no capability gain here | [README §7](https://github.com/deepseek-ai/DeepSeek-R1/blob/main/README.md) | 2026-09-11 |
| Mistral-7B-v0.3 | Mistral AI | v0.3 | Apache 2.0 | Yes | Yes | Yes | None | None | [mistral.ai/news/announcing-mistral-7b](https://mistral.ai/news/announcing-mistral-7b/) | 2026-09-11 |
| Mistral-NeMo-12B | Mistral AI / NVIDIA | — | Apache 2.0 | Yes | Yes | Yes | None | None | [mistral.ai/news/mistral-nemo](https://mistral.ai/news/mistral-nemo/) | 2026-09-11 |
| Mistral Small 3.1/3.2 (24B, vision) | Mistral AI | 3.1/3.2 | Apache 2.0 | Yes | Yes | Yes | None | None | [mistral.ai/news/mistral-small-3-1](https://mistral.ai/news/mistral-small-3-1/) | 2026-09-11 |
| Devstral Small / Devstral-2-24B | Mistral AI | Small / 2 | Apache 2.0 | Yes | Yes | Yes | None | None | [mistral.ai/news/devstral](https://mistral.ai/news/devstral/), [devstral-2-vibe-cli](https://mistral.ai/news/devstral-2-vibe-cli/) | 2026-09-11 |
| Devstral-2-123B | Mistral AI | 2 | **"Modified MIT license"** — not plain MIT | Likely, but get legal sign-off before treating as equivalent to standard MIT | Unverified — read the modification text | Unverified | Unverified | Non-standard license text; do not assume it matches vanilla MIT rights | Mistral's own model page (exact modified-terms text not yet independently re-read line-by-line) | 2026-09-11 |
| Ministral-3 (3B/8B/14B, vision) | Mistral AI | 3 | Apache 2.0 | Yes | Yes | Yes | None | None | [mistral.ai/news/mistral-3](https://mistral.ai/news/mistral-3/) | 2026-09-11 |
| Gemma 3 (1B/4B/12B/27B) | Google | 3 | **Gemma Terms of Use** (custom, not Apache 2.0) | Yes | Yes, with conditions | Yes, must include full ToU + notices | Google may remotely restrict access it deems a policy violation | Binding Prohibited Use Policy (8 categories: illegal activity, professional malpractice, harassment, misinformation, automated high-stakes decisions, explicit content, IP infringement, abuse) | [ai.google.dev/gemma/terms](https://ai.google.dev/gemma/terms) | 2026-09-11 |
| **Gemma 4** (E2B/E4B/12B/26B-MoE/31B) — *released after Gemma 3, supersedes it* | Google | 4 | **Apache 2.0** (standard, unmodified — Google switched licenses) | Yes | Yes | Yes | None in the license text itself | Separate (non-incorporated) Prohibited-Use/Intended-Use pages still exist as guidance, not license terms | [ai.google.dev/gemma/apache_2](https://ai.google.dev/gemma/apache_2), [Google Open Source Blog, Mar 2026](https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html) | 2026-09-11 (independently confirmed via web search, not just the research agent) |
| Llama 3.1/3.2, Llama 4 (Scout/Maverick) | Meta | 3.1 / 3.2 / 4 | Llama Community License Agreement (per-version) | Yes, **unless >700M monthly active users** (then a separate license from Meta is required) | Yes, but any derivative model name must start with "Llama" | Yes, with mandatory "Built with Llama" attribution | 700M-MAU commercial gate (not relevant at Vikisol's scale) | Acceptable Use Policy (illegal activity, weapons, CSAM, fraud/disinformation, undisclosed AI use in some contexts) | [developer.meta.com/ai/llama4/license](https://developer.meta.com/ai/llama4/license/) | 2026-09-11 |
| **Muse Spark** *(Meta's proprietary successor to Llama, Apr 2026)* | Meta | Spark | Proprietary — private preview via API to select partners only | No public terms | N/A | N/A | Not publicly available | Not open-weight at all; noted for completeness since it explains Meta's roadmap shift | [VentureBeat](https://venturebeat.com/technology/goodbye-llama-meta-launches-new-proprietary-ai-model-muse-spark-first-since) | 2026-09-11 (independently confirmed via web search) |
| **Muse Glimmer** (30B, Aug 2026) — *Meta's return to open weights after Spark* | Meta | Glimmer | Apache 2.0 | Yes | Yes | Yes | None | No MAU gate, no "Built with Llama"-style attribution clause carried over | [The Register](https://www.theregister.com/ai-and-ml/2026/08/10/zuck-rekindles-open-weights-llama-drama-with-muse-glimmer/5285666) | 2026-09-11 (independently confirmed via web search) |
| Phi-4-mini (3.8B) / Phi-4 (14B) | Microsoft | 4 | MIT | Yes | Yes | Yes | None | None | [HF LICENSE, Phi-4-mini](https://huggingface.co/microsoft/Phi-4-mini-instruct/blob/main/LICENSE), [HF LICENSE, Phi-4](https://huggingface.co/microsoft/phi-4/blob/main/LICENSE) | 2026-09-11 |
| Granite 4 / 4.2 (350M–30B MoE) | IBM | 4 / 4.2 | Apache 2.0 | Yes | Yes | Yes | None | ISO 42001-certified, cryptographically signed checkpoints (supply-chain integrity); IBM's uncapped IP indemnification is a watsonx.ai platform benefit and likely does **not** extend to self-hosted GGUF weights run via Ollama — flag if indemnification is contractually relevant | [github.com/ibm-granite/granite-4.0-language-models/LICENSE](https://github.com/ibm-granite/granite-4.0-language-models/blob/main/LICENSE) | 2026-09-11 |

### Discrepancy caught during this research pass (worth keeping as a working example)

Two independent research passes disagreed about **Qwen2.5-VL-3B**: one (sourced from an Ollama
library page) called it Apache 2.0; a second (sourced directly from Qwen's own Hugging Face LICENSE
file) found it under the non-commercial **Qwen Research License**. The direct-source finding is the
one recorded above. **Lesson applied**: Ollama's library pages don't always surface per-size license
differences within a model family — the 7B sibling of this exact model really is Apache 2.0, only
the 3B carries the research-only license. Always verify per-size, per-source, exactly as the
governing directive requires.

## Specialized models

| Model | Category | Provider | License | Commercial use | Ollama/runtime availability | Memory (approx.) | Source | Verified |
|---|---|---|---|---|---|---|---|---|
| nomic-embed-text v1.5 | Embedding | Nomic AI | Apache 2.0 | Yes | Ollama library | ~0.3GB | [HF](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) | 2026-09-11 |
| mxbai-embed-large-v1 | Embedding | Mixedbread AI | Apache 2.0 | Yes | Ollama library | ~0.7–1.2GB | [HF](https://huggingface.co/mixedbread-ai/mxbai-embed-large-v1) | 2026-09-11 |
| BAAI bge-m3 | Embedding | BAAI | MIT | Yes | Ollama library | ~1.1GB (fp16) | [HF](https://huggingface.co/BAAI/bge-m3) | 2026-09-11 |
| Whisper (tiny → large-v3 / large-v3-turbo) | STT | OpenAI | MIT | Yes | Not Ollama — needs `whisper.cpp` (Core ML + Metal on Apple Silicon) or `faster-whisper` (CPU-only on Mac, no Metal backend) | 0.3GB (tiny) → 3.9GB (large-v3); turbo ~1.6–2GB | [GitHub LICENSE](https://github.com/openai/whisper/blob/main/LICENSE) | 2026-09-11 |
| Piper (TTS engine) | TTS | Rhasspy / OHF-Voice | MIT (archived Oct 2025 release) **or** GPL-3.0 (active fork, embeds GPL'd espeak-ng) | Yes, if pinned to the archived MIT release or run as an isolated process | Standalone runtime | <1GB | [rhasspy/piper LICENSE](https://github.com/rhasspy/piper/blob/master/LICENSE.md), [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) | 2026-09-11 |
| Kokoro-82M | TTS | hexgrad | Apache 2.0 | Yes | Standalone runtime | ~1–2GB | [HF](https://huggingface.co/hexgrad/Kokoro-82M) | 2026-09-11 |
| Coqui XTTS-v2 | TTS | Coqui (defunct) | **Coqui Public Model License 1.0 — non-commercial only** | **No.** Coqui Inc. shut down Jan 2024; no vendor exists to grant a commercial exception | Standalone runtime | ~2–4GB | [HF](https://huggingface.co/coqui/XTTS-v2), [coqui.ai/cpml](https://coqui.ai/cpml) | 2026-09-11 |
| Qwen2.5-VL-7B-Instruct | Vision / OCR | Alibaba | Apache 2.0 | Yes | Ollama library | ~6.0GB | (see general table above) | 2026-09-11 |
| Moondream2 | Vision / OCR | vikhyatk | Apache 2.0 | Yes | Ollama library | ~1.7GB | [HF](https://huggingface.co/vikhyatk/moondream2) | 2026-09-11 |
| LLaVA-1.5 | Vision | Community | Llama 2 Community License (base) + research-use README restriction | Encumbered — not a clean commercial pick | Ollama library | ~4.5GB (7B) | [GitHub](https://github.com/haotian-liu/LLaVA) | 2026-09-11 |

## What this document is not

Not a claim that any specialized model (embedding beyond what's already wired, STT, TTS, vision) is
installed or integrated today — see [JENNY_MODEL_FLEET.md](JENNY_MODEL_FLEET.md) for current status
vs. recommended vs. explicitly skipped, and [JENNY_LOCAL_MODEL_MATRIX.md](JENNY_LOCAL_MODEL_MATRIX.md)
for what's actually in the code registry right now.
