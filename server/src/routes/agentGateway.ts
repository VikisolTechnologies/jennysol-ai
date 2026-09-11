// M6/M7 (agent gateway, PROJECT-PROGRESS.md milestone model): the real HTTP entry point a
// connected product (Arena, and future products) calls into — distinct from /api/chat, which is
// for JennySol's own logged-in users authenticated via requireAuth/sessions.ts, not
// product-federated identities. Gated by requireProductIdentity (verifies the caller's service
// token — see middleware/productIdentity.ts), then runs the real M1 tool-calling engine through
// the real M3 tool registry, offering only the tools the caller's own product/scope grants
// (ToolRegistry.getToolsFor).
//
// M7: a READ tool's call is dispatched immediately, same as M6. A WRITE tool's call is never
// dispatched from here — per ADR-004, it becomes a PendingAction (pendingActions.ts) the model is
// told is "awaiting approval," and the HTTP response separately surfaces it so the calling
// product's own frontend can render a real approval UI (Arena's existing, previously-dormant
// IntentCardView.tsx was built for exactly this). POST /actions/:actionId is the only way a
// proposed WRITE tool call actually executes.
//
// Deliberately a plain request/response, not SSE or the AgentRun-durability model /api/chat uses
// (agentRunStore.ts, chatRunner.ts) — those are tied to a JennySol user_id/conversationId, which
// a product-federated identity doesn't have. Upgrading this gateway to real durability/streaming
// is real future work once actual product traffic justifies it, not built ahead of that need.
import { Router } from "express";
import { z } from "zod";
import { requireProductIdentity } from "../middleware/productIdentity.js";
import { toolRegistry } from "../services/tools/registryInstance.js";
import { proposeAction, consumeAction, PendingActionError, type PendingAction } from "../services/tools/pendingActions.js";
import { routeChatCompletion } from "../services/modelRouter.js";
import { zodErrorMessage } from "../utils/zodError.js";

export const agentGatewayRouter = Router();

const GatewayChatSchema = z.object({
  message: z.string().min(1).max(4000),
});

const GATEWAY_SYSTEM_PROMPT =
  "You are the Vikisol AI assistant, helping an authenticated user of a connected Vikisol " +
  "product through a set of real tools. Only call a tool when it can genuinely help answer the " +
  "request — if none of the available tools apply, just answer directly. Never claim a tool did " +
  "something it didn't, and never invent data a tool didn't actually return. If a tool call " +
  "fails, or a tool's own description states a real limitation (e.g. no keyword search), say so " +
  "honestly to the user rather than working around it with a guess. Some tools are real, " +
  "consequential actions that require the user's explicit approval before they run — if a tool " +
  "result tells you an action is awaiting approval, tell the user that plainly and do not claim " +
  "the action has already happened.";

interface ProposedActionSummary {
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
}

agentGatewayRouter.post("/chat", requireProductIdentity, async (req, res) => {
  const parsed = GatewayChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  const identity = req.productIdentity!;
  const rawToken = req.serviceToken!;
  const availableTools = toolRegistry.getToolsFor(identity);
  const tools = availableTools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  const proposedActions: ProposedActionSummary[] = [];

  let content = "";
  try {
    await routeChatCompletion(
      GATEWAY_SYSTEM_PROMPT,
      [{ role: "user", content: parsed.data.message }],
      (delta) => {
        content += delta;
      },
      undefined,
      "general",
      undefined,
      tools.length ? tools : undefined,
      tools.length
        ? async (call) => {
            const tier = toolRegistry.getTier(identity, call.name);
            if (tier === "WRITE") {
              const action = proposeAction(identity, call.name, call.args);
              proposedActions.push({ actionId: action.id, toolName: action.toolName, args: action.args });
              return {
                status: "awaiting_user_approval",
                actionId: action.id,
                message: "This action requires the user's explicit approval before it will run.",
              };
            }
            return toolRegistry.dispatch(identity, call.name, call.args, { rawToken });
          }
        : undefined
    );
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Agent request failed" });
    return;
  }

  res.json(proposedActions.length ? { content, pendingActions: proposedActions } : { content });
});

const ActionDecisionSchema = z.object({
  approve: z.boolean(),
});

// M7: the only path a proposed WRITE tool call can actually execute through. Requires the exact
// same identity that proposed it (enforced inside consumeAction, independent of this route's own
// requireProductIdentity check) — a different user, even a different user of the same product,
// can never approve or reject someone else's pending action.
agentGatewayRouter.post("/actions/:actionId", requireProductIdentity, async (req, res) => {
  const parsed = ActionDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  const identity = req.productIdentity!;
  let action: PendingAction;
  try {
    action = consumeAction(req.params.actionId, identity);
  } catch (err) {
    res.status(404).json({ error: err instanceof PendingActionError ? err.message : "Action not found" });
    return;
  }

  if (!parsed.data.approve) {
    res.json({ status: "rejected" });
    return;
  }

  try {
    const result = await toolRegistry.dispatch(identity, action.toolName, action.args, { rawToken: req.serviceToken! });
    res.json({ status: "executed", result });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Tool execution failed" });
  }
});
