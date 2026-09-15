import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconArrowLeft, IconLock } from "@tabler/icons-react";
import { getStoredSpokenReplies, storeSpokenReplies } from "../../lib/voices";
import { fetchProviderHealth, type ProviderRouteStatus, type ProviderStats } from "../../lib/admin";

// JENNYSOL-UI-BUILD.md §6.7 "Settings" — Routing / Voice / Autonomy /
// Privacy groups. Real, not a mockup of controls that don't do anything:
// - Routing is read-only (the real provider-health data from the Providers
//   screen), not editable — mutating the provider chain from a settings
//   toggle is explicitly out of scope (§11, "no model fleet changes"), and
//   a toggle that silently does nothing would be worse than not having one.
// - Voice's spoken-replies toggle is real and persists (lib/voices.ts).
// - Autonomy: "approve every write" renders LOCKED per spec — this is
//   already the system's real, only behavior (agentToolRegistry.ts has no
//   code path that skips the approval gate), not a claim this page invents.
// - Privacy restates AccountPrivacy.tsx's own already-honest copy rather
//   than duplicating a second, possibly-drifting source of truth.
export function Settings() {
  const navigate = useNavigate();
  const [spokenReplies, setSpokenReplies] = useState(getStoredSpokenReplies);
  const [providers, setProviders] = useState<(ProviderRouteStatus & { health: (ProviderStats & { healthy: boolean }) | null })[] | null>(null);

  useEffect(() => {
    fetchProviderHealth()
      .then((h) => setProviders(h.providers))
      .catch(() => {
        // Non-admin users can't reach this (401/403) — Routing simply shows
        // "not available" below rather than an error banner for the common,
        // expected case of a regular account viewing their own settings.
      });
  }, []);

  return (
    <div className="flex h-[var(--app-vh)] flex-col overflow-y-auto bg-jenny-void text-jenny-text">
      <div className="flex shrink-0 items-center gap-3 px-5 pt-[calc(1.1rem+env(safe-area-inset-top))]">
        <button onClick={() => navigate("/")} className="flex h-9 w-9 items-center justify-center rounded-full text-jenny-muted" aria-label="Back to chat">
          <IconArrowLeft size={18} />
        </button>
        <p className="font-voice text-xl text-jenny-text">Settings</p>
      </div>

      <div className="flex flex-col gap-6 px-5 py-6">
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-jenny-gold">Routing</h2>
          <div className="rounded-2xl bg-jenny-raised p-4">
            {providers === null ? (
              <p className="text-xs text-jenny-dim">Only visible to admin accounts on this deployment.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {providers.map((p) => (
                  <li key={p.name} className="flex items-center justify-between text-sm">
                    <span className="text-jenny-text-2">{p.name}</span>
                    <span className="text-xs text-jenny-dim">
                      {!p.configured ? "not configured" : p.inActiveChain ? "in chain" : "not in chain"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-jenny-faint">
              Read-only — changing which model answers your questions isn&rsquo;t a per-user setting on this
              deployment.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-jenny-gold">Voice</h2>
          <div className="rounded-2xl bg-jenny-raised p-4">
            <label className="flex items-center justify-between">
              <span className="text-sm text-jenny-text-2">Speak replies out loud</span>
              <button
                type="button"
                role="switch"
                aria-checked={spokenReplies}
                onClick={() => {
                  const next = !spokenReplies;
                  setSpokenReplies(next);
                  storeSpokenReplies(next);
                }}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${spokenReplies ? "bg-jenny-gold" : "bg-jenny-raised-2"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-jenny-text transition-transform ${spokenReplies ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </label>
            <p className="mt-2 text-[11px] text-jenny-faint">
              When on, a typed or spoken question gets a spoken answer too. The voice itself is picked from the
              speaker icon in chat.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-jenny-gold">Autonomy</h2>
          <div className="rounded-2xl bg-jenny-raised p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-jenny-text-2">Approve every write</span>
              <span className="flex items-center gap-1.5 rounded-full bg-jenny-raised-2 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-jenny-muted">
                <IconLock size={11} /> Locked
              </span>
            </div>
            <p className="mt-2 text-[11px] text-jenny-faint">
              Not a toggle by design — every file write or command an agent proposes waits for your explicit
              approval, one at a time, with no setting that turns it off.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-jenny-gold">Privacy</h2>
          <div className="rounded-2xl bg-jenny-raised p-4 text-sm text-jenny-text-3">
            <p>
              Voice input is transcribed, then discarded — no audio is stored. Conversations and uploaded files
              are scoped to your account only.
            </p>
            <button onClick={() => navigate("/account/privacy")} className="mt-2 text-xs font-medium text-jenny-champagne underline">
              Full privacy details →
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
