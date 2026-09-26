# Vikisol multi-agent operating protocol

**Authority:** operational companion to `VIKISOL-MASTER-CONTEXT.md`  
**Applies to:** Codex, Claude/Claude Code, Cursor, and any later coding or review agent  
**Purpose:** let multiple agents build in parallel without duplicating systems, overwriting work, or drifting from the product.

## 1. The motive in plain language

Vikisol is one ecosystem with three products that solve different parts of the same journey.

- **Arena helps people find each other and create real outcomes.** A person expresses a need, another person responds, they talk, they do something together, and the real outcome strengthens their identity. The loop is `NEED -> RESPONSE -> CONVERSATION -> OUTCOME -> IDENTITY -> NEW NEED`.
- **JennySol is the intelligence and execution layer.** Jenny understands a goal, finds the right context, proposes a plan, uses approved tools, remembers useful information, and reports what actually happened. It is an agent platform, not a chat skin.
- **Vikisol One is the organization layer.** It owns employees, HR operations, payroll, policies, attendance, and organization-controlled workflows.
- **The Vikisol website is the public entrance.** It explains the company and sends people to the right product. It does not become the shared logged-in application.

The products should feel connected, but they must not become one unsafe database or one giant codebase. Each product owns its data and authorization. JennySol talks to Arena or One through narrow, authenticated APIs. A shared identity may later make sign-in easier, but signing in never grants access to data the user is not authorized to see.

## 2. What success looks like

The ecosystem is successful when a real person can complete a truthful end-to-end journey:

1. Discover Arena and enter without confusion.
2. Create a need, offer, activity, project, or job.
3. Receive a real response from another person.
4. Move into a room or workflow and communicate.
5. Complete or explicitly close the outcome.
6. See that outcome reflected in Work and, only where fair and verified, in identity.
7. Ask Jenny for help at any step.
8. Review a concrete Jenny proposal before any consequential action.
9. See the authoritative result after execution, including honest failure.
10. If acting as an organization, continue the appropriate workforce process in Vikisol One through separately authorized APIs.

No screen may imply network activity, tool execution, approval, attendance, reputation, or success that the underlying systems cannot prove.

## 3. Architectural boundaries

### Arena owns

Profiles, posts, activities, jobs, companies, applications, projects, bids, rooms, messages, outcomes, and Arena permissions. Arena contains no model-provider logic.

### JennySol owns

Model routing, agent runs, agent sessions, tools, product connectors, approvals, AI memory, retrieval, orchestration, execution evidence, and AI audit records. JennySol never receives Arena or One database credentials.

### Vikisol One owns

Organizations, employees, HR records, payroll, attendance, leave, policies, roles, tenants, and workforce workflows. Arena identity does not imply One access.

### Public website owns

Public positioning, product education, company content, and links into each product.

### Cross-product rule

Every cross-product operation uses this sequence:

`authenticated identity -> scoped product API -> server authorization -> proposal when consequential -> explicit approval -> idempotent execution -> authoritative result -> audit record`

## 4. Product guardrails

- Preserve the current Arena near-black and orange identity unless the founder approves a visual alternative from a preview.
- Jenny remains ambient across Arena surfaces; do not reduce Jenny to a disconnected chatbot tab.
- Keep Arena useful beyond recruitment: people, needs, activities, projects, local discovery, conversation, and outcomes.
- Use honest empty, loading, partial-failure, offline, and unavailable states.
- Every visible control must work on mobile and desktop or remain hidden behind a flag.
- Consequential actions require explicit approval. Approval must be durable, scoped to its owner, single-use, expiring, and idempotent.
- Host-recorded attendance is operational evidence. It must not become permanent reputation without confirmation or a dispute policy.
- Models are replaceable. Business rules, authorization, risk checks, and completion decisions live in deterministic code.
- Prefer the current modular monoliths and existing shared components. Add a new service, table, runtime, or design system only after proving the existing one cannot serve the requirement.

## 5. Who does what

### Cursor: Arena implementation owner

Cursor owns changes in `Vikisol-Arena-FE` and `Vikisol-Arena-BE` for the active Arena mission. It may read JennySol's published Arena contract but must not edit JennySol implementation.

Cursor must:

1. Pull/rebase safely at the start of a work block.
2. Read the master context, Arena mission, progress, blockers, decisions, and Jenny/Arena contract.
3. Implement one bounded vertical slice at a time, including frontend, backend, authorization, states, and tests.
4. Commit and push small logical batches.
5. Update `docs/PROGRESS.md` after each pushed batch.
6. Record API-contract changes as proposals before changing a shared contract.
7. Stop only at the mission's explicit preview/merge gate or a genuine founder-only blocker.

### Claude Code: JennySol implementation owner

Claude Code owns changes in `jennysol-ai`. It may read Arena code and contracts, but it must not independently reshape Arena.

Claude Code must:

1. Reconcile `AgentRun`, `AgentGoalRun`, and `AgentSession` in an ADR before extending Goal Mode.
2. Preserve product-scoped connectors and the proposal/approval/execution boundary.
3. Build restart recovery, approval continuation, observability, privacy routing, and user-facing integration before calling Goal Mode complete.
4. Keep local/private/public-cloud routing explicit and policy driven.
5. Commit and push small logical batches and update JennySol progress and blockers.
6. Publish any Arena contract change in `docs/JENNY-ARENA-CONTRACT.md` before asking Arena to consume it.

### Claude review session: independent reviewer

The reviewer must use a fresh context or explicitly behave as a reviewer rather than trusting the implementer's report. It reviews both Cursor and Claude Code work but does not silently redesign while reviewing.

For every pushed batch it checks:

- diff scope and architectural alignment;
- authorization, ownership, tenant, and IDOR risks;
- migration safety and rollback;
- loading, empty, error, offline, and partial-failure behavior;
- desktop and phone layouts using rendered pages, not source inspection alone;
- keyboard, touch target, contrast, and axe results;
- console errors, failed requests, and performance budgets;
- whether tests prove behavior rather than mirror implementation;
- whether docs and claims match what is actually built.

It returns one verdict: `APPROVED`, `CHANGES REQUIRED`, or `BLOCKED`, with file/line evidence and exact reproduction steps. It never approves from screenshots alone.

### Codex: architecture and reconciliation owner

Codex maintains ecosystem boundaries, resolves contradictions between missions and code, audits cross-repository changes, and prepares correction instructions. Codex does not become a second simultaneous writer in a repository already owned by Cursor or Claude Code unless ownership is explicitly transferred.

### Founder

The founder approves product-direction choices, previews, new paid services, production release, irreversible external actions, and any requested access. Agents should consolidate founder-only questions instead of interrupting for routine implementation decisions.

## 6. Parallel work and Git synchronization

Each repository has exactly one active implementation owner at a time. Reviewers do not edit the implementer's working tree during a review.

At the start of every work block:

```bash
git status --short
git branch --show-current
git fetch origin --prune
git pull --rebase origin <current-feature-branch>
```

If the tree is dirty, first identify who owns the changes. Never stash, reset, clean, or stage another agent's work. Commit owned work or use a separate worktree.

After each bounded batch:

```bash
git status --short
<repository verification commands>
git add <explicit files only>
git commit -m "<scope>: <behavioral result>"
git pull --rebase origin <current-feature-branch>
git push origin <current-feature-branch>
```

Then update `docs/PROGRESS.md` with:

- branch and commit SHA;
- behavior completed;
- files or contracts changed;
- verification commands and exact results;
- preview URL when applicable;
- known failures and next bounded task.

Agents should synchronize after every logical commit or at least every 30–45 minutes during active parallel work. Do not use a timer-driven blind pull in a dirty tree. Pull only at a safe commit boundary.

## 7. Batch review loop

For each Cursor or Claude Code batch:

1. **Implementer verifies locally.** Required checks pass or the exact failure is documented.
2. **Implementer commits and pushes.** Progress includes the SHA.
3. **Reviewer fetches that exact SHA** in a separate clean worktree.
4. **Reviewer runs static, unit/integration, browser, accessibility, and visual checks appropriate to the batch.**
5. **Reviewer writes a verdict** in `docs/reviews/<SHA>.md` containing severity-ranked findings.
6. **Implementer fixes every release blocker** and responds in the same review file with the fixing SHA.
7. **Reviewer re-runs affected checks** and changes the verdict only when evidence supports it.
8. **Architect checks cross-product implications** when APIs, identity, approvals, memory, or outcomes changed.

A review file is evidence, not a substitute for tests. Do not accumulate dozens of narrative reports; one file per reviewed commit/batch is enough.

## 8. Visual QA protocol

Visual review is required for every user-visible batch.

Minimum viewport set:

- 390x844 phone;
- 412x915 Android phone;
- 768x1024 tablet when the layout materially changes;
- 1440x900 desktop.

For every affected route, inspect:

- logged out, normal user, and applicable organization/admin roles;
- loading, empty, populated, validation-error, server-error, and offline states;
- long names, long titles, large text, and narrow widths;
- fixed headers, bottom navigation, banners, sheets, keyboards, and safe areas;
- image failure and slow-network behavior;
- direct deep links and refreshes.

The reviewer compares the rendered result with the approved design and the product motive. Pixel similarity alone is insufficient. A beautiful screen that breaks the NEED-to-OUTCOME journey is a failed review.

## 9. Required quality gates

### Arena frontend

```bash
npm run lint
npm run build
```

Run the relevant Playwright projects for each batch and the complete suite before a preview is promoted. The golden path must have zero unexpected console errors and failed first-party requests.

### Arena backend

```bash
./mvnw test
```

Every write needs ownership/role tests, invalid-state tests, idempotency where retry is possible, and concurrency coverage where capacity or money-like counters change.

### JennySol

```bash
npm run build
cd server && npm test
```

Agent workflows also require deterministic scenario tests plus selected live evals. Live evals never replace ownership, isolation, approval, restart, and failure-path tests.

### Release gates

- No merge with failing required checks.
- No production UI release without founder approval of the concrete preview.
- No cross-product contract change until producer and consumer contract tests pass.
- No claim of completion while a required route, approval continuation, recovery path, or UI integration is missing.
- No test threshold relaxation without an approved product-budget decision and measured evidence.

## 10. Conflict and stale-document rules

Truth is resolved in this order:

1. Observed production behavior and current code.
2. `VIKISOL-MASTER-CONTEXT.md`.
3. The current product mission.
4. Current `PROGRESS.md`, `DECISIONS.md`, and contract documents.
5. Older architecture reports and chat transcripts.

When a contradiction is found, do not work around it silently. Correct the current source-of-truth document and move superseded plans to `docs/archive/`. Never keep two files that both claim to be the active mission.

## 11. Current priority order

1. Stabilize Arena's current activity/outcome lifecycle and make all required checks green.
2. Protect and test the live Arena/Jenny contract.
3. Complete the Arena blueprint and approved private preview around the living-network hierarchy.
4. Reconcile JennySol's three execution concepts before extending Goal Mode.
5. Finish one trustworthy Arena -> Jenny proposal -> approval -> execution -> authoritative-result journey.
6. Build privacy routing, restart/approval continuation, run visibility, and the remaining Jenny workflows.
7. Audit Vikisol One before designing its connector. Do not connect production HR data during the current mission.
8. Align the public website only after the product positioning and routes are stable.

## 12. Definition of done

The work is done only when:

- the intended user journey works end to end on a real phone-sized viewport;
- frontend and backend enforce the same business states;
- permissions are checked on the server;
- failures are honest and recoverable;
- accessibility and performance budgets pass;
- required automated checks pass;
- a fresh reviewer has inspected behavior and code;
- contracts and current docs match the implementation;
- the preview is concrete and reviewable;
- production release has the required founder approval;
- `/version` or equivalent proves the deployed commit;
- rollback steps are recorded.

