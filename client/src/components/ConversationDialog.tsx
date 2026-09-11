import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

// One shared modal shell for both Rename and Delete-confirm — centered on
// every viewport (not a true slide-up sheet) so mobile and desktop share
// one implementation instead of two, while still respecting safe areas and
// getting full keyboard/focus handling. Real backend persistence lives in
// the caller (Sidebar.tsx) via the same renameConversation/deleteConversation
// calls that already existed — this component only owns the dialog shell,
// never invents its own state.
function DialogShell({
  open,
  onClose,
  labelledBy,
  restoreFocusRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      // Simple focus trap: Tab wrapping stays inside the dialog.
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to the row's "..." button explicitly, not whatever
      // document.activeElement happens to be by the time this cleanup runs.
      // The dropdown menuitem that was actually clicked (e.g. "Rename")
      // unmounts in the same commit that opens this dialog, and a focused
      // element being removed from the DOM makes the browser fall back to
      // <body> *before* any effect gets a chance to observe it — so relying
      // on previouslyFocused (captured from document.activeElement) silently
      // restores focus to <body> instead of the trigger. restoreFocusRef is
      // captured by the caller at the moment the menu itself was opened,
      // while the trigger button still definitely had focus.
      (restoreFocusRef?.current ?? previouslyFocused.current)?.focus();
    };
  }, [open, onClose, restoreFocusRef]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm motion-safe:animate-fade-in sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="w-full max-w-sm rounded-t-2xl border border-neutral-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl motion-safe:animate-slide-up dark:border-white/10 dark:bg-neutral-900 sm:rounded-2xl sm:pb-5"
      >
        {children}
      </div>
    </div>
  );
}

export function RenameDialog({
  open,
  initialValue,
  onClose,
  onSave,
  restoreFocusRef,
}: {
  open: boolean;
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setStatus("idle");
      setError(null);
      // Autofocus + select-all so typing immediately replaces the title —
      // matches the ergonomics of the inline-edit pattern this replaces.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, initialValue]);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setStatus("error");
      setError("Conversation name can't be empty.");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't rename this conversation.");
    }
  }

  return (
    <DialogShell open={open} onClose={onClose} labelledBy="rename-dialog-title" restoreFocusRef={restoreFocusRef}>
      <div className="flex items-center justify-between">
        <h2 id="rename-dialog-title" className="text-base font-semibold">
          Rename conversation
        </h2>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/10"
          aria-label="Cancel rename"
        >
          <X size={16} />
        </button>
      </div>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void handleSave();
          }
        }}
        maxLength={200}
        className="mt-4 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none ring-brand-500/20 focus:ring-2 dark:border-white/15 dark:bg-neutral-950 dark:text-white"
        aria-label="Conversation name"
      />
      {status === "error" && error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={status === "saving"}
          className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
    </DialogShell>
  );
}

export function DeleteConversationDialog({
  open,
  title,
  onClose,
  onConfirm,
  restoreFocusRef,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const [status, setStatus] = useState<"idle" | "deleting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatus("idle");
      setError(null);
    }
  }, [open]);

  async function handleConfirm() {
    setStatus("deleting");
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Couldn't delete this conversation.");
    }
  }

  return (
    <DialogShell open={open} onClose={onClose} labelledBy="delete-dialog-title" restoreFocusRef={restoreFocusRef}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
          <AlertTriangle size={18} />
        </div>
        <div className="min-w-0">
          <h2 id="delete-dialog-title" className="text-base font-semibold">
            Delete conversation?
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            "{title}" will be permanently deleted. This can't be undone.
          </p>
        </div>
      </div>
      {status === "error" && error && <p className="mt-3 text-xs text-rose-500">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={status === "deleting"}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
        >
          {status === "deleting" ? "Deleting…" : "Delete"}
        </button>
      </div>
    </DialogShell>
  );
}
