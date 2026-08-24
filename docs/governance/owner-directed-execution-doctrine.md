# Owner-Directed Execution Doctrine

Document: `OWNER-DIRECTED-EXECUTION-DOCTRINE-001`

Status: `NARROWING_PENDING_REGISTRATION`. Recorded by explicit owner direction, 2026-08-24.

This document is **not** an independent authority source and does not become one by declaring itself
canonical. Its identifier is registered nowhere else in the repository — not in `AGENTS.md`, not in
the controlling playbook, not in the supersession. Independent review confirmed that with `git grep`
across `origin/main` and this branch: one hit, this file's own line 3. An earlier revision of this
file said `CANONICAL` anyway, which is the same defect the Experience V2 collision map records as its
central failure pattern — a document taking its properties from its own nomenclature.

Until an authority-matched Work Order registers `OWNER-DIRECTED-EXECUTION-DOCTRINE-001` in a
controlling contract, this document binds exactly as far as it **narrows already-recorded behaviour**
under AGENTS.md and the playbook. Where it introduces something new rather than narrowing something
existing — the §2 phase-report status, the §3 qualitative acceptance rule, the §4 continuation-packet
schema — those are **advisory pending registration**, and a lane that cannot honour them is not in
violation of recorded authority. Tracked as `CONT-ODED-REGISTRATION` (§6).

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
a positive control.

**The controlling list is the playbook's, quoted rather than paraphrased.** `playbook:46-52`:

> William may be asked only for a genuinely new authority decision:
>
> - material product scope or policy;
> - new spending, contract, account, or provider grant;
> - production data mutation or release/cutover authority;
> - destructive or irreversible action;
> - legal, privacy, or security-risk acceptance that cannot be resolved technically.

An earlier revision of this section wrote its own list and attached the words "and only required" to
it. That list omitted *material product scope or policy*, *contract / account / provider grant*, and
*legal or security-risk acceptance* — so a narrower **exhaustive** claim sat inside a document whose
own header says the playbook wins. Independent review caught it. An agent following the narrow list
would have proceeded, without an owner decision, on exactly the classes the playbook reserves.

This document adds **no** entry to that list and removes none. What it contributes is the test for
deciding whether a given blocker is on it at all: an operation qualifies only when it needs a **new,
non-delegable authority decision**, not merely when the current actor cannot perform it.

The distinguishing question is not "am I stuck?" but **"would any other approved actor be equally
stuck?"** If a different lane with the same authority could do it, the blocker is capability, and it
is internal.

### A wall's name does not make it non-delegable

`isOwnerWall` (`scripts/runtime-operator/operational-kernel.mjs:416-418`) is the single place the
kernel turns a failure into `ownerDecisionRequired: true`, and it recognises six codes. One of them
does not belong to this class, and saying so is the point of writing this section down:

`RUNTIME_READINESS_WALL` is thrown when `gh auth status` fails
(`scripts/runtime-operator/williamos-adapters.mjs:1086-1089`) and when `codexAuth`, `githubAuth` or
`identityContext` are not ready (`scripts/runtime-operator/native-adapters.mjs:163`). Every one of
those is a **session/provider capability condition** — an expired integration login is the textbook
§1 case. Applying this section's own test: another approved actor with a working login would not be
stuck, so it is capability, so it is internal. The kernel nevertheless routes it to `BLOCKED /
ownerDecisionRequired: true`.

The accompanying test enumerates all six walls so that *widening* the owner-wall set fails loudly. On
this row that safeguard works against the doctrine: it pins an existing violation in place rather than
catching a new one. The row is retained in the test because it is the kernel's present behaviour and
the test's job is to describe behaviour truthfully — **not** because this document endorses it.
Correcting the kernel is a production change and is out of this test-only PR's scope; it is
`CONT-ODED-RUNTIME-READINESS` (§6).

## 2. A phase cannot be reported PASS while mandatory evidence was inaccessible

If a phase's controlling records, tests, or runtime observations could not be reached, the phase is
not `PASS`. It is:

```
<PHASE>_INCOMPLETE_ACTOR_CAPABILITY_BLOCKED
```

with the exact inaccessible evidence enumerated, and with §1's routing obligation still live.

This is a **phase-report status**, not a Work-Order lifecycle state. It never appears on a lane
checkpoint and never substitutes for one of the playbook's typed states
(`docs/governance/multi-agent-operator-playbook.md:178-193`). The lane carrying the blocked phase
still reports a canonical state with a reason code.

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
that is recorded against the lane in the playbook's canonical vocabulary — a lifecycle state of
`BLOCKED_NO_ELIGIBLE_PROVIDER` (or `REROUTE_PENDING` while a capable reviewer is still being sought),
carrying the **reason code** `PROVIDER_UNAVAILABLE` — routed or persisted per §1, not handed to the
owner as a courier task.

`PROVIDER_UNAVAILABLE` is a reason code and never a lifecycle state:
`docs/governance/multi-agent-operator-playbook.md:196-198` names it as an example of a stable reason
code and says such codes "may not be substituted for lifecycle-state names." An earlier revision of
this document called it a state. That was the same defect this program keeps finding — a reason code
wearing a state's name — and it is corrected here rather than explained away.

Independence is role separation: the reviewer must not hold the builder's reservation. It is not
vendor separation.

## 4. Terminal acceptance metric

```
OWNER_COURIER_ACTIONS = 0
```

An **owner courier action** is any step in a delivery where the owner moves information, output,
authority, or execution between actors, surfaces, or machines, and where an approved actor could have
moved it instead.

It complements, and does not replace, #762's `OWNER_MINUTES_PER_DELIVERED_OUTCOME -> 0`: that counts
the owner's time, this counts the owner's errands. A delivery can consume few owner minutes and still
be full of errands.

**This is a qualitative acceptance rule, not a computed metric.** Nothing in the schema, the ledger,
the kernel, or any report field derives it today; it is asserted by the delivering lane and checked by
the reviewer against the §1 list. Calling it a "metric" while nothing computes it would be precisely
the slogan-shaped failure this doctrine exists to prevent, so it is named for what it is. Making it
computable — deriving it from the lane's own checkpoint and audit trail — is worthwhile and is not
claimed here.

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
`scripts/runtime-operator/operational-kernel.mjs`.

| Test | Contract |
| --- | --- |
| [`tests/runtime-operator-execution-path-not-owner-gate.test.ts`](../../tests/runtime-operator-execution-path-not-owner-gate.test.ts) | #957 — six actor-capability variants stay internal; an authority wall still gates |
| [`tests/session-surface-limits-not-owner-gate.test.ts`](../../tests/session-surface-limits-not-owner-gate.test.ts) | this doctrine — see the exact contract below |

### What that test proves, and what it does not

Stated precisely, because an earlier revision of this section claimed more than the code supports and
an independent review caught it.

**It proves** that `isOwnerWall` (`scripts/runtime-operator/operational-kernel.mjs:417`) does not
recognise any of the **twelve** courier fixtures it is given. The six authority walls in the positive
control are exactly that predicate's alternation, so widening it to admit a courier-shaped code — the
specific regression this doctrine exists to prevent — turns the courier cases red immediately. That
tripwire is real, and it is the reason the test earns its place.

**It does not prove that a courier message can never match `isOwnerWall`.** The predicate's regex is
**unanchored** (`:417`), so it fires on any message merely *containing* one of the six tokens — for
example `MERGE_PATH_BLOCKED: upstream reported RUNTIME_READINESS_WALL`. None of the twelve fixtures
contains a wall token, so the suite is silent on this. The honest fix is to compare the parsed
**leading** failure code against an exact six-value set and add mixed-context negatives; that is a
kernel change, recorded as `CONT-ODED-OWNER-WALL-ANCHORING` below.

**It does not prove** that the kernel classifies courier failures *as* courier failures. It does not,
today: every unrecognised message reaches the generic branch at
`scripts/runtime-operator/operational-kernel.mjs:464` and becomes `FAILED_TERMINAL` with
`ownerDecisionRequired: false` and its `failureCode` preserved. Twelve arbitrary strings would behave
identically. So the courier cases assert "not an owner wall, and still recorded" — which is true and
worth pinning — and nothing stronger.

**And "still recorded" holds only once a checkpoint exists.** `runCycle` calls `assertRuntime`,
`listQueue` and `resolveBaseSha` *before* its first `transition(...)` writes a checkpoint
(`:281-308`); with no prior checkpoint the handler's `if (!checkpoint) throw error` (`:425-427`)
rethrows, so a courier failure at any of those three leaves **no checkpoint, no `failureCode`, and no
record at all**. The fixture makes all three succeed and throws only from `invokeCodex`, so the suite
never reaches that path. This is the second half of §1 — "don't ask the owner" and "drop it on the
floor" are different failures — failing in the first adapter the kernel runs. Recorded as
`CONT-ODED-PRE-CHECKPOINT-LOSS` below.

**The gap that leaves.** §1 requires a courier-shaped failure to be *routed to a capable actor or
persisted as a typed continuation*. `FAILED_TERMINAL` is neither: it is a dead end that merely
declines to bother the owner. Closing that honestly means a courier classification plus a canonical
routable state (`REROUTE_PENDING`) **and something that consumes it** — a reroute the operational
kernel does not have today. Adding the state with no consumer would manufacture a second slogan, so
this document does not do it, does not pretend otherwise, and records the gap as bounded follow-up
work rather than losing it.

§§2–4 are reporting and sourcing obligations. They bind agent reports, and the machine surface for
them is the phase report itself, not the kernel.

## 7. Typed continuations — internal, not owner work

None of these is an owner ask. Each is a typed state with an internal owner and an automatic pickup
condition, per #957 and §1 of this document. Together they are the bounded follow-up work §6 refers
to, written as packets rather than left as prose.

```
CONT-ODED-REGISTRATION
  type:      BLOCKED_DEPENDENCY
  reason:    CONTRACT_NOT_REGISTERED
  subject:   OWNER-DIRECTED-EXECUTION-DOCTRINE-001 is referenced by no controlling contract
  evidence:  git grep over origin/main and this branch returns one hit -- this file's own line 3.
             Not in AGENTS.md, the playbook, or the supersession.
  effect:    this document binds only where it NARROWS recorded behaviour. S2's phase-report
             status, S3's acceptance rule and S4's continuation schema are ADVISORY until
             registration lands.
  action:    register the identifier in the controlling playbook under an authority-matched Work
             Order, then restore a binding status here.
  owner:     the delivering agent lane
  not:       an owner decision. Registration is a contract edit under already-recorded program
             authority, not a new authority grant.

CONT-ODED-RUNTIME-READINESS
  type:      BLOCKED_DEPENDENCY
  reason:    KERNEL_CONTRADICTS_DOCTRINE
  subject:   RUNTIME_READINESS_WALL routes a session/provider capability failure to
             ownerDecisionRequired: true
  evidence:  thrown on `gh auth status` failure (williamos-adapters.mjs:1086-1089) and on
             codexAuth/githubAuth/identityContext not ready (native-adapters.mjs:163);
             matched by isOwnerWall (operational-kernel.mjs:416-418) -> BLOCKED.
  action:    split the code. A genuine authority failure (revoked grant, missing activation) stays
             an owner wall; an unauthenticated or expired integration login becomes an internal
             capability failure with a reroute or continuation. Removing the row from isOwnerWall
             without splitting the code would silence a real authority wall too.
  scope:     PRODUCTION kernel + adapters. Out of scope for the test-only PR that records it.
  owner:     the delivering agent lane, as its own bounded packet
  not:       an owner decision. The owner is not asked to re-authenticate anything; the point is
             that his authentication state is not an authority question.

CONT-ODED-OWNER-WALL-ANCHORING
  type:      BLOCKED_DEPENDENCY
  reason:    PREDICATE_TOO_BROAD
  subject:   isOwnerWall's regex is unanchored (operational-kernel.mjs:417)
  effect:    any message CONTAINING a wall token becomes an owner gate, including a courier
             message that merely quotes one.
  action:    parse the LEADING failure code and compare against an exact six-value set; add
             mixed-context negative tests. operational-kernel-cli.mjs:51 carries the same
             unanchored pattern and must move with it.
  scope:     PRODUCTION kernel.
  owner:     the delivering agent lane, as its own bounded packet
  not:       an owner decision.

CONT-ODED-PRE-CHECKPOINT-LOSS
  type:      BLOCKED_DEPENDENCY
  reason:    FAILURE_NOT_PERSISTED
  subject:   a courier failure before the first checkpoint write leaves no record
  evidence:  assertRuntime / listQueue / resolveBaseSha run before the first transition(...)
             (operational-kernel.mjs:281-308); no-checkpoint rethrow at :425-427.
  action:    persist an initial failure envelope before those calls, and test each failure locus
             rather than only the post-checkpoint invokeCodex path.
  scope:     PRODUCTION kernel.
  owner:     the delivering agent lane, as its own bounded packet
  not:       an owner decision.

CONT-ODED-COURIER-NOT-ROUTABLE
  type:      BLOCKED_DEPENDENCY
  reason:    NO_CONSUMER_FOR_ROUTABLE_STATE
  subject:   a courier failure reaches FAILED_TERMINAL, which runCycle returns unchanged forever
             (operational-kernel.mjs:283)
  effect:    S1's two permitted moves -- reroute, or persist a typed continuation -- are both
             unavailable. Declining to bother the owner is not the same as handling the work.
  action:    a courier classification plus a canonical routable state (REROUTE_PENDING) AND a
             consumer that acts on it. Adding the state with no consumer manufactures a slogan;
             this document deliberately does not do that.
  scope:     PRODUCTION kernel + supervisor.
  owner:     the delivering agent lane, as its own bounded packet
  not:       an owner decision.
```
