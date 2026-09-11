// M6 (agent gateway, PROJECT-PROGRESS.md milestone model): the product-federated equivalent of
// requireAuth (auth.ts) — resolves a request to a ProductIdentity instead of a JennySol
// req.userId. Deliberately a separate middleware, not an extension of requireAuth: a service
// token (serviceToken.ts) must never be accepted anywhere requireAuth is checked, and a real
// JennySol session token must never be accepted here — the two identity systems stay fully
// separate end to end, per ADR-003.
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { verifyServiceToken, ServiceTokenError } from "../services/serviceToken.js";
import type { ProductIdentity } from "../services/productIdentity.js";
import { logAuditEvent } from "../services/agentAuditLog.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      productIdentity?: ProductIdentity;
      // M7: the exact raw token this identity was verified from — a write tool that needs to
      // call back into its own product's authenticated API (e.g. Arena's POST /applications, see
      // AgentServiceTokenAuthenticationFilter on the Arena side) forwards this same token as its
      // own Authorization header, a round trip rather than a new credential. Never logged, never
      // stored beyond this one request's lifetime.
      serviceToken?: string;
      // M9: one id per product-gateway request, generated here regardless of whether auth
      // succeeds, so a token failure and every subsequent event for a successful request land in
      // the same audit trail (see agentAuditLog.ts) — the one identifier this milestone's own
      // acceptance criteria requires threading through the whole chain.
      correlationId?: string;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export function requireProductIdentity(req: Request, res: Response, next: NextFunction) {
  const correlationId = randomUUID();
  req.correlationId = correlationId;

  const token = extractToken(req);
  if (!token) {
    logAuditEvent({
      correlationId,
      type: "product_identity_invalid",
      detail: { reason: "Missing service token", path: req.path },
    });
    res.status(401).json({ error: "Missing service token" });
    return;
  }
  try {
    req.productIdentity = verifyServiceToken(token);
    req.serviceToken = token;
  } catch (err) {
    const message = err instanceof ServiceTokenError ? err.message : "Invalid service token";
    // "expired" is jsonwebtoken's own wording (TokenExpiredError.message is "jwt expired"),
    // surfaced verbatim inside ServiceTokenError's own message — classified here rather than in
    // serviceToken.ts itself so M2's verifier stays a pure verify-or-throw primitive with no
    // audit-logging concern of its own.
    logAuditEvent({
      correlationId,
      type: /expired/i.test(message) ? "product_identity_expired" : "product_identity_invalid",
      detail: { reason: message, path: req.path },
    });
    res.status(401).json({ error: message });
    return;
  }
  next();
}
