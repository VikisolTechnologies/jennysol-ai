import { useEffect, useRef, useState } from "react";
import {
  Ear,
  EarOff,
  ImageIcon,
  Menu,
  Mic,
  MicOff,
  MessageSquare,
  Moon,
  Pause,
  SendHorizontal,
  Square,
  Sun,
  X,
} from "lucide-react";
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
import { useTheme } from "../lib/useTheme";
import { useSpeechRecognition } from "../lib/useSpeechRecognition";
import { useVoiceConversation } from "../lib/useVoiceConversation";
import { useKeyboardOpen } from "../lib/useKeyboardOpen";
import { speak, stopSpeaking } from "../lib/speak";
import { getStoredVoice, storeVoice, type VoiceId } from "../lib/voices";

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

export function ChatWindow({
  onOpenSidebar,
  conversationId,
  onConversationChange,
  onRequestAuthGate,
}: {
  onOpenSidebar: () => void;
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
  const [spokenReplies, setSpokenReplies] = useState(false);
  const [voice, setVoiceState] = useState<VoiceId>(getStoredVoice);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { theme, toggleTheme } = useTheme();
  const keyboardOpen = useKeyboardOpen();

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
    <div className="flex h-full min-w-0 flex-1 flex-col bg-neutral-100/50 dark:bg-neutral-950">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-white/80 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/80">
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSidebar}
            className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 md:hidden"
            aria-label="Open sidebar"
          >
            <Menu size={18} />
          </button>
          <span className="text-sm font-semibold">Chat</span>
        </div>
        <div className="flex items-center gap-1">
          {voiceConv.supported ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleVoiceConvButtonClick}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  voiceConv.state === "listening"
                    ? "bg-rose-500 text-white"
                    : voiceConv.state === "sleeping"
                      ? "bg-brand-gradient text-white"
                      : voiceConv.state === "paused"
                        ? "bg-amber-500 text-white"
                        : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
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
                  <Pause size={14} />
                ) : voiceConv.state === "off" ? (
                  <EarOff size={14} />
                ) : (
                  <Ear size={14} className={voiceConv.state === "listening" ? "animate-pulse" : ""} />
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
                  className="rounded-lg p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-white/10 dark:hover:text-neutral-300"
                  aria-label="End voice conversation"
                  title="End voice conversation"
                >
                  <X size={14} />
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
              className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-300 dark:text-neutral-600"
              aria-label="Voice isn't supported in this browser"
              title="Voice isn't supported in this browser — try Chrome, Edge, or Safari"
            >
              <EarOff size={14} />
              <span className="hidden sm:inline">Voice unavailable</span>
            </button>
          )}
          <VoicePicker
            voice={voice}
            onChangeVoice={setVoice}
            spokenRepliesEnabled={spokenReplies}
            onToggleSpokenReplies={() => {
              if (spokenReplies) stopSpeaking();
              setSpokenReplies((v) => !v);
            }}
          />
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {voiceConv.error && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          <span>
            {voiceConv.error === "mic-denied"
              ? "Jenny can't hear you — microphone access is blocked. Allow microphone access for this site in your browser settings, then tap Talk to Jenny again."
              : "No microphone was found on this device."}
          </span>
          <button
            onClick={voiceConv.clearError}
            className="shrink-0 rounded-md p-1 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-500/10"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-8">
        {messages.length === 0 && (
          // Voice-first when idle (large centered Orb), typing-first the
          // instant the keyboard opens: centering this content vertically
          // in a viewport the keyboard just shrank means it overflows its
          // container, and since it's centered, the Orb — first in the
          // stack — is what scrolls out of view above the fold. Collapsing
          // the subtitle/suggestions and shrinking the Orb keeps everything
          // on-screen and puts the composer where the user's attention
          // actually is. transition-all animates the swap smoothly in both
          // directions rather than popping.
          <div
            className={`mx-auto flex h-full max-w-md flex-col items-center text-center transition-all duration-300 ${
              keyboardOpen ? "justify-start gap-2 pt-1" : "justify-center gap-4"
            }`}
          >
            <VoiceOrb state={orbState} size={keyboardOpen ? "sm" : "lg"} onInterrupt={handleInterrupt} />
            <div
              className={`overflow-hidden transition-all duration-300 ${
                keyboardOpen ? "max-h-0 opacity-0" : "max-h-40 opacity-100"
              }`}
            >
              <h2 className="text-lg font-bold">Ask Jennysol anything</h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Upload documents in the sidebar so answers are grounded in them, or just start chatting.
              </p>
            </div>
            <div
              className={`flex flex-col gap-2 self-stretch overflow-hidden transition-all duration-300 ${
                keyboardOpen ? "max-h-0 opacity-0" : "max-h-96 opacity-100"
              }`}
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-left text-sm text-neutral-600 shadow-sm transition hover:border-brand-300 hover:text-neutral-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-300 dark:hover:border-brand-400/50 dark:hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
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
      <div className="shrink-0 border-t border-neutral-200 bg-white/80 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/80 sm:px-4 sm:pt-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {messages.length > 0 && voiceConv.state !== "off" && (
          <div className="mx-auto mb-3 flex max-w-3xl animate-fade-in items-center gap-2.5 rounded-xl border border-neutral-200 bg-white/60 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
            <VoiceOrb state={orbState} size="sm" onInterrupt={handleInterrupt} />
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
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
          <div className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-white/10">
            <button
              onClick={() => setImageMode(false)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                !imageMode
                  ? "bg-brand-gradient text-white"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
              aria-pressed={!imageMode}
            >
              <MessageSquare size={13} />
              <span className="hidden sm:inline">Chat</span>
            </button>
            <button
              onClick={() => setImageMode(true)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                imageMode
                  ? "bg-brand-gradient text-white"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
              aria-pressed={imageMode}
            >
              <ImageIcon size={13} />
              <span className="hidden sm:inline">Image</span>
            </button>
          </div>

          <div className="flex min-w-0 flex-1 items-end gap-2 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-white/10 dark:bg-white/[0.04]">
            {speech.supported && (
              <button
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
                  speech.listening
                    ? "animate-pulse bg-rose-500 text-white"
                    : speech.error
                      ? "text-amber-500 dark:text-amber-400"
                      : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-white/10 dark:hover:text-neutral-300"
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
                {speech.listening ? <MicOff size={16} /> : <Mic size={16} />}
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
              className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-base outline-none placeholder:text-neutral-400"
            />
            {sending ? (
              <button
                onClick={handleCancel}
                disabled={!currentRunIdRef.current}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-white transition disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/20"
                aria-label="Stop generating"
                title="Stop generating"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white transition disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send message"
              >
                <SendHorizontal size={16} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-neutral-400">
          Jennysol can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}
