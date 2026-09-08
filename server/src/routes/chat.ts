import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { startChatRun, executeChatRun } from "../services/chatRunner.js";
import { subscribe } from "../services/runBus.js";
import { markHeartbeat } from "../services/agentRunStore.js";
import { countUserMessages } from "../services/conversationStore.js";
import { getUserById } from "../services/auth/userStore.js";
import { zodErrorMessage } from "../utils/zodError.js";

export const chatRouter = Router();

// Idle-period keepalive — without this, an SSE connection sitting quietly
// while the model is still "thinking" can look indistinguishable from a
// dead one to an intermediary (proxy, mobile carrier NAT) and get silently
// dropped. Configurable since the right interval depends on what's in front
// of this server in a given deployment.
const HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS) || 10_000;

// How often a guest gets nudged to sign up. NOT a hard wall — a guest can
// keep chatting indefinitely; every Nth message just re-shows a dismissible
// sign-up modal (see GuestLimitModal.tsx) so they don't lose the
// conversation if they clear their browser. Counted server-side (total user
// turns across every conversation the account owns — see countUserMessages)
// so it stays consistent across reloads/devices rather than a per-tab
// client counter.
//
// This used to be a hard 403 block once a guest crossed this many messages
// — permanently, since the count never resets. Live user reports (screen
// recordings of the block reappearing on every send attempt after the first
// dismissal, with no way to keep chatting) made clear that was too
// aggressive for what was only ever meant to be a periodic reminder. Now it
// only gates the nag popup's cadence, never the request itself.
const GUEST_NUDGE_INTERVAL = Number(process.env.GUEST_PROMPT_LIMIT) || 10;

const chatRequestSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
});

chatRouter.post("/", (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  const userId = req.userId!;
  const requestId = randomUUID();
  const requester = getUserById(userId);

  // Both of these are plain SQLite writes (no network call), so this
  // resolves in low single-digit milliseconds — the run exists, and is
  // recoverable via GET /api/agent/runs/:id, before any model call starts.
  const { run, conversationId } = startChatRun({
    userId,
    requestId,
    message: parsed.data.message,
    conversationId: parsed.data.conversationId,
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Tells any well-behaved reverse proxy in front of this (nginx-shaped
  // ones especially) not to buffer the response — a buffered SSE stream
  // defeats the entire point of streaming.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;

  function write(type: string, data: Record<string, unknown>) {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch {
      closed = true;
    }
  }

  // Non-blocking nudge signal — the message above has already been saved
  // and is generating normally regardless of this. `count` includes the
  // message just sent (startChatRun's addMessage already ran), so a guest's
  // 10th, 20th, 30th... message carries `nudge: true` and the client shows
  // the dismissible sign-up modal alongside the reply, never instead of it.
  if (requester?.isGuest) {
    const count = countUserMessages(userId);
    write("guest.progress", { count, nudge: count > 0 && count % GUEST_NUDGE_INTERVAL === 0 });
  }

  // Subscribed BEFORE the run is kicked off below, so the very first events
  // executeChatRun emits (run.started, agent.status) are delivered to this
  // connection rather than raced/missed — see chatRunner.ts's emit(), which
  // fires synchronously as the first thing inside executeChatRun.
  const unsubscribe = subscribe(run.id, (event) => {
    write(event.type, (event.payload as Record<string, unknown>) ?? {});
    if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
      cleanup();
      if (!closed) res.end();
    }
  });

  const heartbeat = setInterval(() => {
    markHeartbeat(run.id);
    write("heartbeat", { timestamp: new Date().toISOString() });
  }, HEARTBEAT_MS);

  function cleanup() {
    clearInterval(heartbeat);
    unsubscribe();
  }

  // The client going away does NOT stop generation — only this connection's
  // own bookkeeping. executeChatRun below has no reference to `res` at all,
  // so it keeps running, keeps writing deltas to agent_runs/agent_events,
  // and finishes normally; a client that reconnects later recovers it via
  // GET /api/agent/runs/:id or replays what it missed via
  // GET /api/agent/runs/:id/events?after=.
  req.on("close", () => {
    closed = true;
    cleanup();
  });

  void executeChatRun(run.id, requestId, userId, conversationId, parsed.data.message);
});
