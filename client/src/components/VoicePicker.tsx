import { useEffect, useRef, useState } from "react";
import { Play, Volume2, VolumeX, X } from "lucide-react";
import { GEMINI_VOICES, type VoiceId } from "../lib/voices";
import { speak, speechSynthesisSupported } from "../lib/speak";

export function VoicePicker({
  voice,
  onChangeVoice,
  spokenRepliesEnabled,
  onToggleSpokenReplies,
}: {
  voice: VoiceId;
  onChangeVoice: (v: VoiceId) => void;
  spokenRepliesEnabled: boolean;
  onToggleSpokenReplies: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function preview(v: VoiceId) {
    setPreviewing(true);
    try {
      await speak("Hi, I'm JennySol. This is what I sound like.", v);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-jenny-raised ${
          spokenRepliesEnabled ? "text-jenny-gold" : "text-jenny-muted hover:text-jenny-text-2"
        }`}
        aria-label="Voice settings"
        title="Voice settings"
      >
        {spokenRepliesEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] animate-fade-in rounded-2xl border border-jenny-border bg-jenny-raised p-3 shadow-xl shadow-black/40"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-jenny-text-2">Voice</span>
            <button
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-jenny-muted hover:text-jenny-text-2"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          <label className="mb-3 flex items-center justify-between rounded-lg bg-jenny-raised-2 px-2.5 py-2 text-xs">
            <span className="text-jenny-text-3">Spoken replies</span>
            <button
              onClick={onToggleSpokenReplies}
              role="switch"
              aria-checked={spokenRepliesEnabled}
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                spokenRepliesEnabled ? "bg-jenny-gold" : "bg-jenny-faint"
              }`}
            >
              <span
                className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-jenny-text transition-transform ${
                  spokenRepliesEnabled ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>

          <div className="flex items-center gap-1.5">
            <select
              value={voice}
              onChange={(e) => onChangeVoice(e.target.value as VoiceId)}
              aria-label="Voice"
              className="min-w-0 flex-1 rounded-lg border border-jenny-border bg-jenny-surface px-2 py-1.5 text-base text-jenny-text sm:text-xs"
            >
              {speechSynthesisSupported && <option value="browser">Device voice (instant)</option>}
              <optgroup label="Natural voices">
                {GEMINI_VOICES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              onClick={() => preview(voice)}
              disabled={previewing}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-jenny-gold text-jenny-ink-on-gold disabled:opacity-50"
              aria-label="Preview this voice"
              title="Hear a preview"
            >
              <Play size={13} className={previewing ? "animate-pulse" : ""} />
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-jenny-muted">
            Natural voices sound more lifelike but take a moment to start. The device voice is instant but
            more robotic — pick whichever fits.
          </p>
        </div>
      )}
    </div>
  );
}
