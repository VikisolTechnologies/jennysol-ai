import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  IconEar,
  IconEarOff,
  IconHistory,
  IconMessage,
  IconMicrophone,
  IconMicrophoneOff,
  IconPhoto,
  IconPlayerPause,
  IconPlayerStop,
  IconSend,
  IconSettings,
  IconSquarePlus,
  IconX,
} from "@tabler/icons-react";
import {
  cancelChatRun,
  fetchActiveRuns,
  fetchConversationMessages,
  fetchRun,
  generateImage,
  sendChatMessage,
  type ChatTurn,
  type GeneratedImage,
  type Source,
} from "../lib/api";
import { MessageBubble } from "./MessageBubble";
import { VoicePicker } from "./VoicePicker";
import { VoiceOrb, type OrbState } from "./VoiceOrb";
import { useSpeechRecognition } from "../lib/useSpeechRecognition";
import { useVoiceConversation } from "../lib/useVoiceConversation";
import { useKeyboardOpen } from "../lib/useKeyboardOpen";
import { speak, stopSpeaking } from "../lib/speak";
import { getStoredVoice, getStoredSpokenReplies, storeSpokenReplies, storeVoice, type VoiceId } from "../lib/voices";
import { PENDING_FIRST_MESSAGE_KEY } from "../lib/storageKeys";

interface DisplayMessage extends ChatTurn {
  sources?: Source[];
  image?: GeneratedImage;
  imageLoading?: boolean;
}

const SUGGESTIONS = [
  "Summarize the documents I've uploaded",
  "What are the key points I should know?",
  "Explain this in simple terms",
];

// JENNYSOL-UI-BUILD.md §6.1's "eyebrow showing the provider and response
// time" — real data (server/src/services/agentRunStore.ts's own `provider`
// and start/complete timestamps on every AgentRun), not a design flourish:
// fetched once per completed turn via fetchRun, since the SSE stream itself
// only ever carries sources on `done` (see lib/api.ts's ChatStreamHandlers).
function formatProvider(provider: string | null): string {
  if (!provider) return "LOCAL";
  return provider.toUpperCase();
}
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}S`;
}
// A real, computed greeting for a brand-new conversation that has no title
// yet — not a fabricated "session name", the actual current weekday and
// time of day, matching the mockup's "Tuesday evening" register.
function timeOfDayGreeting(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  const hour = now.getHours();
  const part = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
  return `${weekday} ${part}`;
}

export function ChatWindow({
  onOpenSidebar,
  onNewChat,
  conversationId,
  onConversationChange,
  onRequestAuthGate,
}: {
  onOpenSidebar: () => void;
  onNewChat: () => void;
  conversationId: string | null;
  onConversationChange: (id: string) => void;
  onRequestAuthGate: () => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Text shown next to the "thinking" dots while the last assistant message
  // is still empty — null once real content starts streaming. Distinguishes
  // "server hasn't even acknowledged the request yet" from "acknowledged,
  // taking longer than usual" from "connection dropped, trying to recover
  // what the server already generated" — see handleSend/recoverRun below.
  const [sendingStatus, setSendingStatus] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState(false);
  const [spokenReplies, setSpokenRepliesState] = useState(getStoredSpokenReplies);
  const [voice, setVoiceState] = useState<VoiceId>(getStoredVoice);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [lastTurnMeta, setLastTurnMeta] = useState<{ provider: string; ms: number } | null>(null);
  const navigate = useNavigate();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const keyboardOpen = useKeyboardOpen();

  // Lets the empty-state hero shrink away instead of hard-unmounting the
  // instant the first message lands (see the render below) — "visible" for
  // an empty conversation, "collapsing" for one CSS transition's worth of
  // time right after the first message, then "gone" so nothing keeps
  // animating (the orb's idle glow, specifically) once it's off-screen.
  // Returning to an existing conversation (messages already populated on
  // mount/switch) skips straight to "gone" — no cinematic hero for that
  // case, matching a fresh empty conversation always starting at "visible".
  const [heroPhase, setHeroPhase] = useState<"visible" | "collapsing" | "gone">(
    messages.length === 0 ? "visible" : "gone"
  );
  useEffect(() => {
    if (messages.length === 0) {
      setHeroPhase("visible");
      return;
    }
    if (heroPhase === "visible") {
      setHeroPhase("collapsing");
      const t = setTimeout(() => setHeroPhase("gone"), 420);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Tracks which conversation `messages` currently reflects, so the
  // load-on-switch effect below can tell "the sidebar picked a different
  // chat" (needs a fetch) apart from "we just created this chat ourselves
  // mid-send" (already have the messages, fetching again would be wasted
  // and could race the in-flight stream).
  const loadedIdRef = useRef<string | null>(null);

  // Bumped whenever the visible conversation changes (switch or New chat) or
  // a fresh send starts. An in-flight request's callbacks compare their
  // captured value against this before touching `messages` — if the user
  // has since navigated away (e.g. clicked New chat mid-stream), the old
  // request's late-arriving deltas become no-ops instead of corrupting
  // whatever's now on screen (or crashing on an emptied array).
  const generationRef = useRef(0);

  // The durable AgentRun id for whatever's currently generating, captured
  // from the run.started event the instant the server acknowledges the
  // request — this is what recoverRun polls if the SSE connection itself
  // dies mid-stream, and what the resume-on-load effect below looks for
  // when switching into a conversation that has a run still in flight.
  const currentRunIdRef = useRef<string | null>(null);

  function setVoice(v: VoiceId) {
    setVoiceState(v);
    storeVoice(v);
  }

  function setSpokenReplies(enabled: boolean) {
    setSpokenRepliesState(enabled);
    storeSpokenReplies(enabled);
  }

  const speech = useSpeechRecognition((transcript) => {
    setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    requestAnimationFrame(autoResize);
  });

  // Continuous voice conversation — clicking the button starts LISTENING
  // directly (no wake phrase needed, since clicking already is the explicit
  // activation); "Hey Jenny" stays available as an opt-in hands-free entry
  // point. See useVoiceConversation.ts for the full state machine. Commands
  // heard this way always go to chat (never image mode) and are always
  // spoken back regardless of the spokenReplies toggle, since a spoken
  // question implies a spoken answer. The second argument wires real voice
  // barge-in: talking over Jenny while she's speaking stops her immediately.
  const voiceConv = useVoiceConversation(
    (transcript) => handleSend(transcript, true),
    () => stopSpeaking()
  );

  const lastMessage = messages[messages.length - 1];
  const orbState: OrbState = assistantSpeaking
    ? "speaking"
    : sending
      ? lastMessage?.imageLoading
        ? "tool"
        : "thinking"
      : voiceConv.state === "listening"
        ? "listening"
        : voiceConv.state === "sleeping"
          ? "sleeping"
          : voiceConv.state === "paused"
            ? "paused"
            : "idle";

  function handleInterrupt() {
    stopSpeaking(); // resolves the in-flight speak() promise too, so playback state never gets stuck
  }

  useEffect(() => {
    if (conversationId === loadedIdRef.current) return;
    loadedIdRef.current = conversationId;
    generationRef.current++;
    const myGeneration = generationRef.current;
    setSending(false); // any in-flight request now belongs to a generation nothing here cares about
    setSendingStatus(null);
    currentRunIdRef.current = null;
    if (!conversationId) {
      setMessages([]);
      return;
    }
    fetchConversationMessages(conversationId)
      .then(async (msgs) => {
        if (generationRef.current !== myGeneration) return;
        setMessages(msgs);

        // The conversation just loaded (fresh mount, or the sidebar switched
        // into it) might have a run still generating server-side — e.g. the
        // browser was closed mid-reply and just reopened. Recover it instead
        // of silently showing a conversation that looks "done" when Jenny is
        // still actually working on the last turn.
        const active = await fetchActiveRuns().catch(() => []);
        if (generationRef.current !== myGeneration) return;
        const runForThisConversation = active.find(
          (r) => r.conversationId === conversationId && (r.status === "queued" || r.status === "running" || r.status === "streaming")
        );
        if (runForThisConversation) {
          currentRunIdRef.current = runForThisConversation.id;
          setMessages((prev) => [...prev, { role: "assistant", content: runForThisConversation.responseText }]);
          setSending(true);
          setSendingStatus("Reconnecting to Jenny’s in-progress reply…");
          await recoverRun(runForThisConversation.id, myGeneration, true);
        }
      })
      .catch(() => setMessages([]));
  }, [conversationId]);

  // Real opening message from pages/jennysol/FirstRun.tsx — read once, only
  // for a genuinely fresh/empty conversation (never overwrites an existing
  // one the sidebar just switched into), and only once per browser tab
  // (removeItem below) so navigating back to "/" later never resends it.
  useEffect(() => {
    if (conversationId) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_FIRST_MESSAGE_KEY);
      if (pending) sessionStorage.removeItem(PENDING_FIRST_MESSAGE_KEY);
    } catch {
      return;
    }
    if (pending) void handleSend(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polls a run's durable state until it finishes, applying the result once
  // it does. Used both when the live SSE stream itself dies mid-request
  // (handleSend's catch block) and when resuming a run that was already in
  // flight when this conversation was loaded (the effect above) — same
  // recovery path either way, since in both cases the browser has no live
  // connection to the generation and has to ask what happened instead.
  async function recoverRun(runId: string, myGeneration: number, alreadyHasPlaceholder: boolean): Promise<boolean> {
    const delays = [1000, 1500, 2000, 3000, 3000, 3000]; // ~13.5s of polling before giving up
    for (const delay of delays) {
      await new Promise((r) => setTimeout(r, delay));
      if (generationRef.current !== myGeneration) return true; // navigated away — nothing left to update

      const run = await fetchRun(runId).catch(() => null);
      if (!run) continue;

      if (run.status === "completed" || run.status === "failed") {
        setSending(false);
        setSendingStatus(null);
        currentRunIdRef.current = null;
        applyRunMeta(run);
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy.length - 1;
          if (last < 0 || !alreadyHasPlaceholder) return prev;
          copy[last] =
            run.status === "completed"
              ? { role: "assistant", content: run.responseText, sources: run.sources ?? undefined }
              : { role: "assistant", content: run.error || "Something went wrong answering that." };
          return copy;
        });
        return true;
      }
      // still queued/running/streaming — reflect whatever's streamed so far
      // (agent_runs.response_text) and keep polling.
      if (run.responseText) {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy.length - 1;
          if (last < 0) return prev;
          copy[last] = { ...copy[last], content: run.responseText };
          return copy;
        });
      }
    }
    return false;
  }

  // Real provider + response time for the header eyebrow (§6.1) — best
  // effort: a failure here just means the eyebrow doesn't update for this
  // turn, never blocks or delays showing the reply itself.
  function applyRunMeta(run: { provider: string | null; startedAt: string; completedAt: string | null }) {
    if (!run.completedAt) return;
    const started = new Date(run.startedAt.replace(" ", "T") + "Z").getTime();
    const completed = new Date(run.completedAt.replace(" ", "T") + "Z").getTime();
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return;
    setLastTurnMeta({ provider: formatProvider(run.provider), ms: completed - started });
  }

  // Covers the specific scenario the latency audit called out: the user
  // backgrounds the app mid-reply (switches apps on iPhone, switches
  // browser tabs) and returns. iOS Safari can suspend JS execution for a
  // backgrounded tab without ever surfacing a network error to the fetch
  // stream reader — so handleSend's own catch-and-recover path may simply
  // never fire even though the connection has effectively gone stale. This
  // reconciles proactively the instant the tab becomes visible again,
  // rather than trusting a stream that might silently never resolve.
  useEffect(() => {
    function reconcileOnReturn() {
      if (document.visibilityState !== "visible") return;
      if (!sending || !currentRunIdRef.current) return;
      const runId = currentRunIdRef.current;
      const myGeneration = generationRef.current;
      fetchRun(runId)
        .then((run) => {
          if (!run || generationRef.current !== myGeneration) return;
          // Still genuinely in progress server-side — leave the existing
          // stream/poll loop alone, nothing to reconcile yet.
          if (run.status === "queued" || run.status === "running" || run.status === "streaming") return;
          setSending(false);
          setSendingStatus(null);
          currentRunIdRef.current = null;
          applyRunMeta(run);
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy.length - 1;
            if (last < 0) return prev;
            copy[last] =
              run.status === "completed"
                ? { role: "assistant", content: run.responseText, sources: run.sources ?? undefined }
                : { role: "assistant", content: run.error || "Something went wrong answering that." };
            return copy;
          });
        })
        .catch(() => {});
    }
    document.addEventListener("visibilitychange", reconcileOnReturn);
    window.addEventListener("pageshow", reconcileOnReturn);
    return () => {
      document.removeEventListener("visibilitychange", reconcileOnReturn);
      window.removeEventListener("pageshow", reconcileOnReturn);
    };
  }, [sending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => stopSpeaking(), []);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function handleVoiceConvButtonClick() {
    if (voiceConv.state === "off") voiceConv.start();
    else if (voiceConv.state === "paused") voiceConv.resume();
    else voiceConv.pause();
  }

  async function handleSendImage(prompt: string) {
    const myGeneration = generationRef.current;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: prompt },
      { role: "assistant", content: "", imageLoading: true },
    ]);
    setInput("");
    requestAnimationFrame(autoResize);
    setSending(true);

    try {
      const image = await generateImage(prompt);
      if (generationRef.current !== myGeneration) return;
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: prompt, image };
        return copy;
      });
    } catch (err) {
      if (generationRef.current !== myGeneration) return;
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: err instanceof Error ? err.message : "Image generation failed.",
        };
        return copy;
      });
    } finally {
      if (generationRef.current === myGeneration) setSending(false);
    }
  }

  async function handleSend(text = input.trim(), forceSpeak = false) {
    if (!text || sending) return;
    if (imageMode) return handleSendImage(text);

    const myGeneration = generationRef.current;
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setInput("");
    requestAnimationFrame(autoResize);
    setSending(true);
    setSendingStatus(null);
    currentRunIdRef.current = null;

    let fullText = "";
    let capturedRunId: string | null = null;

    // Escalating status text while the bubble is still empty — distinct
    // messaging for "slower than usual" vs. "unusually slow", rather than
    // one indefinite spinner with no explanation. Cleared the moment real
    // content starts arriving (see onDelta below) or the request settles.
    const stillWorkingTimer = setTimeout(() => {
      if (generationRef.current === myGeneration) setSendingStatus("Still working…");
    }, 8_000);
    const takingLongerTimer = setTimeout(() => {
      if (generationRef.current === myGeneration) {
        setSendingStatus("This is taking longer than expected — I'm still working on it.");
      }
    }, 20_000);
    function clearStatusTimers() {
      clearTimeout(stillWorkingTimer);
      clearTimeout(takingLongerTimer);
    }

    try {
      await sendChatMessage(text, loadedIdRef.current, {
        onRunStarted: ({ runId, conversationId: id }) => {
          if (generationRef.current !== myGeneration) return;
          capturedRunId = runId;
          currentRunIdRef.current = runId;
          if (loadedIdRef.current !== id) {
            loadedIdRef.current = id;
            onConversationChange(id);
          }
        },
        onStatus: (status) => {
          if (generationRef.current !== myGeneration) return;
          // Only touch the hint while nothing's streamed yet — once
          // content exists the dots/label aren't shown at all (see
          // MessageBubble), so this would be a no-op anyway, but skipping
          // it avoids fighting the still-working timers above near the
          // 8s/20s marks.
          if (!fullText) setSendingStatus(status === "streaming" ? null : "Thinking…");
        },
        onDelta: (delta) => {
          if (generationRef.current !== myGeneration) return;
          clearStatusTimers();
          setSendingStatus(null);
          fullText += delta;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              ...copy[copy.length - 1],
              content: copy[copy.length - 1].content + delta,
            };
            return copy;
          });
        },
        onGuestProgress: ({ nudge }) => {
          if (generationRef.current !== myGeneration) return;
          // Purely a courtesy nag — the message this arrived alongside is
          // already generating normally, so this never touches sending
          // state, never rolls anything back, and the modal it opens is
          // freely dismissible without losing the reply in progress.
          if (nudge) onRequestAuthGate();
        },
        onDone: (sources) => {
          if (generationRef.current !== myGeneration) return;
          clearStatusTimers();
          setSending(false);
          setSendingStatus(null);
          currentRunIdRef.current = null;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { ...copy[copy.length - 1], sources };
            return copy;
          });
          if (capturedRunId) void fetchRun(capturedRunId).then((run) => run && applyRunMeta(run));
          if (spokenReplies || forceSpeak) {
            voiceConv.notifySpeakingStart();
            setAssistantSpeaking(true);
            speak(fullText, voice).finally(() => {
              voiceConv.notifySpeakingEnd();
              setAssistantSpeaking(false);
            });
          }
        },
        onCancelled: () => {
          if (generationRef.current !== myGeneration) return;
          clearStatusTimers();
          setSending(false);
          setSendingStatus(null);
          currentRunIdRef.current = null;
          // Whatever text streamed before cancellation stays exactly as-is
          // — not an error, not rolled back, just stops waiting for more.
        },
      });
    } catch (err) {
      if (generationRef.current !== myGeneration) return;
      clearStatusTimers();

      // The connection died, but the run itself keeps generating
      // server-side regardless (see chatRunner.ts / the latency audit's own
      // finding that a dropped connection doesn't stop or lose the reply).
      // Try to recover it via its runId before showing a hard failure.
      if (capturedRunId) {
        setSendingStatus("Reconnecting…");
        const recovered = await recoverRun(capturedRunId, myGeneration, true);
        if (recovered) return;
      }

      setSending(false);
      setSendingStatus(null);
      currentRunIdRef.current = null;
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: err instanceof Error ? err.message : "Something went wrong reaching the server.",
        };
        return copy;
      });
    }
  }

  // Cancels exactly the one run in flight for this ChatWindow instance —
  // server-side (see cancelChatRun/agentRuns.ts's /cancel route) this only
  // ever touches that one runId's own AbortController, so it has no effect
  // on any other run, including ones from other tabs/conversations.
  function handleCancel() {
    const runId = currentRunIdRef.current;
    if (!runId) return;
    void cancelChatRun(runId);
  }

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-jenny-surface">
      <header className="relative flex shrink-0 flex-col gap-4 border-b border-jenny-hairline bg-jenny-surface/95 px-4 pb-4 pt-[calc(0.9rem+env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={onOpenSidebar}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-jenny-muted hover:bg-jenny-raised md:hidden"
              aria-label="Open sidebar"
            >
              <IconHistory size={19} />
            </button>
            <span className="text-[11px] tracking-[0.3em] text-jenny-muted">JENNYSOL</span>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button
              onClick={onNewChat}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-jenny-muted hover:bg-jenny-raised md:hidden"
              aria-label="New chat"
              title="New chat"
            >
              <IconSquarePlus size={18} />
            </button>
            {voiceConv.supported ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleVoiceConvButtonClick}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    voiceConv.state === "listening"
                      ? "bg-jenny-bad text-jenny-void"
                      : voiceConv.state === "sleeping"
                        ? "bg-jenny-gold text-jenny-ink-on-gold"
                        : voiceConv.state === "paused"
                          ? "bg-jenny-warn text-jenny-ink-on-gold"
                          : "text-jenny-muted hover:bg-jenny-raised hover:text-jenny-text-2"
                  }`}
                  aria-label={
                    voiceConv.state === "off"
                      ? "Start talking to Jenny"
                      : voiceConv.state === "paused"
                        ? "Resume voice conversation"
                        : "Pause voice conversation"
                  }
                  title={
                    voiceConv.state === "off"
                      ? "Tap to start talking — no wake word needed"
                      : voiceConv.state === "sleeping"
                        ? "Listening for “Hey Jenny”…"
                        : voiceConv.state === "listening"
                          ? "Listening — click to pause, or just talk over Jenny to interrupt her"
                          : "Paused — click to resume"
                  }
                >
                  {voiceConv.state === "paused" ? (
                    <IconPlayerPause size={14} />
                  ) : voiceConv.state === "off" ? (
                    <IconEarOff size={14} />
                  ) : (
                    <IconEar size={14} className={voiceConv.state === "listening" ? "animate-pulse" : ""} />
                  )}
                  <span className="hidden sm:inline">
                    {voiceConv.state === "off"
                      ? "Talk to Jenny"
                      : voiceConv.state === "sleeping"
                        ? "Hey Jenny"
                        : voiceConv.state === "listening"
                          ? "Listening…"
                          : "Paused"}
                  </span>
                </button>
                {voiceConv.state !== "off" && (
                  <button
                    onClick={voiceConv.stop}
                    className="rounded-lg p-2 text-jenny-dim transition hover:bg-jenny-raised hover:text-jenny-text-3"
                    aria-label="End voice conversation"
                    title="End voice conversation"
                  >
                    <IconX size={14} />
                  </button>
                )}
              </div>
            ) : (
              // Previously this whole block just didn't render when the
              // browser has no Web Speech API (Firefox, some in-app/webview
              // browsers) — the voice feature silently vanished with nothing
              // explaining why. Showing a disabled button with a real reason
              // beats a feature that just isn't there.
              <button
                disabled
                className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-jenny-faint"
                aria-label="Voice isn't supported in this browser"
                title="Voice isn't supported in this browser — try Chrome, Edge, or Safari"
              >
                <IconEarOff size={14} />
                <span className="hidden sm:inline">Voice unavailable</span>
              </button>
            )}
            <VoicePicker
              voice={voice}
              onChangeVoice={setVoice}
              spokenRepliesEnabled={spokenReplies}
              onToggleSpokenReplies={() => {
                if (spokenReplies) stopSpeaking();
                setSpokenReplies(!spokenReplies);
              }}
            />
            <button
              onClick={() => navigate("/settings")}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-jenny-muted transition hover:bg-jenny-raised hover:text-jenny-text-2"
              aria-label="Settings"
              title="Settings"
            >
              <IconSettings size={16} />
            </button>
          </div>
        </div>

        {/* §6.1 — eyebrow (provider + response time of the last real turn)
            and a serif session title, gold rule beneath. Only appears once
            there's something real to show (heroPhase !== "visible" means at
            least one message exists) — no placeholder eyebrow on a truly
            empty chat. */}
        {heroPhase !== "visible" && (
          <div>
            {lastTurnMeta && (
              <p className="text-[10px] tracking-[0.25em] text-jenny-gold">
                {lastTurnMeta.provider} · {formatSeconds(lastTurnMeta.ms)}
              </p>
            )}
            <p className="mt-1 font-voice text-[20px] text-jenny-text">{timeOfDayGreeting()}</p>
            <div className="mt-2.5 h-px w-7 bg-jenny-gold" />
          </div>
        )}
      </header>

      {voiceConv.error && (
        <div className="flex items-center justify-between gap-3 border-b border-jenny-warn/30 bg-jenny-warn/10 px-4 py-2 text-xs text-jenny-warn">
          <span>
            {voiceConv.error === "mic-denied"
              ? "Jenny can't hear you — microphone access is blocked. Allow microphone access for this site in your browser settings, then tap Talk to Jenny again."
              : "No microphone was found on this device."}
          </span>
          <button
            onClick={voiceConv.clearError}
            className="shrink-0 rounded-md p-1 text-jenny-warn hover:bg-jenny-warn/10"
            aria-label="Dismiss"
          >
            <IconX size={13} />
          </button>
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-8">
        {heroPhase !== "gone" && (
          // Voice-first when idle (large centered orb), typing-first the
          // instant the keyboard opens: centering this content vertically
          // in a viewport the keyboard just shrank means it overflows its
          // container, and since it's centered, the orb — first in the
          // stack — is what scrolls out of view above the fold. Collapsing
          // the subtitle/suggestions and shrinking the orb keeps everything
          // on-screen and puts the composer where the user's attention
          // actually is. transition-all animates the swap smoothly in both
          // directions rather than popping.
          //
          // heroPhase === "collapsing" (see the state/effect above) instead
          // fades+shrinks the WHOLE hero in place, in parallel with the
          // first message already sending — never delays the send, and once
          // the transition ends the hero unmounts entirely (heroPhase
          // "gone") so its idle glow animation stops costing anything.
          <div
            className={`mx-auto flex h-full max-w-md flex-col items-center text-center transition-all duration-300 ${
              heroPhase === "collapsing"
                ? "scale-95 justify-center gap-4 opacity-0 duration-[420ms] ease-out"
                : keyboardOpen
                  ? "justify-start gap-2 pt-1"
                  : "justify-center gap-4"
            }`}
          >
            <VoiceOrb state={orbState} size={keyboardOpen ? "sm" : "lg"} onInterrupt={handleInterrupt} />
            <div
              className={`overflow-hidden transition-all duration-300 ${
                keyboardOpen ? "max-h-0 opacity-0" : "max-h-40 opacity-100"
              }`}
            >
              <h2 className="font-voice text-xl text-jenny-text">Ask JennySol anything</h2>
              <p className="mt-1.5 text-sm text-jenny-muted">
                Upload documents in the sidebar so answers are grounded in them, or just start chatting.
              </p>
            </div>
            <div
              className={`flex flex-col gap-2.5 self-stretch overflow-hidden transition-all duration-300 ${
                keyboardOpen ? "max-h-0 opacity-0" : "max-h-96 opacity-100"
              }`}
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="rounded-2xl bg-jenny-raised px-3.5 py-3 text-left text-sm text-jenny-text-3 transition hover:bg-jenny-raised-2"
                >
                  {s}
                </button>
              ))}
            </div>
            <p
              className={`text-[10px] text-jenny-faint transition-opacity duration-300 ${
                keyboardOpen ? "opacity-0" : "opacity-100"
              }`}
            >
              Made at Vikisol Labs
            </p>
          </div>
        )}

        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              role={m.role}
              content={m.content}
              sources={m.sources}
              image={m.image}
              imageLoading={m.imageLoading}
              streaming={sending && i === messages.length - 1}
              statusLabel={sending && i === messages.length - 1 ? (sendingStatus ?? undefined) : undefined}
            />
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* pb accounts for the home-indicator safe area — env() itself
          resolves to 0 while the keyboard is showing (iOS reclaims that
          space for the keyboard), so this never adds an artificial gap
          above an open keyboard, only above the home indicator when it's
          the actual bottom edge of the screen. */}
      <div className="shrink-0 border-t border-jenny-hairline bg-jenny-surface/95 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-4 sm:pt-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {messages.length > 0 && voiceConv.state !== "off" && (
          <div className="mx-auto mb-3 flex max-w-3xl animate-fade-in items-center gap-2.5 rounded-2xl bg-jenny-raised px-3 py-2">
            <VoiceOrb state={orbState} size="sm" onInterrupt={handleInterrupt} />
            <span className="text-xs text-jenny-muted">
              {orbState === "speaking"
                ? "Speaking — tap the orb to interrupt"
                : orbState === "listening"
                  ? "Listening…"
                  : orbState === "thinking"
                    ? "Thinking…"
                    : orbState === "tool"
                      ? "Working on it…"
                      : orbState === "paused"
                        ? "Paused"
                        : "Listening for “Hey Jenny”…"}
            </span>
          </div>
        )}
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="flex rounded-lg border border-jenny-border p-0.5">
            <button
              onClick={() => setImageMode(false)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                !imageMode ? "bg-jenny-gold text-jenny-ink-on-gold" : "text-jenny-muted hover:text-jenny-text-2"
              }`}
              aria-pressed={!imageMode}
            >
              <IconMessage size={13} />
              <span className="hidden sm:inline">Chat</span>
            </button>
            <button
              onClick={() => setImageMode(true)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                imageMode ? "bg-jenny-gold text-jenny-ink-on-gold" : "text-jenny-muted hover:text-jenny-text-2"
              }`}
              aria-pressed={imageMode}
            >
              <IconPhoto size={13} />
              <span className="hidden sm:inline">Image</span>
            </button>
          </div>

          <div className="flex min-w-0 flex-1 items-end gap-2 rounded-2xl bg-jenny-raised p-1.5 transition-shadow focus-within:ring-1 focus-within:ring-jenny-gold/40">
            {speech.supported && (
              <button
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
                  speech.listening
                    ? "animate-pulse bg-jenny-bad text-jenny-void"
                    : speech.error
                      ? "text-jenny-warn"
                      : "text-jenny-dim hover:bg-jenny-raised-2 hover:text-jenny-text-3"
                }`}
                aria-label={speech.listening ? "Stop listening" : "Speak your message"}
                title={
                  speech.error === "mic-denied"
                    ? "Microphone access is blocked — allow it in your browser settings"
                    : speech.error === "mic-unavailable"
                      ? "No microphone was found on this device"
                      : speech.listening
                        ? "Listening… click to stop"
                        : "Speak your message"
                }
              >
                {speech.listening ? <IconMicrophoneOff size={16} /> : <IconMicrophone size={16} />}
              </button>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoResize();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder={imageMode ? "Describe…" : "Ask Jenny…"}
              className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-base text-jenny-text outline-none placeholder:text-jenny-dim"
            />
            {sending ? (
              <button
                onClick={handleCancel}
                disabled={!currentRunIdRef.current}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-jenny-raised-2 text-jenny-text transition disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Stop generating"
                title="Stop generating"
              >
                <IconPlayerStop size={14} />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-jenny-gold text-jenny-ink-on-gold transition disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send message"
              >
                <IconSend size={16} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-jenny-faint">
          JennySol can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}
