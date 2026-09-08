import { useEffect } from "react";

// CSS *vh units (even 100dvh) are an unreliable source of truth for "how
// tall is the screen right now" on mobile: iOS Safari's dvh support for the
// on-screen keyboard specifically (as opposed to its own address bar) has
// shipped inconsistently across versions, sometimes updating late or not at
// all — which reads to a user as the layout visibly jumping/breaking the
// moment the keyboard opens. window.visualViewport is the one API both iOS
// and Android actually keep accurate in real time, so mirror its height into
// a CSS custom property and drive all the app's full-screen layouts from
// that instead of trusting *vh alone. Falls back to 100dvh (set once in
// index.css) on the rare browser with neither.
export function useViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    function update() {
      const h = vv?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${h}px`);
      // Exposed for completeness/defense-in-depth — html/body are pinned via
      // position:fixed (see index.css) specifically so nothing needs to
      // read this to stay correctly positioned, but it's cheap to track and
      // useful if a future browser quirk needs it as an escape hatch.
      document.documentElement.style.setProperty("--app-vh-offset", `${vv?.offsetTop ?? 0}px`);
    }
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
}
