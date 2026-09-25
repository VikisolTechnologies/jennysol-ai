# JENNYSOL MISSION — ADDENDUM (aligns v2 with the master execution plan)

Read this alongside `JENNYSOL-MISSION-2.md` and `VIKISOL-MASTER-CONTEXT.md`. Where they differ, **this addendum wins**. If you are mid-run, fold these points into your current phase. Do not restart.

## 1. The master plan decides scope, not stack
`JennySol_End_to_End_Execution_Plan.docx` is authoritative for **what** to build and in what order. It is **not** an instruction to change technology.

- **Do not rewrite `jennysol-ai` into Java/Spring Boot, split it into 14 services, or migrate to pgvector/Temporal/Kafka.** Keep the current stack and implement the plan's components (gateway, runtime, memory, knowledge, tools, agents, workflows, security, observability) as **modules/folders inside the existing app**.
- If the audit shows the current stack genuinely cannot meet the v1 Definition of Done, write that up with evidence in the blueprint as a decision for the founder. Do not switch on your own.
- **Vector store:** keep the working in-process embeddings. Propose pgvector only if the audit shows the current store can't do tenant-scoped retrieval at our scale.

## 2. Add to the v1 core (Phases 4–6 of the mission)
These come from the plan's first-30-days list and Definition of Done, and were missing from v2:

1. **Planner → execute → observe → re-plan loop (Goal Mode).** A user gives a multi-step goal, and Jenny plans, executes step by step, and re-plans on results. The model proposes; the runtime validates and permits.
2. **Stop conditions:**
   - goal completed,
   - budget hit (steps, time or cost),
   - required information missing,
   - repeated tool failure,
   - policy violation,
   - approval needed,
   - insufficient evidence.
3. **Task and TaskStep records** alongside AgentRun. They are visible in a **task/run dashboard** with a working **Stop** button.
4. **Tool risk levels:**
   - Low → automatic.
   - Medium → policy-based or confirm.
   - High → explicit approval.
   - Critical → explicit approval plus strong authorization.
5. **At least 10 safe tools**, reusing existing ones first: time, weather, web search, open/extract page, citations, knowledge search, get/summarize document, file read/create (sandboxed), Arena read tools, draft-only email/message.
6. **Recovery from common tool failures** (retry, alternate tool, honest failure) with **no silent success**.
7. **Trace IDs and audit events** on every run and tool call.
8. **Evals:** 20 deterministic agent scenarios, plus the 50-prompt routing set. Report:
   - task success,
   - first-pass success,
   - tool success,
   - recovery rate,
   - human-intervention rate,
   - cost per successful task,
   - latency,
   - safety violations (must be zero).
9. **Three real Vikisol workflows end to end.** Proposed (the founder confirms at STOP GATE 1):
   - **(a)** Arena: idea → draft Need/Project through the Arena contract → user confirms. Test against the mock Arena API; live only once Cursor's side exists.
   - **(b)** Research: a question → a cited report.
   - **(c)** Developer: inspect a **sandbox** repo → run tests → draft a PR, approval-gated.
10. **Provider independence proven.** Show that the same agent run works on Ollama and on Gemini by changing config only.

## 3. Vikisol One
The plan's 30-day list includes "connect one Vikisol One endpoint." **Still do not touch any Vikisol One code, database or production.** Design the One connector and test it against a **mock** only. Real connection comes later, through a scoped One API on staging, with the founder's approval.

## 4. Sequence reminders from the plan
- **Voice comes after text execution is reliable.** Keep Phase 7 after the core is green.
- **Specialist agents, supervisor, browser/computer use, the marketplace and the GPU fleet are design-only in this mission.**
- **Start lean on infrastructure.** Nothing that needs Kubernetes, Kafka or Temporal.

## 5. Blueprint additions (STOP GATE 1)
`docs/JENNYSOL-ARCHITECTURE.md` must also include:
- a table mapping each item in the plan's **v1 Definition of Done** to where it's built, how it's tested, and its status;
- a "conflicts with the master plan" section (stack, repo layout, vector store, One connection) with your recommendation for each;
- the core contracts (Agent, Tool, Task, Run, Memory, Approval, Model) as they will exist in code.
