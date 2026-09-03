import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatWindow } from "./ChatWindow";

export function MainApp() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationsVersion, setConversationsVersion] = useState(0);

  function selectConversation(id: string | null) {
    setActiveConversationId(id);
    setSidebarOpen(false);
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm md:hidden"
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
      />
      <ChatWindow
        onOpenSidebar={() => setSidebarOpen(true)}
        conversationId={activeConversationId}
        onConversationChange={(id) => {
          setActiveConversationId(id);
          setConversationsVersion((v) => v + 1);
        }}
      />
    </div>
  );
}
