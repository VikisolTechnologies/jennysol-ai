# Access needed (consolidated, ask once)

| Item | Needed for | Status | Monthly cost |
|---|---|---|---|
| `JennySol_End_to_End_Execution_Plan.docx` | Confirming this run's scope/sequence against the founder-approved master plan | Not found anywhere in `jennysol-ai`, `docs/`, or attached to this session. Proceeding from `VIKISOL-MASTER-CONTEXT.md` §6.12/6.13 as the best available proxy — it appears to already summarize the plan's roadmap and DoD. | — |
| `DEEPSEEK_API_KEY` (production) | A real second chat provider, so Jenny isn't "temporarily unavailable" on a single Gemini hiccup | Not set. Recommended — cheap. | Low (usage-based, no evidence of a paid tier requirement) |
| `ANTHROPIC_API_KEY` (production) | Enabling the existing Claude tiering for Jenny | Not set, and **deliberately not being enabled** per Hard Limit #6 without explicit approval | Paid, size depends on volume — not enabling, so not estimating further this run |
| `FAL_KEY` (production) | Paid image-generation fallback | Not set | Paid |
| Local image worker token + a second Tailscale/railtail forward to the Mac's port 8789 | Free local image generation (Z-Image-Turbo) | Built (`localImageWorker.ts`) but not wired into production — outside this mission's scope (JennySol's chat/agent side), not touching it this run | Free |

Nothing above is blocking this run — see `BLOCKERS.md` for what's actually stuck.
