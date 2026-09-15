import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconArrowUpRight, IconCalendar, IconHierarchy2, IconMicrophone, IconSearch, IconSettings } from "@tabler/icons-react";
import { useAuth } from "../../lib/AuthContext";
import { Orb } from "../../components/orb/Orb";
import { PENDING_FIRST_MESSAGE_KEY } from "../../lib/storageKeys";

// JENNYSOL-UI-BUILD.md §4 "First run" — a real, static, interactive screen
// (not JennySolIntro.tsx's old auto-dismissing cinematic overlay it
// replaces). Whatever the user taps here — a suggestion row or their own
// typed line — becomes the actual first message sent in chat: stored under
// PENDING_FIRST_MESSAGE_KEY, read once by ChatWindow on mount, exactly the
// same "hand off through sessionStorage, read once" shape ACTIVE_CONVERSATION_KEY
// already uses for a different value.
const SUGGESTIONS = [
  { icon: IconSearch, label: "Look something up for me" },
  { icon: IconHierarchy2, label: "Run a task with my agents" },
  { icon: IconCalendar, label: "What do I have tomorrow?" },
];

export function FirstRun() {
  const { user, dismissWelcome } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const firstName = (user?.name || "").trim().split(/\s+/)[0] || "there";

  function enterChat(message?: string) {
    if (message?.trim()) {
      try {
        sessionStorage.setItem(PENDING_FIRST_MESSAGE_KEY, message.trim());
      } catch {
        // storage unavailable — the message is simply not pre-filled, chat still opens
      }
    }
    dismissWelcome();
    navigate("/");
  }

  return (
    <div className="flex h-[var(--app-vh)] flex-col overflow-y-auto bg-jenny-void text-jenny-text">
      <div className="flex shrink-0 items-center justify-between px-5 pt-[calc(1.1rem+env(safe-area-inset-top))]">
        <span className="text-[10px] tracking-[0.3em] text-jenny-muted">JENNYSOL</span>
        <IconSettings size={17} className="text-jenny-muted" />
      </div>

      <div className="px-5 pt-7">
        <Orb state="thinking" size="lg" />
        <p className="mt-5 text-[10px] tracking-[0.3em] text-jenny-gold">FIRST TIME HERE</p>
        <p className="mt-1 font-voice text-[26px] leading-[1.26] text-jenny-text">
          Hello {firstName}.
          <br />
          What are you
          <br />
          working on?
        </p>
        <div className="mt-4 h-px w-8 bg-jenny-gold" />
        <p className="mt-4 text-[13px] leading-relaxed text-jenny-muted">Ask me anything, or try one of these.</p>
      </div>

      <div className="mt-5 flex flex-col gap-2 px-4">
        {SUGGESTIONS.map(({ icon: Icon, label }) => (
          <button
            key={label}
            onClick={() => enterChat(label)}
            className="flex items-center gap-3 rounded-2xl bg-jenny-raised px-3.5 py-3.5 text-left"
          >
            <Icon size={19} className="shrink-0 text-jenny-text-3" />
            <span className="flex-1 text-[14px] text-jenny-text-2">{label}</span>
            <IconArrowUpRight size={16} className="shrink-0 text-jenny-faint" />
          </button>
        ))}
      </div>

      <div className="mt-auto flex shrink-0 items-center gap-2.5 px-4 pb-[calc(1.1rem+env(safe-area-inset-bottom))] pt-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) enterChat(input);
          }}
          className="flex-1 rounded-full bg-jenny-raised px-4 py-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Jenny"
            className="w-full bg-transparent text-[14px] text-jenny-text outline-none placeholder:text-jenny-dim"
          />
        </form>
        <button
          onClick={() => enterChat()}
          aria-label="Start talking to Jenny"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-jenny-gold text-jenny-ink-on-gold"
        >
          <IconMicrophone size={18} />
        </button>
      </div>
    </div>
  );
}
