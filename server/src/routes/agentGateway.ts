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
import { proposeAction, consumeAction, PendingActionError, ACTION_TTL_MS, type PendingAction } from "../services/tools/pendingActions.js";
import { ToolRejectedError } from "../services/tools/productConnector.js";
import { routeChatCompletion } from "../services/modelRouter.js";
import { zodErrorMessage } from "../utils/zodError.js";
import { logAuditEvent } from "../services/agentAuditLog.js";
import { InsufficientScopeError } from "../services/productIdentity.js";
import { classifyDifficulty } from "../services/models/modelTiers.js";
import { CrossProductToolAccessError } from "../services/tools/toolRegistry.js";

export const agentGatewayRouter = Router();

const GatewayChatSchema = z.object({
  message: z.string().min(1).max(4000),
  // Prior turns of this conversation, oldest first (the product owns conversation storage -
  // this gateway is stateless per request). Bounded so one request can't be arbitrarily large.
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .optional(),
  // Product-supplied facts about the user for this turn (name, area, what they've joined) -
  // plain text, bounded, and only ever what the product itself chose to share.
  context: z.string().max(2000).optional(),
});

// Which providers answer product-gateway requests: an explicit AGENT_GATEWAY_PROVIDER_CHAIN if
// set, else Claude first (tiered by difficulty) with Gemini as fallback when Claude is
// configured, else the server's normal chain. Separate from JennySol's own chat on purpose.
function gatewayChain(): string | undefined {
  if (process.env.AGENT_GATEWAY_PROVIDER_CHAIN) return process.env.AGENT_GATEWAY_PROVIDER_CHAIN;
  return process.env.ANTHROPIC_API_KEY ? "anthropic,gemini" : undefined;
}

const GATEWAY_SYSTEM_PROMPT =
  "You are the Vikisol AI assistant, helping an authenticated user of a connected Vikisol " +
  "product through a set of real tools. Only call a tool when it can genuinely help answer the " +
  "request — if none of the available tools apply, just answer directly. Never claim a tool did " +
  "something it didn't, and never invent data a tool didn't actually return. If a tool call " +
  "fails, or a tool's own description states a real limitation (e.g. no keyword search), say so " +
  "honestly to the user rather than working around it with a guess. Some tools are real, " +
  "consequential actions that require the user's explicit approval before they run — if a tool " +
  "result tells you an action is awaiting approval, tell the user that plainly and do not claim " +
  "the action has already happened. Tool results marked demoContent are examples, not real " +
  "opportunities: label them as demo content and never suggest joining or applying to them as real events.";

interface ProposedActionSummary {
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
  expiresAt: string;
}

agentGatewayRouter.post("/chat", requireProductIdentity, async (req, res) => {
  const parsed = GatewayChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  const identity = req.productIdentity!;
  const rawToken = req.serviceToken!;
  const correlationId = req.correlationId!;
  const auditIdentity = { product: identity.product, externalUserId: identity.externalUserId, tenantId: identity.tenantId };
  const availableTools = toolRegistry.getToolsFor(identity);
  const tools = availableTools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  const proposedActions: ProposedActionSummary[] = [];

  logAuditEvent({
    correlationId,
    type: "agent_request_received",
    identity: auditIdentity,
    detail: { messageLength: parsed.data.message.length, toolsOffered: tools.map((t) => t.name) },
  });

  const connector = toolRegistry.getConnectorFor(identity);
  const systemPrompt = [
    GATEWAY_SYSTEM_PROMPT,
    connector?.assistantInstructions,
    parsed.data.context ? `About the user you're helping (from ${identity.product}):\n${parsed.data.context}` : undefined,
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const history = [...(parsed.data.history ?? []), { role: "user" as const, content: parsed.data.message }];
  const tier = classifyDifficulty(parsed.data.message, parsed.data.history?.length ?? 0);

  let content = "";
  try {
    await routeChatCompletion(
      systemPrompt,
      history,
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
            logAuditEvent({
              correlationId,
              type: "tool_call_decided",
              identity: auditIdentity,
              toolName: call.name,
              detail: { tier: tier ?? "unknown", args: call.args },
            });

            if (tier === "WRITE") {
              const action = proposeAction(identity, call.name, call.args);
              proposedActions.push({ actionId: action.id, toolName: action.toolName, args: action.args, expiresAt: new Date(action.createdAt + ACTION_TTL_MS).toISOString() });
              logAuditEvent({
                correlationId,
                type: "pending_action_created",
                identity: auditIdentity,
                toolName: call.name,
                detail: { actionId: action.id },
              });
              return {
                status: "awaiting_user_approval",
                actionId: action.id,
                message: "This action requires the user's explicit approval before it will run.",
              };
            }

            try {
              const result = await toolRegistry.dispatch(identity, call.name, call.args, { rawToken });
              logAuditEvent({ correlationId, type: "tool_dispatched", identity: auditIdentity, toolName: call.name });
              return result;
            } catch (err) {
              logAuditEvent({
                correlationId,
                type:
                  err instanceof InsufficientScopeError
                    ? "scope_violation"
                    : err instanceof CrossProductToolAccessError
                      ? "cross_product_attempt"
                      : "tool_dispatch_failed",
                identity: auditIdentity,
                toolName: call.name,
                detail: { error: err instanceof Error ? err.message : String(err) },
              });
              throw err;
            }
          }
        : undefined,
      tier,
      gatewayChain(),
      "PUBLIC_CLOUD"
    );
  } catch (err) {
    logAuditEvent({
      correlationId,
      type: "provider_failure",
      identity: auditIdentity,
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    res.status(502).json({ error: err instanceof Error ? err.message : "Agent request failed" });
    return;
  }

  // A turn can end with no text at all (seen live: Gemini finishing after a tool call with an
  // empty answer). Never hand the product a blank reply to show as a message.
  if (!content.trim()) {
    if (proposedActions.length) {
      content = "I've set that up - review the details below before anything happens.";
    } else {
      logAuditEvent({ correlationId, type: "provider_failure", identity: auditIdentity, detail: { error: "empty reply" } });
      res.status(502).json({ error: "The assistant returned an empty reply" });
      return;
    }
  }

  logAuditEvent({
    correlationId,
    type: "agent_request_completed",
    identity: auditIdentity,
    detail: { contentLength: content.length, pendingActionCount: proposedActions.length },
  });

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
  const correlationId = req.correlationId!;
  const auditIdentity = { product: identity.product, externalUserId: identity.externalUserId, tenantId: identity.tenantId };

  let action: PendingAction;
  try {
    action = consumeAction(req.params.actionId, identity);
  } catch (err) {
    const message = err instanceof PendingActionError ? err.message : "Action not found";
    logAuditEvent({
      correlationId,
      type: /expired/i.test(message)
        ? "pending_action_expired"
        : /does not belong/i.test(message)
          ? "pending_action_identity_mismatch"
          : "pending_action_not_found",
      identity: auditIdentity,
      detail: { actionId: req.params.actionId, reason: message },
    });
    res.status(404).json({ error: message, code: /expired/i.test(message) && !/No such/.test(message) ? "expired" : "not_found" });
    return;
  }

  if (!parsed.data.approve) {
    logAuditEvent({
      correlationId,
      type: "pending_action_rejected",
      identity: auditIdentity,
      toolName: action.toolName,
      detail: { actionId: action.id },
    });
    res.json({ status: "rejected" });
    return;
  }

  logAuditEvent({
    correlationId,
    type: "pending_action_approved",
    identity: auditIdentity,
    toolName: action.toolName,
    detail: { actionId: action.id },
  });

  try {
    const result = await toolRegistry.dispatch(identity, action.toolName, action.args, { rawToken: req.serviceToken! });
    logAuditEvent({ correlationId, type: "tool_dispatched", identity: auditIdentity, toolName: action.toolName, detail: { actionId: action.id } });
    res.json({ status: "executed", result });
  } catch (err) {
    logAuditEvent({
      correlationId,
      type: "tool_dispatch_failed",
      identity: auditIdentity,
      toolName: action.toolName,
      detail: { actionId: action.id, error: err instanceof Error ? err.message : String(err) },
    });
    if (err instanceof ToolRejectedError) {
      // The product refused and nothing ran - a definite failure the user can act on.
      res.status(422).json({ status: "failed", error: err.message });
      return;
    }
    res.status(502).json({ error: err instanceof Error ? err.message : "Tool execution failed" });
  }
});
