// M2 (product identity/security): verifies the short-lived, scoped credential a product (Arena,
// eventually others) mints so its own users can act through JennySol without ever sharing a
// password or JennySol's own session mechanism. See ADR-003 in docs/architecture/ for the full
// design rationale — this file is that design's implementation, built and tested against a fake
// product ("acme" in serviceToken.test.ts) before any real product (Arena, M5) exists.
//
// Deliberately a signed JWT (HS256, one shared secret per issuing product), not JennySol's own
// opaque DB-backed session token (sessions.ts) — a service token must be verifiable without a
// network round trip back to the issuing product, and must never be confused with (or accepted
// as) a real JennySol session by any existing JennySol auth code, which only ever looks at
// sessions.ts. `jsonwebtoken` is used rather than hand-rolled HMAC verification — this is a
// security-critical primitive, not a place to reinvent signature verification.
import jwt from "jsonwebtoken";
import type { ProductIdentity } from "./productIdentity.js";

export class ServiceTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceTokenError";
  }
}

// JennySol is always the audience — a token minted for some other purpose (or a JennySol
// session token that somehow found its way here) is rejected outright.
const JENNYSOL_AUDIENCE = "jennysol";

// Short-lived by design (ADR-003: "a stolen token is only useful for minutes, not for the life
// of a login session"). signServiceToken() clamps to this even if a caller asks for longer.
const MAX_TOKEN_TTL_SECONDS = 300;

// One shared secret per issuing product, configured via `SERVICE_TOKEN_SECRET_<PRODUCT>` (e.g.
// `SERVICE_TOKEN_SECRET_ARENA`) — see server/.env.example. Deliberately per-product, not one
// global secret: a leaked Arena secret can't be used to forge a token for a different, future
// product, and a product no longer connected can have its secret unset without touching anyone
// else's.
function getSecretForProduct(product: string): string | undefined {
  return process.env[`SERVICE_TOKEN_SECRET_${product.toUpperCase()}`];
}

interface ServiceTokenPayload extends jwt.JwtPayload {
  role?: string;
  tenantId?: string;
  scope?: string[];
}

/**
 * Verifies a service token and returns the ProductIdentity it represents.
 *
 * Checked, in order: signature (against the *claimed* issuer's own secret — a forged token
 * claiming a different issuer than the one that actually signed it fails here, since the
 * signature won't match that issuer's secret), audience (must be "jennysol"), expiry, and the
 * presence of a subject (external user id). Throws ServiceTokenError on any failure — callers
 * must never treat a caught error as "identity unknown, proceed anonymously."
 */
export function verifyServiceToken(token: string): ProductIdentity {
  // jwt.decode() never checks the signature — this only reads the *claimed* issuer so we know
  // which product's secret to verify against next. Nothing learned here is trusted until
  // jwt.verify() below succeeds.
  const unverified = jwt.decode(token);
  const claimedIssuer =
    unverified && typeof unverified === "object" && typeof unverified.iss === "string" ? unverified.iss : undefined;
  if (!claimedIssuer) {
    throw new ServiceTokenError("Service token missing issuer");
  }

  const secret = getSecretForProduct(claimedIssuer);
  if (!secret) {
    throw new ServiceTokenError(`No service-token secret configured for product "${claimedIssuer}"`);
  }

  let payload: ServiceTokenPayload;
  try {
    payload = jwt.verify(token, secret, {
      audience: JENNYSOL_AUDIENCE,
      issuer: claimedIssuer,
      algorithms: ["HS256"],
    }) as ServiceTokenPayload;
  } catch (err) {
    // Covers an invalid signature (forged/tampered token, or a token actually signed by a
    // different product's secret than it claims), an expired token, and a wrong audience —
    // jsonwebtoken's verify() checks all three and throws a real, specific error for each.
    throw new ServiceTokenError(
      `Invalid service token: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!payload.sub) {
    throw new ServiceTokenError("Service token missing subject (external user id)");
  }

  const scope = Array.isArray(payload.scope) ? payload.scope.filter((s): s is string => typeof s === "string") : [];

  return {
    product: claimedIssuer,
    externalUserId: payload.sub,
    role: typeof payload.role === "string" ? payload.role : undefined,
    tenantId: typeof payload.tenantId === "string" ? payload.tenantId : undefined,
    scope,
  };
}

/**
 * Mints a service token. Exists here as (a) the reference implementation a real product's own
 * backend mirrors (Arena's future `AgentServiceTokenIssuer.java` signs with the exact same
 * HS256/claims shape against the shared secret in `SERVICE_TOKEN_SECRET_ARENA`), and (b) what
 * this module's own tests and any fake product connector use to mint valid tokens without
 * hand-building a JWT — never used by real production traffic today, since JennySol issues
 * tokens for no one; it only ever verifies them.
 */
export function signServiceToken(claims: {
  issuer: string;
  externalUserId: string;
  role?: string;
  tenantId?: string;
  scope: string[];
  ttlSeconds?: number;
}): string {
  const secret = getSecretForProduct(claims.issuer);
  if (!secret) {
    throw new ServiceTokenError(`No service-token secret configured for product "${claims.issuer}"`);
  }
  const ttlSeconds = Math.min(claims.ttlSeconds ?? MAX_TOKEN_TTL_SECONDS, MAX_TOKEN_TTL_SECONDS);

  return jwt.sign(
    { role: claims.role, tenantId: claims.tenantId, scope: claims.scope },
    secret,
    {
      subject: claims.externalUserId,
      issuer: claims.issuer,
      audience: JENNYSOL_AUDIENCE,
      expiresIn: ttlSeconds,
      algorithm: "HS256",
    }
  );
}
