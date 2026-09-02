import { Sidebar } from "./components/Sidebar";
import { ChatWindow } from "./components/ChatWindow";

export default function App() {
  return (
    <div className="flex h-screen bg-white">
      <Sidebar />
      <ChatWindow />
    </div>
  );
}
