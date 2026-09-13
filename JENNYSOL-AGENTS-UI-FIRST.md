# JENNYSOL-AGENTS-UI-FIRST.md
### Continuation brief for the multi-agent orchestration work.
### Read `VIKISOL-BUILD-DOCTRINE.md` first. Phases 1-9 are accepted.

---

## 0. Phase 9 accepted — and the plan changes shape here

Phase 9 is a real milestone and your framing of it is correct: a live model
decomposing an objective, writing code through the real approval gate, verified
by a second real command run, with every step traced through durable events, is
the proof the architecture works. The three findings that surfaced during it —
the 30s+ local reasoning latency, the model not honouring a nested path, the
malformed-JSON escaping — are exactly the class of thing that only a live run
produces. Good.

**Do not continue into Phase 10 as planned.** The remaining phases get
reordered, for two reasons that are engineering reasons, not preferences:

**Observability before scale.** All three Phase 9 findings were caught by a
human reading traces of a *four*-role run. Phases 10-15 add ten more roles. If
the live dashboard and steering controls stay at the end of the queue, you will
be debugging a fourteen-agent DAG by tailing logs. That does not scale, and it
will silently slow every subsequent phase.

**A control surface is a safety control.** This system writes code and executes
commands. The approval gate is correct, but an approval gate a human can only
perceive through log output degrades into rubber-stamping fast. Before fourteen
roles run, a human must be able to see what is pending and stop it — from a
phone, in one action.

So the human-facing surface moves to the front. The ten specialist roles move to
the back and arrive in small groups, watched on the surface you will have built.

---

## 1. Before anything else

- Confirm all work is pushed. Not just committed.
- **Name the 2 failing tests out of 515.** Two failures have been carried
  silently across several phases. Either fix them or write down exactly what
  they are, why they fail, and why that is acceptable. A permanently red pair
  trains everyone to ignore the suite.
- Confirm the build stamp / commit hash is visible on the deployed dashboard so
  staleness is detectable without asking you.

---

## 2. Stage A — make every run visible (was: part of Phases 13-14)

This is now the next phase. Nothing else starts until a human can watch a run
happen.

**2.1 Live event stream.** Wire SSE from the existing durable event bus to the
dashboard. The events already exist — this is transport and rendering, not new
domain logic.

**2.2 The run view.** For any in-flight or completed objective:

- the objective as stated, and its decomposition
- the DAG, with each node's state: pending / running / blocked / awaiting
  approval / succeeded / failed / skipped
- which agent role owns each node
- elapsed time per node and wall-clock for the whole run
- the actual artifacts: what was written, which files, which commands ran, what
  they returned
- failures shown in full, not summarised away

**2.3 Blocked and waiting made loud.** Anything awaiting human approval, or
blocked on a file lock, must be visually unmissable — this is the single most
important state in the system and it is currently invisible.

**2.4 Run history.** Past runs are listable and openable, with their full event
trace intact. Debugging a run that ended an hour ago must not require log access.

**2.5 Cost and latency per run.** Time and token spend per node and per
objective, using the metrics work already built. See section 5 — this number is
the one that decides whether the platform is viable.

---

## 3. Stage B — human steering (was: Phase 14)

The human control surface, built directly on the run view:

- **Approval queue** — every pending WRITE or command approval in one place,
  showing exactly what will be written or executed, with the diff or the literal
  command. Approve and reject, with the decision recorded as a durable event.
- **Pause / resume** a run.
- **Cancel** a run cleanly: locks released, partial state recorded, no orphaned
  agents.
- **Kill a single agent** without tearing down the whole DAG.
- **Write-scope visibility** — what each agent is permitted to touch, shown
  before you approve, not buried in config.
- **Mobile-usable.** Approvals happen when the founder is away from the desk.
  Large touch targets, readable at 390px, no hover-dependent actions. If it
  can't be approved from a phone, it will be approved carelessly from one.

**Safety rule:** no approval action may be bulk, defaulted, or one-tap-through.
Every approve is a deliberate act on a specific, visible change.

---

## 4. Stage B2 — make it look like the product

Apply JennySol's existing design system. Do not invent a third visual language
for the admin surface, and do not leave it as unstyled scaffolding. Contrast,
type scale, spacing and states per spec; loading / empty / error / offline on
every view. A control surface that looks like a debug page gets used like one.

---

## 5. Stage C — correctness before more roles

Only now, and in this order:

**5.1 Latency and cost truth.** Measure end-to-end wall-clock and token cost for
a representative objective. A DAG with eight reasoning steps at 30s each is a
four-minute objective; state the real number plainly, with a breakdown by node.
Then say what would have to change for it to be acceptable — smaller model for
decomposition, parallel nodes, keep-warm, a different model for the reasoning
role. Do not optimise yet. Report first.

**5.2 Shared memory with write-scope enforcement.** Enforced server-side. An
agent must not be able to write outside its scope by manipulating a path, an id,
or its own request. Test the violation case explicitly, not just the happy path.

**5.3 Checkpoints.** A long run that fails at node 9 must resume from a
checkpoint rather than restart. Test a real mid-run failure and a real resume.

**5.4 Failure semantics.** What happens when an agent returns malformed output,
times out, loops, or contradicts another agent's work? Each case needs a defined
behaviour and a test. Phase 9 already produced two of these naturally — encode
them as tests so they cannot regress.

---

## 6. Stage D — the remaining roles, added in groups

Only after Stages A-C are green.

- Add specialist roles in groups of two or three, never all ten.
- After each group, run a real objective end to end and watch it on the
  dashboard. Report what the new roles did well and where they degraded the run.
- **Visual QA** needs its screenshot mechanism designed as its own piece of
  work — do not improvise it inside a role implementation.
- The QA pipeline lands last, once the roles it checks actually exist.

---

## 7. Boundaries that do not move

- Command execution stays allow-listed. Never widen the allow-list to unblock an
  agent; if an agent needs a command it cannot run, that is a design question for
  the founder.
- No agent gets direct database access to Arena or HRLMS. Scoped APIs only.
- No agent bypasses the approval gate, for any reason, including "it was only a
  small write."
- Autonomous runs stay off production systems.

---

## 8. Definition of done for this run

1. All work pushed; the 2 failing tests named and resolved or justified.
2. A run in progress can be watched live, on a phone, with every node state and
   every artifact visible.
3. A pending approval is unmissable, shows exactly what will happen, and can be
   approved or rejected from a phone.
4. A run can be paused, resumed and cancelled cleanly; a single agent can be
   killed without collapsing the DAG.
5. Past runs are openable with their full trace.
6. Real wall-clock and token cost for a representative objective is written down.
7. The surface uses the product's design system, with real states, not scaffolding.

Close with the three lists: verified, inferred, blocked — plus the one thing you
believe is most likely to break first under real use.
