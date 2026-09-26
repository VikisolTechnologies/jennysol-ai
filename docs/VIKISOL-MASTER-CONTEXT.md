# VIKISOL — MASTER CONTEXT

**Owner:** Syam (Founder & MD, Vikisol Technologies, Hyderabad)
**Last updated:** 26 September 2026
**Purpose:** the single reference for what we are building, why, and how. Every AI agent (Claude, Claude Code, Cursor, Codex, ChatGPT) reads this before any architecture, design or build decision. When something here conflicts with an older doc, this file wins. When it conflicts with the live code or production, **reality wins**: update this file.

---

## 0. How to use this file

- **Starting a new chat or agent session:** attach this file and say "Read VIKISOL-MASTER-CONTEXT.md first."
- **Judging any blueprint, design or PR:** use the checklist in §12.
- **When a decision is made:** update §11 (Open decisions) and §10 (Status).
- **Where the copies live:**
  - the Claude Project "Vikisol Eco System",
  - `docs/` in `jennysol-ai`, `Vikisol-Arena-FE` and `Vikisol-Arena-BE`.

---

## 1. The vision in one breath

> **Vikisol is building an ecosystem where Arena is the living human network, JennySol is the intelligence that helps people and products understand and act, and Vikisol One is the organizational/workforce layer — all connected through a secure identity and controlled APIs, without collapsing their data boundaries.**

The north stars:

| Product | North star |
|---|---|
| **Arena** | `NEED → RESPONSE → CONVERSATION → OUTCOME → IDENTITY → NEW NEED` |
| **JennySol** | *"JennySol doesn't just answer you. JennySol gets the work done."* |
| **Company strategy** | *Build the workforce first. Build the marketplace second. Build proprietary model intelligence when the economics justify it.* |

The deepest idea, to protect above everything else:
- Arena is not fundamentally about jobs.
- JennySol is not fundamentally about chat.
- Vikisol One is not fundamentally about employee forms.

It is **people + intelligence + organizations + outcomes** working together.

---

## 2. How Syam wants us to work (founder's principles)

1. **Simple, cheap, free, easy.**
   - Free tiers and local models first.
   - No new paid service or key without Syam's approval, and every request states its monthly cost.
2. **Minimal code.**
   - One shared component library, one API client, one way of doing each thing.
   - No stale code, dead routes, duplicate components or outdated docs.
3. **Verify before you build.** The sequence is always: `VERIFY → BLUEPRINT → CHALLENGE → AGREE → DESIGN → BUILD → TEST → DEPLOY`.
   - Ground truth beats documentation. (Example: the "production is in mock mode" claim was proven wrong by checking the live app.)
4. **Refactor, don't rewrite.** Claude built roughly half of JennySol and most of Arena. Keep what works and reshape it into the target architecture.
5. **UI changes need his approval first.** Show mockups or images, get approval, then build.
6. **Finish in one go, and ask for access once.**
   - Agents work continuously and stop only at agreed gates.
   - Any missing access goes into one consolidated list, asked once.
7. **Deploy live so he can test on his phone.**
   - `/version` and a footer commit stamp prove what is actually deployed.
8. **Right model for the job.**
   - Strongest reasoning model (Opus/Fable class) for architecture, audit, security and final review.
   - Cheaper models (Sonnet/Haiku class) for routine coding and tests.
   - Final verification is done by a fresh agent that didn't write the code.
9. **Honesty over polish.**
   - Never fake activity, metrics, users or answers.
   - "Arena is quiet right now" beats "1,248 people online".
   - Failed actions never pretend to have succeeded.
10. **Mobile first.**
    - Touch targets ≥ 44px, no hover-only actions.
    - Fast cold load on a phone.
    - Every visible button works; anything unfinished is hidden behind a flag.

---

## 3. The team and the workflow

```
                 SYAM  — product owner, final approval
                   │
                 CLAUDE (chat, linked to the Mac) — THE architect + reviewer
            ┌──────┴───────┐
        CURSOR           CLAUDE CODE (VS Code)
      builds Arena       builds JennySol
            └──────┬───────┘
          CODEX / CHATGPT — idea expander only (ideas become work
                            only via the architect)
                   │
                GITHUB (VikisolTechnologies)
```

- **Git.** Work on `feature/*` branches. Merge to `main` only when tests are green. Never force-push `main`.
- **Operating protocol.** `docs/AGENT-COLLABORATION-PROTOCOL.md` (written by Codex) is the rulebook for how agents work in parallel: git sync, one owner per repo, review files in `docs/reviews/<SHA>.md`, visual QA, quality gates. Every agent follows it. **Roles (decided by Syam, 26 Sep 2026):** Claude (architect chat, linked to the Mac) is the single **architect and reviewer**. It writes the missions and review files (`docs/reviews/<SHA>.md`) that Cursor and Claude Code execute. Codex is an **idea expander** only.
- **Handoff.** Every agent keeps `docs/PROGRESS.md` (phase, branch, done, next, open questions) so another agent can resume from it alone.
- **Secrets.** Never paste keys into any chat. Agents read them from `.env` or the Railway/Vercel CLIs and never print or commit them.
- **Active missions** (26 Sep 2026):
  - `ARENA-VNEXT-MISSION.md` + `ARENA-MISSION-ADDENDUM.md`, running in Cursor.
  - `JENNYSOL-MISSION.md` (v2) + `JENNYSOL-MISSION-ADDENDUM.md`, running in Claude Code.

---

## 4. Ecosystem architecture

```
                        VIKISOL WEBSITE (public, no login wall)
                                     │
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                       ▼
          ARENA                  JENNYSOL               VIKISOL ONE
      human network            AI brain / workforce     organizations / HR
             │                       │                       │
             │               Agent Gateway + Tools            │
             │                       │                       │
             └──────── controlled, scoped APIs only ─────────┘
                    │                                   │
                 Arena DB                             HR DB
               (owned by Arena)                (owned by Vikisol One)

                  VIKISOL IDENTITY (future SSO) sits above all three
```

### Data ownership (never blur this)

| Owner | Owns |
|---|---|
| **Arena** | users, profiles, posts, jobs, projects, companies, applications, marketplace, bids, rooms |
| **Vikisol One** | organizations, employees, HR records, roles, policies, tenants |
| **JennySol** | AgentRuns, AI conversations, model routing, AI tools, AI memory, orchestration, audit |
| **Website** | public company presentation and marketing content |

### Rules that always hold

1. **JennySol never gets another product's database credentials.** It reaches them only through their APIs, with the user's own permissions.
2. **Identity ≠ authorization.**
   - Logging in once (future Vikisol Identity / SSO) does not grant access to every product.
   - Microsoft can be an identity provider. It is never Vikisol's authorization system.
   - A valid Arena account can have Vikisol One access = NO.
3. **Authorization is enforced server-side.** Never trust role, tenant or ID claims sent by the client.
4. **No "everything connects to everything."** Products talk only through controlled interfaces.
5. **The public website stays public.** Login belongs to the products, not the website.

---

## 5. ARENA — the living network

### 5.1 What it is and isn't
- **It is:** a living network where people find each other, discover opportunities, collaborate, meet around activities, and produce real outcomes. Need + People + Place + Conversation + Action + Outcome.
- **It is not:** Naukri, a LinkedIn clone, a resume database, or a generic marketplace.

### 5.2 The product hierarchy (the navigation must express this)

| Surface | Meaning | Answers |
|---|---|---|
| **Feed** | The life of Arena (front door) | What's happening? |
| **Discover** | The network of Arena | Who and what exists? |
| **Map** | The world around Arena | What's happening around me? |
| **Agent (Jenny)** | The intelligence of Arena | Help me understand and act |
| **Work** | The outcomes of Arena | What am I actually involved in? |
| **+ Create** | Creation in Arena | What do I want to make happen? |
| **Profile** | Identity in Arena | Who am I here (built from real outcomes)? |

### 5.3 Surface details
- **Feed.**
  - Contains: Needs, jobs, projects, people, activities, sessions, opportunities, responses, collaborations, local activity, recommendations, Jenny insights.
  - The test: *why would someone open Arena today if they aren't job hunting?*
- **Sessions** (people meeting around an activity: sport, study, meetup, workshop, collaboration).
  - A real feature that needs: date/time, capacity, RSVP states, organizer, participant state, cancellation, no-show handling, reporting, moderation, safety and location privacy.
  - Build on existing ACTIVITY posts: open or approval join, auto group Room, coarse geohash with jittered pins, meeting-point reveal, age-gating, report/block.
  - **Never show Session UI the backend can't honour.**
- **Map:** needs, people, projects, sessions, activities, services and opportunities nearby. Not just "a map with job pins".
- **+ Create:** I need something / I can offer something / start a project / create a job / create a session or activity / ask Jenny for help. Never "POST JOB".
- **Work:** applications, projects, bids, collaborations, interviews, offers, active work, sessions and completed outcomes.
- **Agent:** ambient on every screen, never "just another chatbot tab":
  - Feed: "3 opportunities for you"
  - Map: "project nearby matches your skills"
  - Discover: "possible collaborators"
  - Work: "interview tomorrow"
  - Create: "turn this idea into a Need?"

  Jenny only **drafts**; the user confirms. Where the live approval flow exists (propose → user taps Approve → execute), approval-gated execution counts as the same principle, done properly. Voice-first navigation, form-fill and conversational onboarding come from JennySol. **Arena contains no AI logic of its own.**
- **Arena Pulse:** real network activity only. Cold start is solved with honest empty states, useful recommendations, meaningful onboarding, nearby discovery and Jenny's help.

### 5.4 Core primitive
Every Post (ACTIVITY / HELP / PROJECT / JOB / UPDATE / COMPANY) can open a **Room** (conversation). Jobs, bidding, enterprise and the agent all survive as post types or flows on top of this.

### 5.5 Roles
talent, recruiter, company_admin, hiring_manager, platform_admin. These are role-gated route groups in one codebase: the recruiter workspace, the company-admin console, and Vikisol's platform admin over all tenant companies.

### 5.6 Visual direction
- **Keep** the live Arena palette and brand DNA. The audit on 26 Sep 2026 found the live look is **near-black + orange**, and that is the primary palette. An ivory/black/orange variant is shown beside it in the mockups for Syam to compare.
- The live nav today is Home, Nearby, Discuss, Work, Inbox. VNext maps it to the §5.2 hierarchy.
- **Fix** hierarchy, spacing, density, depth, imagery, editorial typography, whitespace and meaningful motion.
- **Less of:** uniform cards, heavy borders, nested boxes, and every module looking the same.
- **Three visual languages on one brand:**
  - **Living Companion**: Jenny moments. Warm, alive, an orb with a soft glow, but lightweight.
  - **Talent Atlas**: Discover and Map. Network, connections, place.
  - **Studio Ledger**: Work. Clean, editorial, outcome-focused, information-dense.
- 3D stays, but it must never block first paint: lazy-load it, use quality tiers on mobile, pause it when off-screen.

### 5.7 Never do this in Arena
- Turn Arena into Naukri or LinkedIn.
- Make Agent a chatbot tab.
- Make Map a job map.
- Make Feed a job feed.
- Build Sessions as fake UI.
- Show fake metrics.
- Give JennySol database access.
- Give Arena any HR data.

### 5.8 Infrastructure (verify before trusting)
- **Repos:** `Vikisol-Arena-FE` (Next.js) and `Vikisol-Arena-BE` (Spring Boot 3.3 / Java 21).
- **Live:** `arena.vikisol.in` and `api-arena.vikisol.in`, with Arena's own Postgres + Redis.
- **Security:**
  - JWT pinned to HS256.
  - Authorization is loaded server-side.
  - A permanent Playwright E2E suite covers routes × roles, desktop + Android + iPhone, web vitals and axe accessibility checks.

---

## 6. JENNYSOL — the AI workforce platform

### 6.1 Positioning
> **We don't build another chatbot. We build the AI workforce infrastructure first, then the agents, then the marketplace, and eventually proprietary model intelligence.**

JennySol should:
- understand goals,
- plan the work and use tools,
- remember context and retrieve knowledge,
- execute multi-step workflows and delegate to specialist agents,
- ask for human approval before consequential actions,
- report measurable outcomes.

**Its moat is not the LLM.** The moat is:
- the runtime,
- memory,
- tools,
- workflows,
- integrations,
- permissions,
- the marketplace,
- governed usage data,
- enterprise deployment.

Models stay replaceable.

**What we are NOT building first:**
- a foundation model trained from zero,
- a generic chatbot competing only on conversation quality,
- an unrestricted autonomous computer controller,
- a hard-coded monolith.

### 6.2 Core flow
```
USER / VOICE / CHAT / API → AGENT GATEWAY → AGENT RUNTIME → PLANNER/REASONER
  → TOOL REGISTRY / AGENT REGISTRY → EXECUTION → MEMORY / KNOWLEDGE
  → MODEL GATEWAY → LOCAL OR CLOUD MODEL → RESPONSE → AUDIT
```
```
                 JENNYSOL
                    │
               AGENT CORE  (runtime · tools · approvals · memory · audit)
                    │
              MODEL GATEWAY
        ┌───────────┼───────────┐
     Ollama       Cloud        Future
  (Qwen/DeepSeek) (Gemini,     (GPU fleet,
                  DeepSeek…)   own Jenny model)
```

### 6.3 Agent runtime: the execution loop
The runtime is a deterministic state machine around model calls. **The model proposes; the runtime decides** whether an action is valid and permitted.
1. Receive the goal.
2. Load identity, organization policy, memory and context.
3. Classify the task and its risk.
4. Retrieve knowledge.
5. Plan.
6. Validate the plan against permissions.
7. Execute a tool, or delegate to an agent.
8. Store the observation.
9. Check whether the goal is complete.
10. Re-plan if it isn't.
11. Pause for approval if an action requires it.
12. Finalize the result with evidence.
13. Persist the run and audit trail.

**Stop conditions:**
- goal completed,
- step/time/cost budget reached,
- required information unavailable,
- a tool keeps failing,
- policy violation,
- approval needed,
- insufficient confidence or evidence.

AgentRun states: `queued → running → awaiting_approval → completed / failed / cancelled`. Runs are durable, resumable and **stoppable by the user**.

### 6.4 Model gateway and fleet
- **Stable interface:** `generate()`, `stream()`, `route(task, context)`. Providers are adapters (Ollama, Gemini, DeepSeek, future). Models are configuration, not code.
- **Routing inputs:** task type, privacy tier, health, latency, capability and cost. Default order: local → cheap cloud → premium (only with approval).
- **Current Mac fleet** (M1 Pro, 16GB), reached from production over **Tailscale**:

  | Model | Role |
  |---|---|
  | `qwen3:8b` | general |
  | `qwen3:4b` | fast |
  | `qwen2.5-coder:7b` | code |
  | `deepseek-r1:7b` | reasoning |

- **Cloud:** Gemini for text, TTS and images. DeepSeek code exists, but there is no production key.
- **Future hardware:** 1× RTX 5090 (32GB VRAM, 128GB RAM), scaling to 2× (64GB VRAM, 256GB RAM). Candidates: larger Qwen/Qwen-Coder, DeepSeek distills, Mistral/Devstral, Gemma, Granite, Qwen-VL vision, Whisper, Kokoro.
- **Keep the fleet curated.** Every model has a defined role; no installing hundreds "because they exist".
- **There is no "local Claude."** Claude can only ever be a cloud provider.

### 6.5 Privacy tiers
| Tier | Where it runs |
|---|---|
| **LOCAL** | Never leaves the Mac/GPU box (private docs, personal data) |
| **PRIVATE** | Vikisol-controlled infrastructure |
| **PUBLIC_CLOUD** | Only when cloud processing is acceptable |

A request is **never silently escalated to cloud**; if its tier isn't available, it fails honestly.

### 6.6 Tools and autonomy
Every capability is a typed tool with a schema, an executor, permission scopes and audit behaviour.

**Tool groups:**
- **Knowledge:** search, get and summarize documents.
- **Web:** search, open, extract.
- **Files:** list, read, create.
- **Communication:** email and Teams.
- **Calendar.**
- **Vikisol:** Arena, One and Document Engine APIs.
- **Development:** git status, read repo, run tests, create branch, create PR.
- **Browser.**
- **Computer.**
- **Data.**

| Risk | Example | Default |
|---|---|---|
| Low | read doc, search web | Automatic |
| Medium | routine email, calendar event | Policy-based / confirm |
| High | bulk outreach, production deploy | Explicit approval |
| Critical | money transfer, destructive delete | Explicit approval + strong auth |

**"Autonomous when safe. Approval when consequential."**
- Tools are capabilities, not open access. No unrestricted shell, filesystem, database, network or secrets.
- Browser and computer workers are sandboxed.

### 6.7 Memory and knowledge
- **Memory types:**
  - working,
  - conversation,
  - user,
  - organization,
  - project,
  - episodic (lessons from past runs).
- **Scope:** every memory item is scoped by **user + product + tenant + purpose**. Arena, HR and personal data never mix in one uncontrolled store. Users can see, export and delete their memory.
- **RAG pipeline:** ingest → parse → chunk → metadata → embed → vector store → retrieve → filter/rerank → assemble → model.
  - Currently: in-process ONNX embeddings (`all-MiniLM-L6-v2`), which are free.
  - The plan names pgvector as the store.
- **Prompt injection:** external and retrieved content is **data, never instructions**.

### 6.8 Agent workforce (later, designed now)
- Start with one reliable general Jenny. Add specialists only when a repeated workload justifies them: Research, Developer, QA, Sales, Recruitment, Support, Operations.
- A supervisor agent coordinates the specialists, and each specialist gets narrow tool permissions.
- **Goal Mode:** "Get me 20 qualified leads this week." Jenny plans, executes and reports progress.
- **Always-on Jenny:** watches approved sources and says "something needs your attention."
- **Outcome dashboard:** tasks done, hours saved, approvals pending.

### 6.9 Arena as agent platform (plan Phase 4, months 7–12)
Arena later gains these areas *without losing its living-network identity*:
- **Agent Studio**: create and configure agents.
- **Tool Studio**: register and test tools.
- **Workflow Studio**: compose repeatable workflows.
- **Playground**: test agents against scenarios.
- **Run Center**: watch live tasks and tool calls.
- **Approvals**: human-in-the-loop decisions.
- **Agent Store**: publish, buy and install agents.
- **Analytics**: success rate, time saved, cost, failures, ROI.
- **Team Workspace**: humans and agents working on goals together.

See §11 for how this fits the current Arena VNext.

### 6.10 Individual JennySol
Each person gets a tenant-isolated workspace with:
- identity and preferences,
- private memory,
- connected email, calendar and files,
- a personal agent library,
- voice and chat,
- an approval inbox,
- task history,
- cost controls,
- per-tool on/off switches.

Channels: web, iOS, Android, desktop, WhatsApp, voice.

### 6.11 Monetization (sell completed work, not tokens)
| Stream | Model |
|---|---|
| JennySol Personal | Free tier + paid subscription (idea: ₹499–999/month) |
| AI Employee | Per-agent monthly (e.g. SDR, Recruiter, Support, Developer, Ops Jenny; examples ran ₹15k–40k/month) |
| Business platform | Per seat + usage + workflow executions |
| Agent Marketplace | Revenue share on third-party agents |
| Enterprise | Annual contract: private/VPC deployment, SSO, RBAC, audit, SLA |
| Services | Custom integrations and agent implementation |

All prices are **examples to validate with real customers, not decisions.**

**Go-to-market:** start where ROI is measurable:
1. recruitment agencies (our edge: Arena + Vikisol One + Document Engine),
2. software teams (Developer + QA Jenny),
3. sales teams (SDR),
4. support teams,
5. SMBs (Operations Jenny).

No ads-first strategy and no chasing millions of free users.

**Flywheel:** more developers → more agents → more capabilities → more businesses → more usage and feedback → better agents.

### 6.12 Roadmap (from the master execution plan)
| Phase | When | What |
|---|---|---|
| 0 Foundation | Weeks 1–2 | Freeze the thesis; core contracts (Agent, Tool, Task, Memory, Approval, Model); security and tenancy boundaries; CI |
| 1 Agent Core MVP | Weeks 3–8 | Runtime, Model Gateway (Ollama/Qwen/DeepSeek adapters), Tool Registry, task/run persistence, plan→execute→observe loop, web/files/knowledge tools, approvals, tracing and audit |
| 2 Useful JennySol | Weeks 9–14 | Email/calendar, RAG over Vikisol docs, user/org memory, Arena + One APIs, task dashboard, voice (**after** text execution is reliable), daily internal use |
| 3 Agent Workforce | Weeks 15–24 | Specialists, supervisor/delegation, reusable workflows, browser automation, eval suite, durable workflows, agent analytics |
| 4 Arena Agent Platform | Months 7–12 | Agent Studio, Playground, publishing/versioning, marketplace foundation, metering, SDK, first design partners |
| 5 Enterprise | Months 12–18 | SSO/RBAC, org policies, private knowledge and routing, enterprise audit, dedicated workers, VPC |
| 6 Scale | 18+ months | Multi-region if justified, marketplace ecosystem, fine-tuning, own model only when economics justify it |

**First 30 days, in order:**
1. Architecture docs + an ADR folder.
2. Contracts for Agent, Tool, Task, Run, Memory and Approval.
3. Schema and migrations.
4. Model Gateway with an Ollama adapter.
5. A second adapter, to prove provider independence.
6. Tool Registry with JSON-schema validation.
7. The runtime state machine.
8. The planner/executor loop.
9. A web search tool.
10. A file/knowledge tool.
11. A task/run dashboard.
12. Audit events and trace IDs.
13. The approval endpoint and UI.
14. One Arena endpoint and one Vikisol One endpoint.
15. 20 deterministic eval scenarios.
16. Run against real internal workflows.
17. Measure completion rate, tool errors, latency, cost and human intervention.

### 6.13 Quality: metrics, gates, Definition of Done
- **Metrics:**
  - task success,
  - first-pass success,
  - tool success,
  - recovery rate,
  - human intervention rate,
  - time saved,
  - cost per successful task,
  - latency,
  - safety violations (target zero),
  - evidence quality.
- **Release gates:**
  - no critical authorization bypass,
  - every high-risk action approved,
  - every tool action auditable,
  - tenant isolation tested,
  - bounded budgets,
  - regression tests on core workflows,
  - no silent failures.
- **JennySol v1 is done when:**
  - a user can give a multi-step goal;
  - Jenny plans and executes it;
  - Jenny uses **≥ 10 safe tools**;
  - Jenny retrieves private knowledge with tenant isolation;
  - Jenny remembers approved context;
  - Jenny pauses for approval;
  - Jenny recovers from common tool failures;
  - every action is traceable;
  - the user can see what Jenny is doing **and stop it**;
  - **3 real Vikisol workflows** run end to end;
  - the model can be swapped without rewriting the agent.
- **Own model:** not from scratch. Build the platform first, collect opt-in governed data, find repeated failures, then fine-tune or distill only when it measurably wins on cost or quality.

### 6.14 JennySol state (verified by Claude Code, 26 Sep 2026)
**Already done:**
- Reasoning routes to `deepseek-r1:7b`.
- Vision works: `qwen3-vl:4b` as the VISION capability (also installed: `qwen3-vl:8b`, `moondream`).
- **The Arena ↔ Jenny gateway is live in production** (`/api/agent/gateway/chat`, `/actions/:actionId`).
  - Write tools: `arena.createPost`, `joinActivity`, `createProject`, `placeBid`, `applyToJob`.
  - Flow: propose → approve → execute, with single-use actions, 5-minute expiry, and scope checks on both sides.
  - Verified end to end against production.
- **Extend it; never redesign it** (see `server/src/routes/agentGateway.ts` and `productConnectors/arena.ts`).
- Tests: 682 passed, 2 skipped. Tip `33abb27`, everything pushed.
- `OLLAMA_MODEL=llama3.2` in `.env` is an intentional dead fallback. Leave it.

**Still open:**
1. No cold-start warming/`keep_alive` for chat models.
2. No LOCAL/PRIVATE/PUBLIC_CLOUD privacy tiers.
3. No production DeepSeek key.
4. No local STT/TTS (today: browser STT + Gemini TTS; future: whisper.cpp + Kokoro).

**Workflow:** feature branches from 26 Sep 2026 on (three agents now). Before that, it was small direct commits to `main`.

### 6.15 Infrastructure path
- **Today:** backend on Railway (`jennysol-ai-api`), frontend on Vercel. Ollama on the Mac, reached over Tailscale.
- **Future:** `jennysol.vikisol.in` served from the Mac or GPU box, through tunnel → reverse proxy → JennySol → model runtime.
- **Cutover order (founder-led, never automatic):**
  1. Keep production stable.
  2. Build the private infrastructure.
  3. Test.
  4. Secure access.
  5. Cut over.
  6. Rotate credentials.
- The Mac is never exposed directly to the internet.
- Start lean. No Kubernetes, Kafka or Temporal until the workload demands it.

---

## 7. VIKISOL ONE (formerly HRLMS): workforce layer

- **Repos:** `Vikisol-One-FE` and `Vikisol-One-BE` (Spring Boot 3.3 / Java 21 on Railway). Production holds **real employee data**; its Railway project is `enchanting-vibrancy`.
- **Vision:** internal Vikisol HR first; later a multi-tenant product licensed to other organizations.
- **Access chain:** identity → organization membership → account status → role → tenant authorization → access. Tenant boundaries are enforced server-side, so manipulated URLs, IDs, JWT claims or frontend state get nowhere.
- **Jenny ↔ One:** only through a One connector/API that applies One's own authorization. (An employee asking Jenny "show everyone's salary" gets nothing.)
- **Priority:** paused while Arena and JennySol are built. **Agents never touch One production.**

## 8. VIKISOL WEBSITE
`VikisolTechnologies/VikisolWebsite` is the public front door for the company and ecosystem, linking to Arena, JennySol and One. It stays public, with no authentication wall.

---

## 9. Repositories, services and safety

| Product | Repos | Hosting |
|---|---|---|
| Website | `VikisolWebsite` | — |
| Arena | `Vikisol-Arena-FE`, `Vikisol-Arena-BE` | Vercel / Railway (`arena-staging`) |
| JennySol | `jennysol-ai` (frontend + backend) | Vercel / Railway (`jennysol-ai-api`) + Mac Ollama |
| Vikisol One | `Vikisol-One-FE`, `Vikisol-One-BE` | Vercel / Railway (`enchanting-vibrancy`, **production, never touch**) |

**Third-party services:**
- GitHub, Railway, Vercel
- Google (Gemini, sign-in, Maps)
- Cloudinary
- Resend (email)
- Sentry
- Tavily (search)
- Tailscale
- DNS provider for `vikisol.in` (Syam only)

**Free, no key needed:** Open-Meteo, Unsplash links, Hugging Face downloads, Ollama.

**Not set yet, and needing Syam's approval:**
- `DEEPSEEK_API_KEY` (cheap; recommended as a backup)
- `ANTHROPIC_API_KEY` (paid)
- `FAL_KEY` (paid)
- a local image worker (free, needs setup)

**Hard safety rules for every agent:**
- Never print or commit secrets.
- No DNS changes.
- No destructive production data operations.
- No force-push to `main`.
- Never touch One production.
- No paid services without approval.
- No UI redesign without approval.
- No fake data in production.

---

## 10. Status (26 September 2026)

- **Arena:**
  - Live on the real backend, production commit `3093442`. Candidate and enterprise sides are both verified.
  - The company admin reaches the enterprise area with a password only, no 2FA. This is being checked as a security finding.
  - The audit is in `docs/ARENA-CURRENT-STATE.md`.
  - The cleanup that fixes the 35 test failures is on `feature/arena-cleanup` (merge pending).
  - Blocked on Syam: Sentry "Allowed Domains" needs `arena.vikisol.in`.
  - Home's first-load JavaScript is over the 200KB budget; the fix is splitting the app shell in VNext.
  - **Cursor** is running the VNext mission: audit → cleanup → blueprint + mockups → *STOP GATE 1 (Syam approves)* → build → test → deploy → report.
- **JennySol:**
  - Claude Code finished the JENNYSOL-FINISH-ALL run on branch `feature/jenny-audit` (7 commits, **not merged, not deployed**). Production is still `33abb27`.
  - Built: contract tests + risk ratings on the live gateway, a Goal Mode runtime (3/3 live scenarios pass), document export/delete, keep-warm and hedging behind off-by-default flags, the architecture doc, and 5 UI mockups in `docs/design/`.
  - Not done: privacy tiers (designed only), full re-planning, the dashboard UI, workflows (b) and (c), the 20-scenario eval, independent review, voice, preview deploy.
  - **Cost finding:** almost all live chat is paid Gemini, because Ollama is last in the provider chain. That goes against local-first; see §11.
  - Next: `docs/JENNYSOL-NEXT.md`.
  - The Arena gateway is already live. Claude Code documents it in `docs/JENNY-ARENA-CONTRACT.md` and extends it.
  - Cursor must not break the Arena endpoints this gateway uses; contract tests guard them.
  - Arena ARENA-FINISH-ALL run: fixes go to production; VNext UI goes to a private preview and waits for Syam's approval.
- **Vikisol One:** paused.
- **Next reviews for Claude (architect):**
  - `ARENA-CURRENT-STATE.md`, `ARENA-VNEXT-BLUEPRINT.md` + mockups
  - `JENNYSOL-CURRENT-STATE.md`, `JENNYSOL-ARCHITECTURE.md`

---

## 11. Open decisions (need Syam)

| # | Decision | Recommendation |
|---|---|---|
| 1 | **JennySol stack.** The execution plan names Java 21 / Spring Boot + pgvector + React, but the existing `jennysol-ai` appears to be a Node/TypeScript + Vite app. | **Keep the current stack** and refactor it into the plan's components. A rewrite breaks "refactor, don't rewrite" and "minimal/cheap". Revisit only if the audit shows the current stack can't meet the v1 DoD. |
| 2 | **Repo layout.** The plan lists 14 sub-modules (gateway, runtime, memory…). | Implement them as **folders/modules inside `jennysol-ai`**, not 14 services. |
| 3 | **Arena's identity.** The plan says Arena becomes the agent platform (Studio/Store/Run Center); the product work says Arena is the human network. | **Both, in order.** VNext now = the human network. Agents arrive in Phase 4 as their own area, where an agent can later be an *Offer* in the network. VNext should keep that door open without building it. |
| 4 | **Vikisol One endpoint in the 30-day plan** vs "never touch One". | Design the One connector against a **mock** now; connect it only after One exposes a scoped API on staging. |
| 5 | **Which 3 real workflows prove JennySol v1?** | Suggested: (a) Arena actions via the live gateway (find/join an activity, draft a post or project → user approves). This is already working and needs evals; (b) research a topic with cited sources → report; (c) developer flow: inspect repo → run tests → draft PR (approval-gated) on a sandbox repo. |
| 6 | **Paid keys** (DeepSeek, etc.) | DeepSeek yes (cheap backup); others later. |
| 10 | **Provider order.** Live chat is almost all paid Gemini; Ollama is last. | Turn on keep-warm, then make local first for general and fast tasks, with Gemini as the fallback. Measure latency and cost before and after. |
| 11 | **Privacy defaults.** | Arena traffic: PUBLIC_CLOUD, because it is public posts. JennySol documents and memory: PRIVATE (local), failing honestly if local is unavailable. Shadow mode first. |
| 12 | **Run dashboard design.** | Option A, the timeline: mobile-first, it shows the plan step by step, and it has Stop. |
| 14 | **One architect.** | **Decided:** Claude is architect + reviewer; Codex is the idea expander. |
| 13 | **Admin 2FA.** It is optional today. | Require enrollment for company_admin and platform_admin behind a flag, with seeded TOTP for test accounts, then switch the flag on. |
| 7 | **Arena launch-gate items** carried over: lawyer-reviewed privacy policy/ToS, GST + Razorpay KYC, pentest, backups. | Clear these before real money or a public marketing push. |
| 8 | **Arena safety features:** a women-only activity option would need gender data the app doesn't hold today; activity ratings don't exist. | Decide during the Sessions design. |
| 9 | **Pricing.** | Validate with 3–5 design partners; don't hard-code it. |

---

## 14. Go-to-market decisions (architect, 26 Sep 2026, from Codex's idea document)

Source: `CODEX-IDEAS-LAUNCH-AND-AGENCY.md` (Project docs). These are decisions; the rest of Codex's document stays reference material.

### Arena local launch
| # | Decision |
|---|---|
| 1 | **Zone:** one tight zone of about 5 km covering Gopanapally, Gachibowli, Financial District and Nanakramguda. Tellapur, Kondapur, Nallagandla and Manikonda come later. |
| 2 | **Sequence:** 15–20 hosts first (week 0), then a **50-person core cohort** (week 1). **200 is the week-4 milestone**, not the launch target. No expansion until the week-4 health gates pass. |
| 3 | **Categories at launch (18+ only):** **not allowed**: dating/romance, childcare/babysitting, loans or money requests, medical advice, anything requiring entry into someone's home (flatmate search, in-home pet sitting). **Moderated**: paid services, tutoring, events with more than 20 people. |
| 4 | **Community desk:** the founder plus one part-time community manager for the first month. The desk never posts as users, invents responses or marks attendance. |
| 5 | **Attendance:** the host marks it, and the participant can dispute within 72h. Attendance is **private** (visible only to the user and host) and never becomes a public score in v1. The profile shows only hosted, joined, needs resolved and projects won. |
| 6 | **Women-only activities:** **no gender field is collected.** The host labels the activity "Women-only" and it is **approval-required**; the host decides. This avoids storing sensitive data. |
| 7 | **Health gates (week 4):** 50% activation in 7 days; 60% of needs answered within 48h; activities reach at least 50% of capacity; fewer than 20% unexplained no-shows; at least 25 real outcomes in month 1; 35% of users return in week 2 and 25% in week 4. |
| 8 | **Launch message:** "Need a badminton group, a project collaborator, local help or people to learn with? Arena helps you find useful people and real activities near Gachibowli and Gopanapally. Every post comes from a real person." |

**Product work this creates (Arena, after the VNext preview is approved):** see `ARENA-MISSION.md` STEP 8.

### JennySol Agency Desk (first paid product)
| # | Decision |
|---|---|
| 9 | **Product:** an agency recruiting-operations assistant with 3 workflows: (1) requirement → scorecard and search strategy, (2) database rediscovery → evidence-backed shortlist, (3) candidate coordination → client submission. Recruiters make every decision. |
| 10 | **Ingestion:** CSV/Excel + pasted or forwarded JD and email only. **No ATS integration, no scraping.** |
| 11 | **Channel in the pilot:** **email only** (Resend) plus a web form link for candidates. WhatsApp later (Business API cost and template approval). |
| 12 | **Data:** the agency is the data controller and Vikisol the processor (a DPDP data processing agreement). Pilot data is exported and deleted within 30 days of the pilot ending. Candidates are contacted only with agency-approved templates that carry the agency's identity plus an opt-out. No protected attributes, names or photos are used as ranking signals, and no automatic rejection. |
| 13 | **Pilot:** 3–5 boutique/mid agencies (3–20 recruiters), **IT/professional roles only**, 45 days, **₹12,000 + GST**, no auto-renew. Test ₹14,999/month afterwards. |
| 14 | **Success gate** before more engineering: at least 3 complete, at least 2 keep paying, median saving of at least 20 hours per agency per month, shortlist time down at least 30%, at least 60% of outputs accepted or lightly edited, and zero policy or privacy incidents. |
| 15 | **Build order:** workflow (1) replaces the "developer sandbox" workflow as JennySol v1's third real workflow (see `JENNYSOL-NEXT.md`). Workflows (2) and (3) are built only after at least 2 agencies sign the paid pilot. |
| 17 | **Outreach gates** (Codex's outreach pack, `OUTREACH-PACK.md`). **Host messages** go out only after the VNext preview is approved and STEP 8 is live; until then, never promise a feature that isn't live. **Agency offers** go out only after all of: workflow 1 is live, the candidate-data location and subprocessors are decided (a **paid, no-training AI tier or Vikisol-controlled infrastructure, never a free tier and never the founder's personal Mac**), a lawyer-reviewed DPA + pilot agreement exists, GST invoicing is ready, and **agency tenant isolation** is built and tested. The offer states honestly that workflows 2 and 3 are delivered during the pilot. |
| 18 | **Agency data privacy: ADR-007** (`jennysol-ai/docs/architecture/ADR-007-agency-desk-privacy.md`). Private-first. Class A (identifiable) data goes to private infrastructure only. Class B (redacted) may go to **paid** Gemini (CONTROLLED_CLOUD) with agency permission. There is never silent escalation, and enforcement is always on for agency tenants. Stage 1 (JD → scorecard) needs no candidate data. Stage 2 is blocked on the Class A location decision (Vertex Mumbai recommended), a DPA and tenant isolation. **Hosted DeepSeek is withdrawn** as a backup. **Production Gemini must move to a paid project** (the free tier may train on prompts). |
| 16 | **Kept separate from Arena.** Arena's launch is not filled with recruitment posts. A future link happens only via explicit opt-in discoverability and a scoped API. |

---

## 12. Checklist to judge any blueprint, design or PR

**Arena**
- [ ] Does it serve Need → Response → Conversation → Outcome → Identity?
- [ ] Is Feed the front door and alive, not a job list?
- [ ] Are Map, Discover, Work and + each doing their distinct job?
- [ ] Is Jenny ambient (slots on each surface), draft-only, with no AI logic inside Arena?
- [ ] Is it honest: no fake activity, no Session UI without backend support?
- [ ] Is it on-brand (current palette), mobile-first, with every button working?
- [ ] Has it drifted toward Naukri or LinkedIn? If yes, reject it, however pretty.

**JennySol**
- [ ] Does it do work (plan → act → verify → report), not just chat?
- [ ] Is the model swappable by config? Is the privacy tier enforced, with no silent cloud escalation?
- [ ] Is every tool typed, scoped to the user's permissions, risk-rated, approval-gated when consequential, and audited?
- [ ] Is memory scoped (user + product + tenant + purpose) and deletable?
- [ ] Does it reach other products via APIs only, never their databases?
- [ ] Is there an eval result, and does it count toward the v1 DoD?

**Everything**
- [ ] Simple, cheap, free first? Minimal code, no duplicates or stale files?
- [ ] Verified against live reality, tested, deployed, `/version` matching?
- [ ] Safety rules in §9 respected?

---

## 13. Glossary
- **AgentRun:** one durable execution of a Jenny task, with states, budgets and an audit trail.
- **Model Gateway:** the single interface that hides which model or provider answers.
- **Privacy tier:** LOCAL / PRIVATE / PUBLIC_CLOUD routing rule.
- **pendingActions:** the approval queue for side-effect actions.
- **Room:** a conversation attached to a Post.
- **Session:** a time/place activity people join (an extended ACTIVITY post).
- **Pulse:** real-time *honest* network activity indicator.
- **ProductIdentity:** mapping of one Vikisol person to their identity and scopes in each product.
- **STOP GATE:** a point where an agent must stop and wait for Syam's approval.
- **DoD:** Definition of Done.
