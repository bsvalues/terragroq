---
type: devkit-playbook
source: "WilliamOS DevOps Work Order Playbook.pdf"
source_path: "C:/Users/bsval/Downloads/WilliamOS DevOps Work Order Playbook.pdf"
status: historical-superseded
authority: historical-reference-only
generated: 2026-06-26
phase_6_status: blocked
tags:
  - devkit
  - governance
  - goal
  - loop
  - work-orders
  - devops
---

# WilliamOS DevOps Work Order Playbook

> **HISTORICAL / SUPERSEDED:** The active operating doctrine is
> [`docs/governance/multi-agent-operator-playbook.md`](../../../docs/governance/multi-agent-operator-playbook.md),
> with provider entrypoints in root [`AGENTS.md`](../../../AGENTS.md) and
> [`CLAUDE.md`](../../../CLAUDE.md). This imported playbook remains evidence of the earlier operating
> model and grants no present authority. Every statement below that assigns routine operation,
> approval, Git/PR work, diagnostics, provider repair, or status carriage to William is superseded.
> William is owner-only. The issue #357 adapter is terminal, the local runtime remains disabled, and
> issue #358 remains dependency-blocked.

## Source Packet

```text
Document status: Draft operating playbook
Authority: Non-executing specification until ratified
Applies to: WilliamOS, TerraFusion-adjacent governance, DevOps agents, Codex/Claude/Copilot coworker workflows
Core rule: This playbook defines how work is proposed, classified, authorized, executed, verified, and closed. It does not itself authorize any work.
```

## Controlling Rule

This playbook defines how work is proposed, classified, authorized, executed,
verified, and closed.

It does not itself authorize any work.

Operating pattern:

```text
/goal -> classify -> decide -> work order -> scoped loop -> evidence -> acceptance -> close or hold
```

WilliamOS DevOps exists to prevent unsafe momentum. It should make the safe path
easier than the exciting path.

## Purpose

WilliamOS DevOps exists to help William operate with discipline across complex
technical, governmental, appraisal, AI, and repo-governance work.

Its job is not to maximize speed.

Its job is to prevent unsafe momentum.

WilliamOS DevOps should:

1. Capture goals without turning them into uncontrolled action.
2. Convert goals into scoped work orders.
3. Run read-only loops when allowed.
4. Stop automatically when risk, contradiction, dirty state, missing authority,
   or evidence gaps appear.
5. Preserve evidence.
6. Protect William from repeating known mistake patterns.
7. Keep agents inside a governed envelope.

## Constitutional Rules

These rules govern all `/goal` and `/loop` behavior.

## Authority Model (Historical / Superseded)

The former rule that made William the operator is superseded. William is the owner and provides only
genuinely new authority decisions. Agents own routine operation and the Git/PR lifecycle under the
active multi-agent playbook and recorded authority.

AI systems may:

- inspect
- summarize
- classify
- propose
- draft
- compare
- verify
- prepare work orders
- prepare evidence
- recommend next moves

AI systems may not silently:

- mutate repositories
- commit
- push
- tag
- merge
- release
- promote canon
- touch production
- touch live county data
- expand Phase 6 authority
- convert handoffs into execution

The historical default was `A0_READ_ONLY`. Current authority is resolved mechanically from the active
Work Order and immutable owner-issued grants; this document cannot grant, narrow, or expand it.

## Handoff Rule

A handoff is a map, not authorization.

Every handoff must include:

```text
HANDOFF_AUTHORITY: NONE unless explicitly stated
MUTATION_AUTHORITY: NO unless explicitly stated
NEXT_VALID_ACTION: decision, verification, or scoped work order
FUTURE_WILLIAM_WARNING: do not treat this as release authority
```

## Evidence Rule

No state claim is accepted unless it has evidence.

Accepted evidence includes:

- repo path
- branch
- commit hash
- tag
- worktree status
- validator output
- test counts
- build result
- evidence file path
- explicit operator decision
- known limitations

## Stop Rule

WilliamOS must stop when:

- active posture is `STOP` or `HOLD`
- repo is dirty and mutation was requested
- scope expands beyond the work order
- the current request conflicts with doctrine
- security, data, or production risk appears
- evidence is missing
- a validator fails unexpectedly
- agent output includes unauthorized mutation
- a handoff is being treated as approval

## Core Objects

### Goal

A goal is an operator intention. A goal is not execution authority.

Examples:

```text
/goal stabilize WilliamOS Second Brain leadership layer
/goal audit TerraFusion security/data posture
/goal create DevOps WO playbook
/goal prepare Codex packet for SB-001 Current Truth Panel
```

Every goal must be classified before action.

### Work Order

A work order is the scoped unit of authorized work.

It must define:

- ID
- title
- lane
- mode
- authority level
- allowed actions
- blocked actions
- files and surfaces in scope
- explicit exclusions
- acceptance criteria
- validation commands
- evidence requirements
- closure conditions

### Loop

A loop is a governed repeated execution cycle.

Loop types:

- `READ_ONLY_LOOP`
- `VERIFY_LOOP`
- `PLANNING_LOOP`
- `EXECUTION_LOOP`
- `EVIDENCE_LOOP`
- `WATCH_LOOP`

No loop may become autonomous expansion.

### Doctrine

Doctrine is a machine-checkable rule set that constrains actions.

Examples:

- no Phase 6 expansion without explicit release
- no TerraFusion remediation under a STOP posture
- no production-ready claim without runtime evidence
- no canon promotion without decision record

### Current Truth

Current Truth is the active state known to WilliamOS. It must be checked before
`/goal` or `/loop`.

Minimum Current Truth:

```text
CURRENT_TRUTH
WilliamOS:
Repo:
Branch:
HEAD:
Tag:
Phase:
Active WO:
Posture:
Allowed:
Blocked:

TerraFusion:
Repo:
Branch:
HEAD:
Active gate:
Posture:
Allowed:
Blocked:

Agents:
Allowed:
Blocked:

Last accepted evidence:
Next valid move:
Future William warning:
```

## Operating Lanes

Every goal must be assigned to one primary lane.

| Lane | Name |
|------|------|
| 1 | County Official / Assessor |
| 2 | TerraFusion Government Platform |
| 3 | WilliamOS Personal Command Brain |
| 4 | Private Commercial Sidecar / Atlas |
| 5 | Personal Learning / Developer Growth |
| 6 | Forensic Recovery / Repo Governance |
| 7 | Public Communication / Reputation |
| 8 | DevOps / Release Engineering |

If a goal crosses lanes, WilliamOS must flag it and require separate governance
and data boundaries before execution.

## Operating Modes

| Mode | Allowed | Blocked |
|------|---------|---------|
| `THINK` | analysis, synthesis, brainstorming, risk identification | mutation, commit, release |
| `PLAN` | work order drafting, sequencing, acceptance criteria, command planning | execution |
| `VERIFY` | read-only checks, tests, evidence collection, status summaries | repairs unless separately authorized |
| `EXECUTE` | scoped mutation, scoped tests, scoped evidence update when explicitly authorized | scope expansion, unrelated cleanup, production touch unless authorized |
| `RECOVER` | classify, inventory, provenance review, quarantine mapping | cleanup before classification |
| `HOLD` | answer questions, preserve state, create handoffs, create decision packets | execution momentum |
| `PUBLIC` | public communication drafts, speeches, reports, explanations | private/county data leakage, unreviewed public claims |

`PUBLIC` mode requires claim discipline, public trust review, and no private or
county data leakage.

## Authority Levels

| Level | Meaning |
|-------|---------|
| `A0_READ_ONLY` | inspect and report only |
| `A1_DRAFT_ONLY` | create plans, packets, and draft docs |
| `A2_LOCAL_MUTATION` | scoped local file mutation |
| `A3_TEST_AND_BUILD` | scoped validation execution |
| `A4_COMMIT_LOCAL` | local commit |
| `A5_PUSH_REMOTE` | remote push |
| `A6_TAG_RELEASE` | tag or release |
| `A7_PRODUCTION_TOUCH` | production systems |
| `A8_DATA_TOUCH` | live or sensitive data |
| `A9_CANON_PROMOTION` | doctrine/canon promotion |

## `/goal` Command

Purpose: capture operator intent and convert it into a governed object.

Syntax:

```text
/goal <goal statement>
```

Expanded syntax:

```text
/goal <goal statement>
--lane <lane>
--mode <mode>
--authority <authority>
--repo <path>
--deadline <date/none>
--risk <low|medium|high|P0>
--output <brief|packet|wo|handoff|implementation>
```

Examples:

```text
/goal create Current Truth Panel work order

/goal verify WilliamOS v1.3.0 baseline
--lane WilliamOS
--mode VERIFY
--authority A0_READ_ONLY

/goal implement SB-001 Current Truth Panel
--lane WilliamOS
--mode EXECUTE
--authority A2_LOCAL_MUTATION
```

Processing pipeline:

1. Capture goal.
2. Classify lane.
3. Classify mode.
4. Estimate risk.
5. Check Current Truth.
6. Check active locks.
7. Check doctrine.
8. Check contradiction register.
9. Match mistake patterns.
10. Produce a safe next question, work order draft, hold response, rejection
    with safe alternative, or execution packet if authority exists.

Output shape:

```text
GOAL_ID:
GOAL:
LANE:
MODE:
AUTHORITY_REQUESTED:
AUTHORITY_GRANTED:
RISK:
CURRENT_LOCKS:
DOCTRINE_CONFLICTS:
MISTAKE_PATTERN_MATCHES:
RECOMMENDED_NEXT_MOVE:
```

## `/loop` Command

Purpose: run a governed cycle against a goal or work order.

Syntax:

```text
/loop <target>
```

Expanded syntax:

```text
/loop <target>
--type <read|verify|plan|execute|evidence|watch>
--authority <authority>
--max-iterations <n>
--stop-on <condition>
--evidence <path>
```

Loop types:

| Type | Behavior | Mutation |
|------|----------|----------|
| `READ` | Reads current state. | No mutation. |
| `VERIFY` | Runs approved validators. | No repair unless separately authorized. |
| `PLAN` | Produces work orders, packets, sequencing, and risk registers. | No mutation. |
| `EXECUTE` | Performs scoped mutation under a work order. | Requires explicit authority. |
| `EVIDENCE` | Collects, normalizes, and writes evidence. | Limited to evidence files if authorized. |
| `WATCH` | Checks for condition changes. | Must not mutate. |

All loops must stop if:

- max iterations reached
- validator fails
- repo dirty state conflicts with authority
- new risk class appears
- scope expansion is detected
- required evidence is missing
- doctrine conflict appears
- active lock changes
- user authority is ambiguous
- external, production, or data touch is required

Output shape:

```text
LOOP_ID:
TARGET:
ITERATION:
MODE:
AUTHORITY:
ACTIONS_TAKEN:
EVIDENCE_COLLECTED:
FINDINGS:
BLOCKERS:
STOP_REASON:
NEXT_VALID_MOVE:
```

## Work Order Lifecycle

The source playbook defines this full lifecycle:

```text
DRAFT
PROPOSED
CLASSIFIED
READY_FOR_APPROVAL
AUTHORIZED
IN_PROGRESS
VERIFYING
BLOCKED
HOLD
ACCEPTED
CLOSED
REJECTED
SUPERSEDED
```

Current implementation note: the Phase 5I seed registry currently supports:

```text
draft
active
blocked
hold
accepted
closed
superseded
rejected
```

Until status transitions are implemented, use this mapping:

| Playbook state | Current registry status |
|----------------|-------------------------|
| `DRAFT`, `PROPOSED`, `CLASSIFIED`, `READY_FOR_APPROVAL` | `draft` |
| `AUTHORIZED`, `IN_PROGRESS`, `VERIFYING` | `active` |
| `BLOCKED` | `blocked` |
| `HOLD` | `hold` |
| `ACCEPTED` | `accepted` |
| `CLOSED` | `closed` |
| `REJECTED` | `rejected` |
| `SUPERSEDED` | `superseded` |

State rules:

- A work order may not move to authorized unless scope is clear, authority is
  declared, blocked actions are declared, acceptance criteria exist, validation
  exists, and operator approval exists.
- A work order may not move to accepted unless validators pass or failures are
  classified, evidence is recorded, diff/scope is reviewed, exclusions are
  restated, and next state is declared.
- A work order may not move to closed unless acceptance is complete, worktree
  state is recorded, future warnings are recorded, and follow-up work is blocked,
  parked, or separately drafted.

## Work Order Template

```text
WO_ID:
TITLE:
DATE:
SYSTEM:
LANE:
MODE:
AUTHORITY_LEVEL:
STATUS:

OPERATOR_INTENT:
Why this work exists.

CURRENT_TRUTH:
Repo:
Branch:
HEAD:
Tag:
Active gate:
Current posture:

SCOPE:
Included:

EXPLICIT_EXCLUSIONS:
Not included:

ALLOWED_ACTIONS:
BLOCKED_ACTIONS:
RISK_CLASS:

DOCTRINE_CHECK:
Applicable doctrine:
Conflicts:
Resolution:

MISTAKE_PATTERN_CHECK:
Matched patterns:
Intervention:

ACCEPTANCE_CRITERIA:
VALIDATION_COMMANDS:
EVIDENCE_REQUIREMENTS:
STOP_CONDITIONS:
ROLLBACK_PLAN:
CLOSURE_REQUIREMENTS:
FUTURE_WILLIAM_WARNING:
```

## Evidence Record Template

```text
WO_ID:
Result:
Repo:
Branch:
HEAD:
Worktree status:
Files changed:
Validators:
Known failures:
Classified failures:
Out-of-scope changes:
Deferred items:
Owner-gated items:
Next valid move:
```

For code work, include:

- git diff summary
- test result
- build result
- lint/typecheck result if applicable
- generated files status
- ignored/untracked file status

For governance work, include:

- decision records updated
- doctrine records updated
- work order registry updated
- evidence paths
- explicit non-authorizations

## Mistake Pattern Registry

| ID | Pattern | Triggers | Intervention |
|----|---------|----------|--------------|
| `MP-001` | Vision Outruns Evidence | full system, complete platform, agent army, production ready, build it all | Reduce to smallest safe work order. Require Current Truth and evidence gate. |
| `MP-002` | Handoff Becomes Authorization | continue from handoff, what's next, let's go, start from this packet | Restate handoff is map, not authority. Require explicit release signal. |
| `MP-003` | Repo Chaos Disguised As Progress | clean it up, merge the good stuff, fix everything, sync branches, recover all useful code | Require forensic classification before mutation. |
| `MP-004` | Semantic Inflation | constitution, sovereign, production, ratified, accepted, canonical | Check maturity label: idea, spec, implemented, validated, accepted, released. |
| `MP-005` | Agent Over-Delegation | let agents run it, automatic improvements, continuous AI, self-improve | Require agent permission matrix and explicit loop constraints. |
| `MP-006` | Public/Private Lane Contamination | county platform, private SaaS, public data product, commercial sidecar | Separate lanes, data boundaries, and authority. |
| `MP-007` | Production Claim Trust | go live, production ready, operational, all systems go | Require runtime evidence, deployment path, validators, and current date. |
| `MP-008` | Repair Before Classification | just fix it, patch it, remove junk, clean stale files | Classify before mutation. |
| `MP-009` | Phase Expansion Drift | Phase 6, autonomous, scheduler, worker, auto-run | Check Phase 6 lock and require explicit scoped authorization. |
| `MP-010` | Validator Blindness | tests passed, green, safe, done | Require what was tested, what was not tested, and known excluded failures. |

## `/goal` Examples

### Example 1: Safe Planning Goal

Command:

```text
/goal create work order for Current Truth Panel
```

Expected response:

```text
GOAL_ID: GOAL-YYYYMMDD-001
LANE: WilliamOS Personal Command Brain
MODE: PLAN
AUTHORITY_REQUESTED: A1_DRAFT_ONLY
AUTHORITY_GRANTED: A1_DRAFT_ONLY
RISK: MEDIUM
DOCTRINE_CONFLICTS: none
RECOMMENDED_NEXT_MOVE: Draft WO-WILLIAMOS-SB-001
```

### Example 2: Unsafe Execution Request

Command:

```text
/goal automatically run AI improvements across TerraFusion
```

Expected response:

```text
GOAL_ID: GOAL-YYYYMMDD-002
LANE: TerraFusion Government Platform
MODE: EXECUTE
AUTHORITY_REQUESTED: A2+ unknown
AUTHORITY_GRANTED: A0_READ_ONLY
RISK: HIGH/P0
DOCTRINE_CONFLICTS:
- active STOP gate
- no autonomous writes
- no Phase 6 expansion
MISTAKE_PATTERN_MATCHES:
- MP-005 Agent Over-Delegation
- MP-009 Phase Expansion Drift
RECOMMENDED_NEXT_MOVE:
Create read-only AI Improvement Sidecar classification packet.
```

### Example 3: Verify Loop Request

Command:

```text
/loop WO-WILLIAMOS-SB-001 --type verify --authority A0_READ_ONLY
```

Expected behavior:

- read current WO
- check scope
- check acceptance criteria
- check doctrine conflicts
- do not mutate
- output evidence summary

## `/loop` Examples

### Read-Only Repo Verification

Command:

```text
/loop william-os baseline --type verify --authority A0_READ_ONLY
```

Allowed:

```text
git status
git rev-parse HEAD
git branch --show-current
git tag --points-at HEAD
validator dry runs if read-only
```

Blocked:

```text
git add
git commit
git push
file edits
```

### Scoped Implementation Loop

Command:

```text
/loop WO-WILLIAMOS-SB-001 --type execute --authority A2_LOCAL_MUTATION --max-iterations 3
```

Requires:

- WO authorized
- files in scope
- rollback plan
- validation commands
- no dirty unrelated state

Stops if:

- unrelated files change
- validator fails in unexpected way
- new scope needed
- current truth conflict appears

## Agent Permission Matrix

### Codex

Allowed:

- inspect code
- propose patches
- perform scoped implementation
- run validators
- produce evidence

Blocked unless explicitly authorized:

- broad refactor
- commit
- push
- tag
- merge
- release
- canon promotion

### Claude

Allowed:

- architecture review
- handoff drafting
- risk analysis
- work order drafting
- synthesis

Blocked:

- treating synthesis as approval
- creating implementation momentum without authority

### Copilot

Allowed:

- narrow implementation
- test generation
- local repair inside work order

Blocked:

- governance decisions
- release decisions
- scope expansion

### WilliamOS Local Agent

Allowed:

- retrieve memory
- check doctrine
- classify requests
- check current truth
- run approved local commands

Blocked:

- silent fallback to cloud
- silent command execution
- silent persistence of sensitive state
- authority escalation

## Closure Format

Every closed work order must end with:

```text
RESULT:
WO_ID:
STATUS:
REPO:
BRANCH:
HEAD:
WORKTREE_STATUS:
FILES_CHANGED:
VALIDATORS:
EVIDENCE:
EXCLUSIONS:
KNOWN_LIMITS:
NEXT_VALID_MOVE:
FUTURE_WILLIAM_WARNING:
```

Example:

```text
RESULT: PASS
WO_ID: WO-WILLIAMOS-SB-001
STATUS: CLOSED
REPO: C:\Users\bsval\william-os-devops
BRANCH: copilot-phase1
HEAD: <hash>
WORKTREE_STATUS: clean
FILES_CHANGED: <list>
VALIDATORS: backend tests PASS; frontend build PASS
EVIDENCE: docs/devkit/evidence/SB-001.md
EXCLUSIONS: no Phase 6 expansion; no autonomous writes
KNOWN_LIMITS: panel is read-only
NEXT_VALID_MOVE: draft SB-002 Operator Mode Control
FUTURE_WILLIAM_WARNING: do not treat SB-001 as authority to execute loops
```

## Recommended First Implementation Slices

Do not implement the entire playbook at once.

First slices:

| Work order | Purpose |
|------------|---------|
| `WO-WILLIAMOS-DEVOPS-001` | Add `/goal` classifier and work order draft output |
| `WO-WILLIAMOS-DEVOPS-002` | Add `/loop` read-only verifier shell |
| `WO-WILLIAMOS-DEVOPS-003` | Add Current Truth Panel dependency check |
| `WO-WILLIAMOS-DEVOPS-004` | Add Mistake Pattern Registry check |
| `WO-WILLIAMOS-DEVOPS-005` | Add Handoff Authority Banner |

These five slices create the safety envelope. Only after those exist should
WilliamOS support execution loops.

## Non-Negotiable Guardrails

The DevOps system must never:

- execute from a goal alone
- mutate from a handoff alone
- infer authority from enthusiasm
- promote canon from chat memory alone
- run agents without a permission matrix
- touch TerraFusion during STOP posture
- expand Phase 6 from generic "let's go"
- claim production readiness without current evidence
- hide validator failures
- bury exclusions

## North Star Checklist

The system should reduce every big request into:

1. What are we trying to do?
2. What lane is this?
3. What mode is this?
4. What authority exists?
5. What is currently true?
6. What doctrine applies?
7. What mistake might William be about to make?
8. What is the smallest safe next move?

## Source Section Coverage

| Source section | Covered in this playbook |
|----------------|--------------------------|
| 1. Purpose | `Purpose` |
| 2. Constitutional Rules | `Constitutional Rules`, `Authority Model`, `Handoff Rule`, `Evidence Rule`, `Stop Rule` |
| 3. Key Concepts | `Core Objects` |
| 4. Operating Lanes | `Operating Lanes` |
| 5. Operating Modes | `Operating Modes` |
| 6. Authority Levels | `Authority Levels` |
| 7. `/goal` Command | `/goal` Command |
| 8. `/loop` Command | `/loop` Command |
| 9. Work Order Lifecycle | `Work Order Lifecycle` |
| 10. Work Order Template | `Work Order Template` |
| 11. Evidence Requirements | `Evidence Record Template` |
| 12. Mistake Pattern Registry | `Mistake Pattern Registry` |
| 13. Current Truth Panel Requirement | `Current Truth` |
| 14. Agent Permission Matrix | `Agent Permission Matrix` |
| 15. `/goal` Examples | `/goal` Examples |
| 16. `/loop` Examples | `/loop` Examples |
| 17. Closure Format | `Closure Format` |
| 18. Recommended First Implementation Slice | `Recommended First Implementation Slices` |
| 19. Non-Negotiable Guardrails | `Non-Negotiable Guardrails` |
| 20. North Star | `North Star Checklist`, `Final Operating Sentence` |

## Final Operating Sentence

WilliamOS DevOps turns goals into governed work, loops into bounded evidence
cycles, and AI agents into accountable coworkers that cannot outrun William's
authority.
