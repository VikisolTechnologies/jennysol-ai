// JENNYSOL-ARCHITECTURE.md §3 — the Agent Runtime's core contracts, exactly as designed there.
// Deliberately reuses ProductIdentity (never redefines identity) and the existing tool-calling
// types from llmProvider.ts — this is a persistence/observability/stop layer WRAPPING today's
// per-request tool-calling loop (routeChatCompletion + ToolRegistry.dispatch), not a second
// implementation of it. A run with zero tool calls is just "one plan step, then done" — the
// simplest possible case, not a special one.
import type { ProductIdentity } from "../productIdentity.js";

export type RunStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export type StopReason =
  | "completed"
  | "budget_exceeded"
  | "tool_failed_repeatedly"
  | "cancelled_by_user"
  | "rejected_by_user"
  | "provider_failed";

export interface TaskStep {
  id: string;
  runId: string;
  index: number;
  kind: "tool_call" | "final_answer";
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt: number | null;
}

export interface AgentGoalRunBudget {
  maxSteps: number;
  maxMs: number;
}

export const DEFAULT_BUDGET: AgentGoalRunBudget = { maxSteps: 8, maxMs: 60_000 };

export interface AgentGoalRun {
  id: string;
  identity: ProductIdentity;
  goal: string;
  status: RunStatus;
  budget: AgentGoalRunBudget;
  spentMs: number;
  content: string; // the model's running/final answer text
  pendingActionId?: string; // set when status is "awaiting_approval" — same PendingAction the
  // gateway route already uses; approving/declining it is the SAME /actions/:id flow, not a
  // second approval mechanism.
  stopReason?: StopReason;
  createdAt: number;
  updatedAt: number;
}

export class AgentGoalRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentGoalRunError";
  }
}
