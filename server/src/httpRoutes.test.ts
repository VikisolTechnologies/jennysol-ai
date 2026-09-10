import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Real HTTP-layer tests against the actual configured Express app (app.ts) —
// closing the gap the 2026-09-10 audit found: every prior test called
// service/store functions directly, so a bug in how a route wires auth,
// headers, or request parsing to those functions would never be caught.
// These go through the real middleware chain (requireAuth, rate limiting,
// zod validation) and the real SSE response format, the same path a real
// browser request takes — "production-equivalent," not a shortcut.
vi.mock("./services/llm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/llm.js")>();
  return { ...actual, streamChatCompletion: vi.fn() };
});

import { app } from "./app.js";
import { streamChatCompletion } from "./services/llm.js";

function extractSseText(rawBody: string): { deltas: string; sawDone: boolean; provider?: string } {
  let deltas = "";
  let sawDone = false;
  for (const line of rawBody.split("\n\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const payload = JSON.parse(line.slice(6));
      if (payload.type === "message.delta" && payload.delta) deltas += payload.delta;
      if (payload.type === "done") sawDone = true;
    } catch {
      // partial/trailing chunk — ignore
    }
  }
  return { deltas, sawDone };
}

async function createGuest(): Promise<{ token: string; userId: string }> {
  const res = await request(app).post("/api/auth/guest");
  expect([200, 201]).toContain(res.status);
  return { token: res.body.token, userId: res.body.user.id };
}

describe("HTTP routes — health & auth gate", () => {
  it("GET /health returns ok with a version, unauthenticated", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.version).toBe("string");
  });

  it("a protected route with no token returns 401, not a crash or a default identity", async () => {
    await request(app).get("/api/conversations").expect(401);
    await request(app).post("/api/chat").send({ message: "hi" }).expect(401);
  });

  it("a protected route with a garbage bearer token returns 401", async () => {
    await request(app)
      .get("/api/conversations")
      .set("Authorization", "Bearer not-a-real-token")
      .expect(401);
  });
});

describe("HTTP routes — guest identity, real end to end", () => {
  it("two separate guest signups over real HTTP get different ids and never share history", async () => {
    const a = await createGuest();
    const b = await createGuest();
    expect(a.userId).not.toBe(b.userId);

    const aConvos = await request(app).get("/api/conversations").set("Authorization", `Bearer ${a.token}`).expect(200);
    expect(aConvos.body.conversations).toEqual([]);
  });
});

describe("HTTP routes — /api/chat deterministic short-circuits (real SSE response)", () => {
  beforeEach(() => {
    vi.mocked(streamChatCompletion).mockReset();
  });

  it("a time question over real HTTP+SSE gets the deterministic answer, model never called", async () => {
    const { token } = await createGuest();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Timezone", "Asia/Kolkata")
      .send({ message: "Tell me the time" })
      .expect(200);

    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    const { deltas, sawDone } = extractSseText(res.text);
    expect(sawDone).toBe(true);
    expect(deltas).toContain("Asia/Kolkata");
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it("a named-city time question over real HTTP does NOT leak the caller's own timezone", async () => {
    const { token } = await createGuest();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Timezone", "Asia/Kolkata")
      .send({ message: "What time is it in London right now?" })
      .expect(200);

    const { deltas } = extractSseText(res.text);
    expect(deltas).toContain("London");
    expect(deltas).not.toContain("Asia/Kolkata");
  });

  it("an identity question over real HTTP gets the canonical response, model never called", async () => {
    const { token } = await createGuest();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Who created JennySol?" })
      .expect(200);

    const { deltas } = extractSseText(res.text);
    expect(deltas).toContain("Vikisol Labs");
    expect(deltas).toContain("Syam Prabhakar Seeli");
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it("an unverifiable current-info question over real HTTP gets an honest fallback, model never called", async () => {
    const { token } = await createGuest();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Who is the current Queen of Thailand?" })
      .expect(200);

    const { deltas } = extractSseText(res.text);
    expect(deltas.toLowerCase()).toContain("can't verify");
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it("a normal message over real HTTP still reaches the real provider path", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(async (_sys, _hist, onDelta) => {
      onDelta("4");
      return { providerUsed: "gemini", fellBack: false };
    });

    const { token } = await createGuest();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "What's 2 + 2?" })
      .expect(200);

    const { deltas } = extractSseText(res.text);
    expect(deltas).toBe("4");
    expect(streamChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("a malformed request body is rejected with 400, not a 500 or a hang", async () => {
    const { token } = await createGuest();
    await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "" })
      .expect(400);
  });
});

describe("HTTP routes — conversation ownership (real HTTP, not a direct store call)", () => {
  it("one guest can never read or rename another guest's conversation by id", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(async (_sys, _hist, onDelta) => {
      onDelta("hi there");
      return { providerUsed: "gemini", fellBack: false };
    });

    const owner = await createGuest();
    const intruder = await createGuest();

    const chatRes = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ message: "hello" })
      .expect(200);
    const started = chatRes.text
      .split("\n\n")
      .map((l) => (l.startsWith("data: ") ? JSON.parse(l.slice(6)) : null))
      .find((p) => p?.type === "run.started");
    const conversationId = started.conversationId as string;

    await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${intruder.token}`)
      .expect(404);

    await request(app)
      .patch(`/api/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${intruder.token}`)
      .send({ title: "hijacked" })
      .expect(404);

    // Owner's own access is unaffected.
    await request(app)
      .get(`/api/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
  });
});
