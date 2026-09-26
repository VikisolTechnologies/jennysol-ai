import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

const { app } = await import("../app.js");
const { createUser } = await import("../services/auth/userStore.js");
const { createSession } = await import("../services/auth/sessions.js");

async function makeAuth() {
  const user = createUser(`${randomUUID()}@example.test`, "x", "Test User", "candidate");
  const { token } = createSession(user.id);
  return { token, userId: user.id };
}

describe("agency tenant routes", () => {
  it("requires auth", async () => {
    const res = await request(app).post("/api/agency/tenants").send({ name: "Agency" });
    expect(res.status).toBe(401);
  });

  it("creates a tenant and makes the creator its first (owner) member", async () => {
    const { token } = await makeAuth();
    const res = await request(app).post("/api/agency/tenants").set("Authorization", `Bearer ${token}`).send({ name: "Northstar Staffing" });
    expect(res.status).toBe(201);
    expect(res.body.tenant.name).toBe("Northstar Staffing");
    expect(res.body.tenant.dataProcessingSetting).toBe("private_only");

    const list = await request(app).get("/api/agency/tenants").set("Authorization", `Bearer ${token}`);
    expect(list.body.tenants.map((t: { id: string }) => t.id)).toEqual([res.body.tenant.id]);
  });

  it("isolation: a user only ever sees tenants they're a member of", async () => {
    const userA = await makeAuth();
    const userB = await makeAuth();
    await request(app).post("/api/agency/tenants").set("Authorization", `Bearer ${userA.token}`).send({ name: "Agency A" });

    const listB = await request(app).get("/api/agency/tenants").set("Authorization", `Bearer ${userB.token}`);
    expect(listB.body.tenants).toEqual([]);
  });

  it("rejects a blank name", async () => {
    const { token } = await makeAuth();
    const res = await request(app).post("/api/agency/tenants").set("Authorization", `Bearer ${token}`).send({ name: "  " });
    expect(res.status).toBe(400);
  });
});
