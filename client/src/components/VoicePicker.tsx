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
        className={`rounded-lg p-2 transition hover:bg-neutral-100 dark:hover:bg-white/10 ${
          spokenRepliesEnabled ? "text-brand-500" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200"
        }`}
        aria-label="Voice settings"
        title="Voice settings"
      >
        {spokenRepliesEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-40 mt-2 w-72 animate-fade-in rounded-2xl border border-neutral-200 bg-white p-3 shadow-xl dark:border-white/10 dark:bg-neutral-900"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">Voice</span>
            <button
              onClick={() => setOpen(false)}
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          <label className="mb-3 flex items-center justify-between rounded-lg bg-neutral-50 px-2.5 py-2 text-xs dark:bg-white/5">
            <span className="text-neutral-600 dark:text-neutral-300">Spoken replies</span>
            <button
              onClick={onToggleSpokenReplies}
              role="switch"
              aria-checked={spokenRepliesEnabled}
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                spokenRepliesEnabled ? "bg-brand-gradient" : "bg-neutral-300 dark:bg-white/20"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                  spokenRepliesEnabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>

          <div className="flex items-center gap-1.5">
            <select
              value={voice}
              onChange={(e) => onChangeVoice(e.target.value as VoiceId)}
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-white/10 dark:bg-white/5 dark:text-neutral-100"
            >
              {speechSynthesisSupported && <option value="browser">Browser default (free, instant)</option>}
              <optgroup label="Gemini voices">
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
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white disabled:opacity-50"
              aria-label="Preview this voice"
              title="Hear a preview"
            >
              <Play size={13} className={previewing ? "animate-pulse" : ""} />
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-neutral-400">
            Gemini voices sound more natural but need a network round-trip. Browser default is
            instant and free but robotic — pick whichever fits.
          </p>
        </div>
      )}
    </div>
  );
}
