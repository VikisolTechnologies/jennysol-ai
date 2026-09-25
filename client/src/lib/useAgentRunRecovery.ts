import { useCallback, useEffect, useState } from "react";
import { fetchActiveRuns, markRunSeen, type AgentRun } from "./api";

// Surfaces "Jenny finished while you were away": runs that completed (or
// failed) since this client last marked them seen, for a conversation other
// than the one currently open. The currently-open conversation's own
// in-flight-run recovery is handled separately and more precisely by
// ChatWindow's resume-on-load effect (it has the actual message list to
// patch in place); this hook is for everything else the user might have
// missed — a different chat that kept working in the background while they
// were elsewhere in the app, or while the tab/app was closed entirely.
export function useAgentRunRecovery(activeConversationId: string | null) {
  const [unseenCompleted, setUnseenCompleted] = useState<AgentRun[]>([]);

  const check = useCallback(async () => {
    const runs = await fetchActiveRuns().catch(() => []);
    const finished = runs.filter((r) => r.status === "completed" || r.status === "failed");
    // A finished reply in the chat that's open right now is on screen, so it
    // counts as seen — otherwise switching away later re-announces it as
    // something that happened "while you were away".
    for (const r of finished) {
      if (r.conversationId === activeConversationId) void markRunSeen(r.id);
    }
    setUnseenCompleted(finished.filter((r) => r.conversationId !== activeConversationId));
  }, [activeConversationId]);

  useEffect(() => {
    void check();

    function onVisible() {
      if (document.visibilityState === "visible") void check();
    }
    // Three different ways "the user came back" can fire depending on
    // platform: a background tab regaining focus, the OS resuming a
    // suspended page (bfcache restore, common on iOS Safari), or the device
    // regaining network after being offline.
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [check]);

  async function dismiss(runIds: string[]) {
    const ids = new Set(runIds);
    setUnseenCompleted((prev) => prev.filter((r) => !ids.has(r.id)));
    await Promise.all(runIds.map((id) => markRunSeen(id)));
  }

  return { unseenCompleted, dismiss };
}
