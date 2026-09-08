import { useEffect, useState } from "react";

// A deliberate, coarse "is the on-screen keyboard open" signal for UI that
// needs to actively adapt its layout (not just resize) — e.g. the welcome
// screen swapping a large centered Orb for a compact one so it doesn't get
// scrolled out of view in a shrunk viewport. Separate from
// useViewportHeight's imperative CSS-var updates on purpose: that one runs
// once globally and never triggers a re-render (every pixel of keyboard
// animation would be wasteful to react to in React state), while this one
// is real state, but only flips — and only re-renders whichever component
// calls it — on a real open/close transition, not every intermediate frame.
export function useKeyboardOpen(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // The largest height seen since mount is our proxy for "keyboard fully
    // closed" — more reliable than window.screen.height, which doesn't
    // account for browser chrome (address bar, home indicator) that's
    // already subtracted from visualViewport.height even with no keyboard.
    let maxHeightSeen = vv.height;

    function update() {
      const vv = window.visualViewport;
      if (!vv) return;
      maxHeightSeen = Math.max(maxHeightSeen, vv.height);
      // A real keyboard takes a substantial bite out of the screen — 150px
      // comfortably clears address-bar show/hide and other minor chrome
      // changes that aren't the keyboard, while still catching every real
      // keyboard (even compact/floating ones on larger phones).
      const isOpen = maxHeightSeen - vv.height > 150;
      setKeyboardOpen((prev) => (prev === isOpen ? prev : isOpen));
    }

    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  return keyboardOpen;
}
