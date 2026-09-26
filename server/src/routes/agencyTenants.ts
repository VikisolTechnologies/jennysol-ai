// ADR-007 §12 step 3: a minimal, real tenant bootstrap for the pilot — a signed-in JennySol user
// creates their agency once and becomes its first member (role 'owner'). There is no invite flow
// yet (out of scope for Stage 1, which needs no candidate data and no multi-recruiter workflow),
// but the isolation boundary this creates is real and enforced from the first tenant onward.
import { Router } from "express";
import { z } from "zod";
import { zodErrorMessage } from "../utils/zodError.js";
import { createTenant, addMember, listTenantsForUser } from "../services/agency/tenant.js";

export const agencyTenantsRouter = Router();

agencyTenantsRouter.get("/", (req, res) => {
  res.json({ tenants: listTenantsForUser(req.userId!) });
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Name your agency first").max(200),
});

agencyTenantsRouter.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }
  const tenant = createTenant(parsed.data.name);
  addMember(tenant.id, req.userId!, "owner");
  res.status(201).json({ tenant });
});
