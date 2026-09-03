import { useEffect, useRef } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (resp: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

// Exported so pages can decide whether to render the "or" divider around
// this button — nothing should visually assume it's there when it isn't.
export const GOOGLE_SIGN_IN_ENABLED = !!import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Renders Google's own hosted button (not a custom-styled lookalike) — it
// carries the Google branding requirements automatically and returns a
// signed ID token we verify server-side, never a client-trusted profile.
export function GoogleSignInButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !containerRef.current) return;
    const googleClientId = clientId;
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | undefined;

    function render() {
      if (cancelled || !window.google || !containerRef.current) return;
      window.google!.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp) => onCredentialRef.current(resp.credential),
      });
      window.google!.accounts.id.renderButton(containerRef.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
      });
    }

    if (window.google) {
      render();
    } else {
      // The GIS script loads async/defer — poll briefly rather than assume
      // it's ready by the time this component mounts.
      pollInterval = setInterval(() => {
        if (window.google) {
          clearInterval(pollInterval);
          render();
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [clientId]);

  if (!clientId) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}
