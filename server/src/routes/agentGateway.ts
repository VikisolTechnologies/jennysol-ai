// M6 (agent gateway, PROJECT-PROGRESS.md milestone model): the real HTTP entry point a connected
// product (Arena, and future products) calls into — distinct from /api/chat, which is for
// JennySol's own logged-in users authenticated via requireAuth/sessions.ts, not
// product-federated identities. Gated by requireProductIdentity (verifies the caller's service
// token — see middleware/productIdentity.ts), then runs the real M1 tool-calling engine through
// the real M3 tool registry, offering only the tools the caller's own product/scope grants
// (ToolRegistry.getToolsFor), and dispatching any tool call the model makes through
// ToolRegistry.dispatch — which independently re-checks product/scope before executing anything,
// per ADR-003 ("Arena tools re-derive authorization independently").
//
// Deliberately a plain request/response, not SSE or the AgentRun-durability model /api/chat uses
// (agentRunStore.ts, chatRunner.ts) — those are tied to a JennySol user_id/conversationId, which
// a product-federated identity doesn't have. Upgrading this gateway to real durability/streaming
// is real future work once actual product traffic justifies it, not built ahead of that need.
import { Router } from "express";
import { z } from "zod";
import { requireProductIdentity } from "../middleware/productIdentity.js";
import { toolRegistry } from "../services/tools/registryInstance.js";
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
  "honestly to the user rather than working around it with a guess.";

agentGatewayRouter.post("/chat", requireProductIdentity, async (req, res) => {
  const parsed = GatewayChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  const identity = req.productIdentity!;
  const tools = toolRegistry.getToolsFor(identity).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

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
      tools.length ? (call) => toolRegistry.dispatch(identity, call.name, call.args) : undefined
    );
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Agent request failed" });
    return;
  }

  res.json({ content });
});
