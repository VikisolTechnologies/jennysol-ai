import { Router } from "express";
import { getCapabilityRegistry } from "../services/capabilityRegistry.js";

export const capabilitiesRouter = Router();

// Unauthenticated on purpose — the intro screen (shown before any account
// exists) needs to know whether to advertise a capability like web search,
// and shouldn't have to wait on a guest login first just to ask. Strictly a
// subset of the admin config-health payload: only the `id`/`available`
// fields, never `provider`/`detail`/anything that hints at which vendor or
// why something's down — see capabilityRegistry.test.ts for the guarantee
// that no secret value can ever reach this registry in the first place.
capabilitiesRouter.get("/", (_req, res) => {
  const capabilities = getCapabilityRegistry().map((c) => ({ id: c.id, available: c.available }));
  res.json({ capabilities });
});
