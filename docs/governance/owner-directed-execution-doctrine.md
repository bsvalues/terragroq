# Owner-Directed Execution Doctrine

Document: `OWNER-DIRECTED-EXECUTION-DOCTRINE-001`

Status: `CANONICAL`. Recorded by explicit owner direction, 2026-08-24.

Authority position: this narrows execution behavior under
[`AGENTS.md`](../../AGENTS.md) and the
[`multi-agent operator playbook`](multi-agent-operator-playbook.md) as amended by the
[`sovereign runtime and review supersession`](sovereign-runtime-and-review-supersession.md).
It creates no authority and establishes no competing hierarchy. Where it and AGENTS.md
differ on process, **AGENTS.md wins.**

It is the successor statement to the owner rule locked by #957:

> Agent/session permission boundaries are internal implementation boundaries.
> **They do not create owner work.**

#957 proved that rule against the operational kernel for six actor-capability variants. This document
extends the same rule to the class the owner named next — **session and surface limitations** — and
states the delivery-stage and phase-reporting consequences that follow from it.

## 1. Session and surface limitations are never owner gates

An actor that cannot perform an **already-authorized** operation has encountered a property of
itself, not a governance decision.

This covers, without limitation: an unavailable CLI or binary; a missing or misconfigured tool path;
a permission classifier that blocks a call; an execution mode or session type that forbids an action;
a non-interactive session that cannot complete an interactive flow; a wrong or unreachable working
directory; an absent environment variable; an unauthenticated integration; a crashed automation
surface; a context or rate limit; a lane that does not hold a file reservation.

Such an actor has exactly two permitted responses:

1. **Route it** to an approved actor that already holds the capability and the authority; or
2. **Persist an internal continuation packet** in-repo, typed, with an automatic pickup condition,
   so the work resumes without a human carrying it forward.

It has one forbidden response: **converting its own limitation into a task for the owner.**

### The prohibited asks, named

An agent must never ask the owner to:

- start, launch, resume, or re-run an agent, session, or lane;
- paste, forward, or re-enter a prompt, plan, or instruction;
- transfer, relay, or copy a report, log, diff, error, or output between surfaces;
- run a command, script, test, or tool on the agent's behalf;
- merge, rebase, approve, close, or reopen a pull request that is already authorized and green;
- relay context between agents, sessions, tools, or machines;
- grant a permission that exists solely to work around the current actor's surface;
- repair, restart, authenticate, or reconfigure a provider, node, or integration;
- decide something the active recorded authority already decides.

A request phrased as a suggestion, an offer, a "you may want to", or a status note whose only possible
resolution is owner action is the same ask. The test is the **effect**, not the grammar.

### What remains a genuine owner gate

The rule is not "never ask". It degrades into uselessness if it becomes that, which is why #957 kept
a positive control. An owner decision is required, and only required, when the operation itself needs
a **new, non-delegable authority decision**: activation of a new authority, a genuine authority-gate
or revocation wall, a new spend or privacy boundary, protected-data egress, release authority, or a
credible threat to durable state.

The distinguishing question is not "am I stuck?" but **"would any other approved actor be equally
stuck?"** If a different lane with the same authority could do it, the blocker is capability, and it
is internal.

## 2. A phase cannot be reported PASS while mandatory evidence was inaccessible

If a phase's controlling records, tests, or runtime observations could not be reached, the phase is
not `PASS`. It is:

```
<PHASE>_INCOMPLETE_ACTOR_CAPABILITY_BLOCKED
```

with the exact inaccessible evidence enumerated, and with §1's routing obligation still live.

A report that presents an unread record as reconciled, or an unrun test as passing, is a false
report, and it is worse than an incomplete one: the next agent inherits the gap as though it were
settled truth. Gaps are cheap to carry forward when they are labelled and expensive when they are
not.

A phase that reaches `PASS` only after its blocked evidence is obtained must say so, and must retract
the earlier claim explicitly rather than quietly overwriting it.

## 3. Independent review is an internal delivery stage

"Independent review required" never means "third-party review service required", and it never means
"owner, please obtain a review."

Review is sourced through the supersession's tiers, sovereign tiers first. The delivering lane owns
requesting it, receiving it, and acting on it. If every eligible reviewer is genuinely unavailable,
that is a typed `PROVIDER_UNAVAILABLE` state recorded against the lane — routed or persisted per §1,
not handed to the owner as a courier task.

Independence is role separation: the reviewer must not hold the builder's reservation. It is not
vendor separation.

## 4. Terminal acceptance metric

```
OWNER_COURIER_ACTIONS = 0
```

An **owner courier action** is any step in a delivery where the owner moves information, output,
authority, or execution between actors, surfaces, or machines, and where an approved actor could have
moved it instead.

Every final report is measured against this. It complements, and does not replace, #762's
`OWNER_MINUTES_PER_DELIVERED_OUTCOME -> 0`: that metric counts the owner's time, this one counts the
owner's errands. A delivery can consume few owner minutes and still be full of errands.

## 5. Continuation packet contract

When routing is not possible, the persisted packet must carry:

| Field | Meaning |
| --- | --- |
| `type` | the typed condition — `NODE_UNAVAILABLE`, `PROVIDER_UNAVAILABLE`, `ACTOR_CAPABILITY_UNAVAILABLE`, `LANE_OWNERSHIP_CONFLICT`, `INDEPENDENT_REVIEW_PENDING`, … |
| `subject` | the exact work that cannot proceed |
| `evidence` | what was observed, with enough detail to re-check the condition |
| `blocks` | what is genuinely blocked |
| `does NOT block` | what may proceed anyway — stated, so the packet does not over-stop |
| `pickup` | the exact condition and action for automatic resumption |
| `owner` | the internal lane that resumes it |
| `not` | an explicit statement that it is not an owner task |

The `does NOT block` and `not` fields are not decoration. A packet that omits them tends to be read
as a full stop, and a full stop is how an internal condition becomes owner work by default.

## 6. Machine-checked surface

The kernel encodes exactly one place where a failure becomes owner work: `ownerDecisionRequired` in
`scripts/runtime-operator/operational-kernel.mjs`. §1 is therefore a real, testable contract rather
than a statement of intent.

| Test | Contract |
| --- | --- |
| [`tests/runtime-operator-execution-path-not-owner-gate.test.ts`](../../tests/runtime-operator-execution-path-not-owner-gate.test.ts) | #957 — six actor-capability variants stay internal; an authority wall still gates |
| [`tests/session-surface-limits-not-owner-gate.test.ts`](../../tests/session-surface-limits-not-owner-gate.test.ts) | this doctrine — the nine named courier asks stay internal **and** are recorded for re-routing; the authority walls remain exhaustively gated |

§§2–4 are reporting and sourcing obligations. They bind agent reports, and the machine surface for
them is the phase report itself, not the kernel.
