import { Wrench } from "lucide-react";
import { Orb, type OrbState as JennyOrbState } from "./orb/Orb";

export type OrbState = "idle" | "sleeping" | "paused" | "listening" | "thinking" | "tool" | "speaking";

// Thin adapter over the real shared Orb (components/orb/Orb.tsx) —
// JENNYSOL-UI-BUILD.md §3's "one single component" requirement, satisfied
// by delegation rather than by rewriting every call site's richer 7-state
// voice-conversation vocabulary (idle/sleeping/paused/tool) down to the
// doc's simpler 5. The mapping below is what actually reconciles them:
// idle/sleeping/paused all read as "asleep" (outline, breathing — the real
// distinction between "ready" and "waiting for a wake word" was never a
// visually different orb state, just a different caption next to it in
// ChatWindow.tsx), "tool" borrows "thinking" (working on it, no dedicated
// visual exists for "specifically running a tool" in the new vocabulary).
const STATE_MAP: Record<OrbState, JennyOrbState> = {
  idle: "asleep",
  sleeping: "asleep",
  paused: "asleep",
  listening: "listening",
  thinking: "thinking",
  tool: "thinking",
  speaking: "speaking",
};

// Old "lg" was the large chat-hero orb (112-144px) — closer to the new
// vocabulary's "xl" (150px, welcome-scale) than its "lg" (52px, a much
// smaller screen-level presence marker); mapping it to "lg" here would be a
// real, visible size regression in the one place users see this orb most.
const SIZE_MAP = { sm: "sm", lg: "xl" } as const;

export function VoiceOrb({
  state,
  size = "lg",
  onInterrupt,
}: {
  state: OrbState;
  size?: "sm" | "lg";
  onInterrupt?: () => void;
}) {
  return (
    <div className="relative">
      <Orb state={STATE_MAP[state]} size={SIZE_MAP[size]} onInterrupt={onInterrupt} />
      {state === "tool" && (
        <Wrench
          size={size === "lg" ? 16 : 10}
          className="pointer-events-none absolute inset-0 m-auto text-jenny-gold"
        />
      )}
    </div>
  );
}
