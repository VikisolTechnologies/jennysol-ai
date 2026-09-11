import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { ChatWindow } from "./ChatWindow";
import { GuestLimitModal } from "./GuestLimitModal";
import { useAgentRunRecovery } from "../lib/useAgentRunRecovery";
import { useAuth } from "../lib/AuthContext";
import { ACTIVE_CONVERSATION_KEY } from "../lib/storageKeys";

// Guest-aware, same reasoning as the auth token itself (see lib/auth.ts):
// a guest's "which conversation was open" pointer is part of that
// temporary browser session, not something that should persist past it in
// localStorage — a stale pointer surviving into a brand-new guest session
// wouldn't leak anything (the new session's token has no access to the
// old conversation id, the backend just 404s it), but it's not "nothing
// persisted" either, which is the actual product requirement. A logged-in
// account keeps using localStorage, unchanged.
function conversationIdStorage(isGuest: boolean): Storage {
  return isGuest ? sessionStorage : localStorage;
}

function readStoredConversationId(isGuest: boolean): string | null {
  try {
    return conversationIdStorage(isGuest).getItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

function storeConversationId(isGuest: boolean, id: string | null) {
  try {
    const storage = conversationIdStorage(isGuest);
    if (id) storage.setItem(ACTIVE_CONVERSATION_KEY, id);
    else storage.removeItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    // storage unavailable (private browsing etc.) — just won't survive a reload
  }
}

export function MainApp() {
  // Safe to read synchronously here: RequireAuth never mounts MainApp
  // until `user` is already resolved, so there's no "isGuest flips after
  // first render" race for the useState initializer below to worry about.
  const { user } = useAuth();
  const isGuest = user?.isGuest ?? false;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Restored from storage on mount instead of always starting at a blank
  // "New chat" screen — the audit's own confirmed finding was that a
  // reload had no way to tell it should return to the conversation that was
  // open, even though the reply itself was safely persisted server-side.
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() =>
    readStoredConversationId(isGuest)
  );
  const [conversationsVersion, setConversationsVersion] = useState(0);
  const { unseenCompleted, dismiss } = useAgentRunRecovery(activeConversationId);
  // Shared between Sidebar (a proactive "save your chats" prompt) and
  // ChatWindow (reactive, once the server blocks a message past the guest
  // prompt limit) — held here so either one can trigger the same modal.
  const [authGate, setAuthGate] = useState<"limit" | "manual" | null>(null);

  useEffect(() => {
    storeConversationId(isGuest, activeConversationId);
  }, [isGuest, activeConversationId]);

  function selectConversation(id: string | null) {
    setActiveConversationId(id);
    setSidebarOpen(false);
  }

  return (
    <div className="flex h-[var(--app-vh)] w-screen flex-col overflow-hidden bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {unseenCompleted.length > 0 && (
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-brand-200 bg-brand-50 px-4 py-2 dark:border-brand-500/20 dark:bg-brand-500/10">
          {unseenCompleted.map((run) => (
            <div key={run.id} className="flex items-center justify-between gap-3 text-xs">
              <button
                onClick={() => {
                  selectConversation(run.conversationId);
                  void dismiss(run.id);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-brand-800 hover:underline dark:text-brand-200"
              >
                <Bell size={13} className="shrink-0" />
                <span className="truncate">
                  Jenny {run.status === "completed" ? "finished a reply" : "hit an error"} while you were away —
                  tap to view
                </span>
              </button>
              <button
                onClick={() => void dismiss(run.id)}
                className="shrink-0 rounded-md p-1 text-brand-600 hover:bg-brand-100 dark:text-brand-300 dark:hover:bg-brand-500/10"
                aria-label="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 w-screen overflow-hidden">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm motion-safe:animate-fade-in md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          activeConversationId={activeConversationId}
          conversationsVersion={conversationsVersion}
          onSelectConversation={selectConversation}
          onNewChat={() => selectConversation(null)}
          onRequestAuthGate={() => setAuthGate("manual")}
        />
        <ChatWindow
          onOpenSidebar={() => setSidebarOpen(true)}
          onNewChat={() => selectConversation(null)}
          conversationId={activeConversationId}
          onConversationChange={(id) => {
            setActiveConversationId(id);
            setConversationsVersion((v) => v + 1);
          }}
          onRequestAuthGate={() => setAuthGate("limit")}
        />
      </div>
      <GuestLimitModal
        open={authGate !== null}
        reason={authGate ?? "manual"}
        onClose={() => setAuthGate(null)}
        onUpgraded={() => setAuthGate(null)}
      />
    </div>
  );
}
