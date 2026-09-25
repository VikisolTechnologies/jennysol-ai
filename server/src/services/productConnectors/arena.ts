// M5/M6 (Arena connector, PROJECT-PROGRESS.md milestone model): JennySol's implementation of
// ProductConnector for Arena — the FIRST real product connector, following the exact same
// interface every fake test connector (M3/M4's "acme"/"widgetco") already proved works. Per
// ADR-002, this file is the only place in JennySol's codebase allowed to know "Arena" exists as
// a concept — the tool registry and chat loop only ever see a generic ProductConnector.
//
// Cross-repo interoperability was verified live during M5's own implementation: a real token
// minted by Arena's actual `AgentServiceTokenIssuer.java` (arena-api) was accepted by
// `verifyServiceToken()`, correctly resolving to `{product: "arena", ...}`, and a tampered copy
// of that same real token was correctly rejected. That check used real Java output and can't be
// re-run automatically from this Node test suite (see arena.test.ts's own comment) — recorded as
// one-time verified evidence in PROJECT-PROGRESS.md's M5 entry, the same way this project already
// records other live-verified-once facts it can't keep re-proving in CI.
//
// Arena restructure Phase 3 ("Jenny"): READ tools run straight away (search, nearby activities,
// communities); WRITE tools (post, start a project, join, bid, apply) are never run off a model
// decision - routes/agentGateway.ts turns each into a PendingAction the user approves in Arena.
// Every WRITE forwards the exact service token Arena minted for that user, and Arena's
// AgentServiceTokenAuthenticationFilter independently re-checks that token's scope covers that
// specific endpoint (ADR-003) - this file is never trusted to enforce that itself.
import { ToolRejectedError, type ProductConnector, type RegisteredTool, type ToolExecutionContext } from "../tools/productConnector.js";
import type { ProductIdentity } from "../productIdentity.js";

// Arena's own production API by default — overridable for local dev against a different Arena
// deployment. Includes the `/api/v1` prefix (Arena's `server.servlet.context-path`).
const ARENA_API_BASE_URL = process.env.ARENA_API_BASE_URL || "https://api-arena.vikisol.in/api/v1";
// Where links in Jenny's answers point - the Arena web app.
const ARENA_WEB_URL = process.env.ARENA_WEB_URL || "https://arena.vikisol.in";

interface ArenaApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}

async function arenaGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ARENA_API_BASE_URL}${path}`, { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => ({}))) as ArenaApiEnvelope<T>;
  if (!res.ok || !body.success) throw new Error(body.message || `Arena ${path} returned HTTP ${res.status}`);
  return body.data as T;
}

async function arenaWrite<T>(method: "POST" | "PUT", path: string, payload: unknown, context: ToolExecutionContext): Promise<T> {
  const res = await fetch(`${ARENA_API_BASE_URL}${path}`, {
    method,
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.rawToken}` },
    body: JSON.stringify(payload ?? {}),
  });
  const body = (await res.json().catch(() => ({}))) as ArenaApiEnvelope<T>;
  const message = body.message || `Arena ${method} ${path} failed: HTTP ${res.status}`;
  // A 4xx is Arena refusing the request (full, closed, not allowed) - its transaction never ran.
  if (res.status >= 400 && res.status < 500) throw new ToolRejectedError(message);
  if (!res.ok || !body.success) throw new Error(message);
  return body.data as T;
}

// ---- shapes: only what Jenny needs to talk about a result (keeps tool results - and tokens - small)

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const clip = (v: unknown, n = 160) => {
  const s = str(v);
  return s && s.length > n ? `${s.slice(0, n)}…` : s;
};

function slimPost(p: Json) {
  return {
    id: p.id,
    demoContent: p.demoContent === true,
    kind: p.intentType,
    title: clip(p.title, 100),
    text: clip(p.body),
    by: p.authorName,
    anonymous: p.anonymous || undefined,
    where: p.locationText || undefined,
    startsAt: p.startsAt || undefined,
    spotsLeft: num(p.capacity) !== undefined ? Math.max(0, (p.capacity as number) - ((p.spotsFilled as number) ?? 0)) : undefined,
    joinable: p.joinable || undefined,
    replies: p.commentCount,
    community: p.communityName || undefined,
    url: `${ARENA_WEB_URL}/feed/${p.id}`,
  };
}

function slimJob(j: Json) {
  return {
    id: j.id,
    demoContent: j.demoContent === true,
    title: j.title,
    company: j.company,
    location: j.remote ? "Remote" : j.location,
    salaryLakhs: num(j.salaryMax) ? `${j.salaryMin}-${j.salaryMax}` : undefined,
    skills: Array.isArray(j.skills) ? (j.skills as string[]).slice(0, 5) : undefined,
    match: num(j.matchPercentage) || undefined,
    url: `${ARENA_WEB_URL}/jobs/${j.id}`,
  };
}

function slimProject(p: Json) {
  return {
    id: p.id,
    demoContent: p.demoContent === true,
    title: p.title,
    text: clip(p.description),
    budgetRupees: `${p.budgetMin}-${p.budgetMax}`,
    weeks: p.durationWeeks,
    bids: Array.isArray(p.bids) ? p.bids.length : undefined,
    skills: Array.isArray(p.skills) ? (p.skills as string[]).slice(0, 5) : undefined,
    url: `${ARENA_WEB_URL}/marketplace/${p.id}`,
  };
}

function slimCommunity(c: Json) {
  return {
    id: c.id,
    demoContent: c.demoContent === true,
    name: c.name,
    about: clip(c.description, 120),
    members: c.memberCount,
    threads: c.postCount,
    allowsAnonymous: c.allowAnonymous,
    youJoined: !!c.viewerRole,
    url: `${ARENA_WEB_URL}/discuss/c/${c.slug}`,
  };
}

// ---- READ tools

async function search(_identity: ProductIdentity, args: Json): Promise<unknown> {
  const query = str(args.query)?.trim();
  if (!query) throw new Error("search needs a query");
  const type = str(args.type) ?? "all";
  const q = new URLSearchParams({ q: query, type, limit: type === "all" ? "5" : "10" });
  const data = await arenaGet<Json>(`/search?${q}`);
  const list = (k: string) => (Array.isArray(data[k]) ? (data[k] as Json[]) : []);
  return {
    activities: list("activities").map(slimPost),
    discussions: list("discussions").map(slimPost),
    jobs: list("jobs").map(slimJob),
    projects: list("projects").map(slimProject),
    companies: list("companies").map((c) => ({ id: c.id, demoContent: c.demoContent === true, name: c.name, industry: c.industry, openJobs: c.openJobCount, url: `${ARENA_WEB_URL}/companies/${c.id}` })),
  };
}

async function nearbyActivities(_identity: ProductIdentity, args: Json): Promise<unknown> {
  const lat = num(args.lat);
  const lng = num(args.lng);
  if (lat === undefined || lng === undefined) throw new Error("nearbyActivities needs lat and lng - use the user's area from context");
  const radiusKm = Math.min(Math.max(num(args.radiusKm) ?? 10, 1), 50);
  const withinHours = Math.min(Math.max(num(args.withinHours) ?? 72, 1), 24 * 14);
  const q = new URLSearchParams({ lat: String(lat), lng: String(lng), radiusKm: String(radiusKm), withinHours: String(withinHours), intentType: "activity" });
  const posts = await arenaGet<Json[]>(`/posts/nearby?${q}`);
  return { count: posts.length, activities: posts.slice(0, 15).map(slimPost) };
}

async function listCommunities(_identity: ProductIdentity, args: Json): Promise<unknown> {
  const q = new URLSearchParams({ q: str(args.query) ?? "" });
  const communities = await arenaGet<Json[]>(`/communities?${q}`);
  return communities.slice(0, 15).map(slimCommunity);
}

// Kept for compatibility (earlier connector version); arena.search is the better tool now.
async function searchJobs(_identity: ProductIdentity, args: Json): Promise<unknown> {
  const page = typeof args.page === "number" && args.page >= 0 ? args.page : 0;
  const size = typeof args.size === "number" && args.size > 0 ? Math.min(args.size, 50) : 20;
  const data = await arenaGet<{ content?: Json[] }>(`/jobs?page=${page}&size=${size}`);
  return (data.content ?? []).map(slimJob);
}

// ---- WRITE tools (only ever run after the user approves - see file header)

async function createPost(_identity: ProductIdentity, args: Json, context: ToolExecutionContext): Promise<unknown> {
  const intentType = str(args.kind);
  if (intentType !== "activity" && intentType !== "ask" && intentType !== "update") throw new Error("kind must be activity, ask or update");
  const body = str(args.body)?.trim();
  if (!body) throw new Error("A post needs some text");
  const post = await arenaWrite<Json>(
    "POST",
    "/posts",
    {
      intentType,
      title: str(args.title),
      body,
      locationText: str(args.locationText),
      startsAt: str(args.startsAt),
      capacity: num(args.capacity),
      communityId: str(args.communityId),
      anonymous: args.anonymous === true,
      audience: "global",
      visibility: "public",
      tags: [],
      mediaUrls: [],
    },
    context
  );
  return { created: true, post: slimPost(post) };
}

async function createProject(_identity: ProductIdentity, args: Json, context: ToolExecutionContext): Promise<unknown> {
  const project = await arenaWrite<Json>(
    "POST",
    "/marketplace/projects",
    {
      title: str(args.title),
      description: str(args.description),
      budgetMin: num(args.budgetMin),
      budgetMax: num(args.budgetMax),
      durationWeeks: num(args.durationWeeks),
      skills: Array.isArray(args.skills) ? args.skills.filter((s) => typeof s === "string") : [],
    },
    context
  );
  return { created: true, project: slimProject(project) };
}

async function joinActivity(_identity: ProductIdentity, args: Json, context: ToolExecutionContext): Promise<unknown> {
  const postId = str(args.postId);
  if (!postId) throw new Error("joinActivity needs a postId");
  const join = await arenaWrite<Json>("POST", `/posts/${encodeURIComponent(postId)}/joins`, {}, context);
  return { requested: true, status: join.status, url: `${ARENA_WEB_URL}/feed/${postId}` };
}

async function placeBid(_identity: ProductIdentity, args: Json, context: ToolExecutionContext): Promise<unknown> {
  const projectId = str(args.projectId);
  const amount = num(args.amount);
  if (!projectId || !amount) throw new Error("placeBid needs a projectId and an amount in rupees");
  const bid = await arenaWrite<Json>("POST", `/marketplace/projects/${encodeURIComponent(projectId)}/bids`, { amount }, context);
  return { placed: true, amount: bid.amount, url: `${ARENA_WEB_URL}/marketplace/${projectId}` };
}

async function applyToJob(_identity: ProductIdentity, args: Json, context: ToolExecutionContext): Promise<unknown> {
  const jobId = str(args.jobId);
  if (!jobId) throw new Error("applyToJob requires a jobId");
  const application = await arenaWrite<Json>("POST", "/applications", { jobId }, context);
  return { applied: true, stage: application.stage, url: `${ARENA_WEB_URL}/jobs/${jobId}` };
}

const APPROVAL_NOTE =
  " This is a real action on the user's behalf: it only runs after they tap Approve in Arena. Propose it with complete, " +
  "sensible values, then tell them it's waiting for their approval - never say it's done.";

export const arenaConnector: ProductConnector = {
  product: "arena",

  assistantInstructions: [
    "You are Jenny, the assistant inside Arena - a local app for Hyderabad where people find activities nearby (sports, meetups, study groups), discuss things in communities, find jobs, and get projects built through bidding.",
    "Your job: understand what the person wants and get it done with the tools, in as few steps as possible. Search before you suggest; when something already exists (a game tonight, a job, a thread), point to it with its link rather than creating a duplicate. When nothing fits, offer to create it.",
    "Where things belong: activities (a time and place people can join) go on Nearby; questions and updates go in Discuss, optionally in a community; paid work is a project people bid on; jobs are applied to.",
    "When you propose an action, fill in every detail you reasonably can from what they said (title, a clear description, time as ISO-8601 with +05:30, place, capacity, budget in rupees) and say in one line what will happen when they approve. Ask one short question only when a detail truly can't be guessed.",
    "Anonymous posting is only for questions/updates, and only if they ask for it. Never create more than one post for a single request unless they asked for several.",
    "Keep replies short and friendly - a couple of sentences plus the relevant links. Links look like https://arena.vikisol.in/... - include them as plain URLs.",
  ].join("\n"),

  getTools(): RegisteredTool[] {
    return [
      {
        name: "arena.search",
        description:
          "Searches everything on Arena by keywords: activities, discussions, open jobs, projects open for bids, and companies. Every word must match. Use it before suggesting or creating anything.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Keywords, e.g. 'badminton gachibowli' or 'react developer'." },
            type: { type: "string", enum: ["all", "activities", "discussions", "jobs", "projects", "companies"], description: "Narrow to one kind; default all." },
          },
          required: ["query"],
        },
        tier: "READ",
        risk: "low",
        execute: search,
      },
      {
        name: "arena.nearbyActivities",
        description:
          "Lists activities happening near a point (games, meetups, study groups) that people can join, soonest-relevant first. Use the user's area from context for lat/lng.",
        parameters: {
          type: "object",
          properties: {
            lat: { type: "number" },
            lng: { type: "number" },
            radiusKm: { type: "number", description: "1-50, default 10." },
            withinHours: { type: "number", description: "Only activities starting within this many hours, default 72." },
          },
          required: ["lat", "lng"],
        },
        tier: "READ",
        risk: "low",
        execute: nearbyActivities,
      },
      {
        name: "arena.listCommunities",
        description: "Lists Discuss communities, most joined first, optionally matching a query. Use it to pick a community to post a question into.",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: [] },
        tier: "READ",
        risk: "low",
        execute: listCommunities,
      },
      {
        name: "arena.searchJobs",
        description: "Lists open jobs, newest first (no keyword filter - prefer arena.search with type 'jobs' for anything specific).",
        parameters: {
          type: "object",
          properties: {
            page: { type: "number", description: "Zero-based page number.", default: 0 },
            size: { type: "number", description: "Results per page, max 50.", default: 20 },
          },
          required: [],
        },
        tier: "READ",
        risk: "low",
        execute: searchJobs,
      },
      {
        name: "arena.createPost",
        description:
          "Creates a post: an 'activity' (people nearby can join - needs a place and a start time), an 'ask' (a question or need, can go in a community) or an 'update'." +
          APPROVAL_NOTE,
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["activity", "ask", "update"] },
            title: { type: "string", description: "Short headline (optional)." },
            body: { type: "string", description: "The post itself, in the user's voice." },
            locationText: { type: "string", description: "General area, e.g. 'Gachibowli' (activities)." },
            startsAt: { type: "string", description: "ISO-8601 start time with +05:30 offset (activities)." },
            capacity: { type: "number", description: "How many people can join (activities)." },
            communityId: { type: "string", description: "Community id from arena.listCommunities (ask/update only)." },
            anonymous: { type: "boolean", description: "Post under an alias - only for ask/update, only if the user asked." },
          },
          required: ["kind", "body"],
        },
        tier: "WRITE",
        risk: "medium",
        execute: createPost,
      },
      {
        name: "arena.createProject",
        description: "Posts a paid project that freelancers bid on." + APPROVAL_NOTE,
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string", description: "What needs building and what done looks like." },
            budgetMin: { type: "number", description: "Rupees." },
            budgetMax: { type: "number", description: "Rupees, at least budgetMin." },
            durationWeeks: { type: "number" },
            skills: { type: "array", items: { type: "string" } },
          },
          required: ["title", "description", "budgetMin", "budgetMax", "durationWeeks", "skills"],
        },
        tier: "WRITE",
        risk: "medium",
        execute: createProject,
      },
      {
        name: "arena.joinActivity",
        description: "Joins (or requests to join, if the host approves people) an activity by its post id." + APPROVAL_NOTE,
        parameters: { type: "object", properties: { postId: { type: "string" } }, required: ["postId"] },
        tier: "WRITE",
        risk: "medium",
        execute: joinActivity,
      },
      {
        name: "arena.placeBid",
        description: "Places a bid (in rupees) on a project that's open for bids." + APPROVAL_NOTE,
        parameters: { type: "object", properties: { projectId: { type: "string" }, amount: { type: "number" } }, required: ["projectId", "amount"] },
        tier: "WRITE",
        risk: "high",
        execute: placeBid,
      },
      {
        name: "arena.applyToJob",
        description: "Applies to a job posting by its id." + APPROVAL_NOTE,
        parameters: { type: "object", properties: { jobId: { type: "string", description: "The Arena job posting id to apply to." } }, required: ["jobId"] },
        tier: "WRITE",
        risk: "high",
        execute: applyToJob,
      },
    ];
  },

  // Same "has what it needs right now" convention as every other configured() in this codebase —
  // true once SERVICE_TOKEN_SECRET_ARENA is set to the same value Arena's own
  // AgentServiceTokenIssuer signs with.
  configured(): boolean {
    return !!process.env.SERVICE_TOKEN_SECRET_ARENA;
  },
};
