import { useNavigate } from "react-router-dom";
import { IconCheck, IconMicrophone } from "@tabler/icons-react";
import { Orb } from "../../components/orb/Orb";

// JENNYSOL-UI-BUILD.md §5 — asked once, in her voice, skippable, stating
// plainly what happens to the audio. The primary action requests the real
// native browser permission directly (never "go check your settings"
// unless it was already hard-denied). Declining leaves the product fully
// usable by typing — both buttons below lead to the exact same next screen.
export function MicPermission() {
  const navigate = useNavigate();

  async function requestAndContinue() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Only asking, not listening yet — release the mic immediately. The
      // real permission grant/denial is now recorded by the browser either
      // way, which is the only outcome this screen exists to produce.
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Denied, or no device — declining is a real, supported path (see
      // this component's own header comment), so this is not an error state.
    }
    navigate("/first-run");
  }

  return (
    <div className="flex h-[var(--app-vh)] flex-col overflow-y-auto bg-jenny-void px-6 text-center text-jenny-text">
      <div className="mt-[calc(1.1rem+env(safe-area-inset-top))] flex justify-end">
        <button onClick={() => navigate("/first-run")} className="text-[13px] text-jenny-muted">
          Skip
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        <Orb state="listening" size="xl" />
        <p className="mt-8 font-voice text-[27px] leading-[1.22] text-jenny-text">
          Can I listen
          <br />
          when you tap?
        </p>
        <div className="mt-5 h-px w-8 bg-jenny-gold" />

        <div className="mt-8 w-full max-w-sm space-y-2.5 text-left">
          {[
            "Only when you tap the mic — never in the background",
            "Transcribed, then discarded. No audio is kept",
            "Off again any time, one tap in Settings",
          ].map((line) => (
            <div key={line} className="flex items-start gap-2.5 rounded-2xl bg-jenny-raised px-3.5 py-3">
              <IconCheck size={16} className="mt-0.5 shrink-0 text-jenny-ok" />
              <p className="text-[13px] leading-relaxed text-jenny-text-3">{line}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto mb-[calc(1.7rem+env(safe-area-inset-bottom))] w-full max-w-sm">
        <button
          onClick={requestAndContinue}
          className="mb-2.5 flex w-full items-center justify-center gap-2 rounded-full bg-jenny-text py-3.5 text-[14px] font-medium text-jenny-void"
        >
          <IconMicrophone size={16} />
          Allow microphone
        </button>
        <button onClick={() => navigate("/first-run")} className="w-full py-2 text-[13px] text-jenny-muted">
          Not now — I&rsquo;ll type
        </button>
      </div>
    </div>
  );
}
