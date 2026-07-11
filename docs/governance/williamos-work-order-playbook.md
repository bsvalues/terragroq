# WilliamOS Work Order Playbook

Work order: WO-PLAYBOOK-001
Title: WilliamOS Work Order Playbook
Type: Governance / Operating Model
Risk: Low, documentation and planning only

## Current Execution Source

The canonical current goal, loop, and next eligible program are maintained in
`docs/governance/active-program-queue.md`. Numbered execution sequences later
in this document are historical foundation plans unless the active queue
explicitly selects them.


## Purpose

This playbook defines how WilliamOS uses `/goal`, `/loop`, Work Orders,
Evidence, Brain Council, Hermes, Agent Forge, Memory, and Authority to move work
forward without turning the Primary Operator environment into a SaaS dashboard,
generic chatbot, or autonomous mutation system.

WilliamOS is the Primary Operator's private command environment. `/goal` defines
governed intent. `/loop` advances that intent through controlled, reviewable work
orders.

## Operating Doctrine

WilliamOS is not:

- an enterprise SaaS dashboard
- a team workspace
- an admin portal
- a generic AI productivity app
- a project management clone

WilliamOS is:

- a private command environment
- a Primary Operator console
- a governed memory and work system
- a quiet intelligence layer
- an evidence-backed execution system

Core doctrine:

- Brain Council advises.
- Hermes works only when authorized.
- Agent Forge prepares capabilities.
- Work Orders govern action.
- Evidence proves reality.
- Projects are the systems under command.
- Memory preserves continuity.
- Authority gates mutation.

Every work order must preserve:

- no autonomous mutation
- no background worker activation
- no production writes without authority
- no DB, schema, environment, package, or Vercel setting changes unless
  explicitly scoped
- no Hermes, MCP, or Brain Council autonomy activation unless explicitly scoped

## `/goal` And `/loop` Model

### `/goal`

`/goal` defines governed intent.

A goal should answer:

- What are we trying to accomplish?
- Why does it matter?
- What system does it affect?
- What is allowed?
- What is blocked?
- What evidence proves completion?
- What is the next safe gate?

A goal does not automatically execute.

### `/loop`

`/loop` is the controlled operating cycle that advances one goal through small,
reviewable work orders.

A loop should answer:

- What is the current active goal?
- What is the next valid work order?
- What is the current safety posture?
- What changed?
- What evidence exists?
- What blocks progress?
- What decision is needed?

A loop can prepare, review, and recommend. It must not bypass authority.

## Standard `/goal` Template

```text
/goal create

TITLE:
<short goal title>

SYSTEM:
WilliamOS / TerraGroq / TerraFusion OS / Brain Council / Hermes / Agent Forge / County Ops

PURPOSE:
<why this goal exists>

SUCCESS STATE:
<what must be true when complete>

CURRENT BASE:
origin/main = <commit>

ALLOWED:
- <allowed change type>
- <allowed files/surfaces if known>

BLOCKED:
- no auth behavior change unless explicitly scoped
- no DB/schema/data mutation unless explicitly scoped
- no env changes unless explicitly scoped
- no package/dependency changes unless explicitly scoped
- no Vercel setting changes unless explicitly scoped
- no manual deploy/promote unless explicitly authorized
- no release/tag unless explicitly authorized
- no Hermes/MCP/autonomy activation unless explicitly scoped
- no background worker
- no production-write behavior

VALIDATION:
- focused tests
- full suite
- npm run build
- production /api/health
- production /api/auth/readiness
- security headers if production touched

EVIDENCE REQUIRED:
- files changed
- tests run
- build result
- PR URL
- merge commit
- production verification
- safety posture

NEXT LOOP:
<first recommended WO>
```

## Standard `/loop` Template

```text
/loop run

ACTIVE_GOAL:
<goal id/title>

WORK_ORDER:
<WO id/title>

BASE:
origin/main = <commit>

MODE:
read-only first / docs-only / UI-only / tests-only / code allowed / owner decision required

TASK:
<one narrow step>

ALLOWED:
- <allowed actions>

BLOCKED:
- <blocked actions>

VALIDATION:
- <specific validation>

RETURN:
RESULT:
WORK_ORDER:
BASE:
FILES_CHANGED:
VALIDATION:
PRODUCTION_VERIFICATION:
SAFETY_POSTURE:
NEXT_RECOMMENDED_WO:
```

## Master Goal Set

### GOAL-WOS-001 - Primary Shell Completion

Purpose: finish the WilliamOS Primary Operator shell so the system feels
unified, personal, and governed.

Success state: WilliamOS has Home, Primary Navigation, Work Orders, Evidence,
Systems, Authority, Memory placement, and Governance placement.

Work orders:

1. WO-SHELL-004 - Primary Navigation Shell
2. WO-SHELL-005 - Work Orders Surface
3. WO-SHELL-006 - Evidence Surface
4. WO-SHELL-007 - Systems Status Surface
5. WO-SHELL-008 - Authority / Governance Surface
6. WO-SHELL-009 - Memory Surface Placeholder
7. WO-SHELL-010 - Shell Polish + Production Verification

### GOAL-WOS-002 - Work Order Engine Integration

Purpose: make Work Orders the central operating primitive inside WilliamOS.

Success state: the operator can view goals, active loops, WOs, evidence, blocked
decisions, completed work, and next recommended action from inside WilliamOS.

Work orders:

1. WO-WOE-008 - Evidence Rollup
2. WO-WOE-009 - Goal Detail Surface
3. WO-WOE-010 - Loop Detail Surface
4. WO-WOE-011 - Active Work Queue
5. WO-WOE-012 - Blocked Decision Queue
6. WO-WOE-013 - Work Order Completion Report Renderer
7. WO-WOE-014 - Work Order Search / Filter

### GOAL-WOS-003 - Brain Council Advisory Layer

Purpose: bring Brain Council back as an advisory reasoning system, not an
autonomous executor.

Success state: Brain Council can inspect context, reason through a state
machine, produce decision packets, and recommend work orders without mutating
production or repositories.

Work orders:

1. WO-COUNCIL-001 - Brain Council Doctrine Page
2. WO-COUNCIL-002 - Council State Machine Schema
3. WO-COUNCIL-003 - Council Decision Packet Schema
4. WO-COUNCIL-004 - Advisory Council Surface
5. WO-COUNCIL-005 - Council Trace Ledger Read Model
6. WO-COUNCIL-006 - Council-to-WO Recommendation Flow
7. WO-COUNCIL-007 - Council Safety Boundary Tests

### GOAL-WOS-004 - Brain Memory Spine

Purpose: create readable, reviewable, governed memory for WilliamOS.

Success state: WilliamOS has memory records for facts, decisions, procedures,
patterns, contradictions, stale items, and review queue entries, with metadata
and authority state.

Work orders:

1. WO-MEMORY-001 - Brain Memory Directory + Schema
2. WO-MEMORY-002 - Decision Memory Records
3. WO-MEMORY-003 - Procedure Memory Records
4. WO-MEMORY-004 - Contradiction + Stale Memory Records
5. WO-MEMORY-005 - Memory Review Queue Surface
6. WO-MEMORY-006 - Memory Sensitivity + Authority Metadata
7. WO-MEMORY-007 - Memory-to-Wiki Linkage

### GOAL-WOS-005 - Trace Ledger + Failure-to-Eval

Purpose: make WilliamOS learn from failures without granting autonomous
authority.

Success state: every meaningful Council or Work Order run can produce a trace,
and failures can become proposed eval cases.

Work orders:

1. WO-TRACE-001 - Trace Ledger Schema
2. WO-TRACE-002 - Trace Ledger Read-Only Surface
3. WO-TRACE-003 - Failure Classification Policy
4. WO-TRACE-004 - Failure-to-Eval Proposal Schema
5. WO-TRACE-005 - Eval Queue Surface
6. WO-TRACE-006 - Trace-to-Evidence Linking

### GOAL-ACADEMY-001 - Academy + Wiki

Purpose: make WilliamOS teachable, transferable, and self-documenting.

Success state: Academy teaches operators and agents how to use the system. Wiki
records what the system knows.

Work orders:

1. WO-ACADEMY-001 - Academy/Wiki Directory Map
2. WO-ACADEMY-002 - Operator Level 1 Onboarding
3. WO-ACADEMY-003 - Work Order Governance Lesson
4. WO-ACADEMY-004 - Skill Quarantine Drill
5. WO-WIKI-001 - Brain Council Concept Page
6. WO-WIKI-002 - Hermes Sidecar Concept Page
7. WO-WIKI-003 - No Autonomous Mutation Policy
8. WO-WIKI-004 - Repo Audit Playbook
9. WO-WIKI-005 - Glossary

### GOAL-WOS-007 - Agent Forge Skill Governance

Purpose: let WilliamOS prepare and review skills safely before Hermes or any
worker can use them.

Success state: skills have source, risk, authority, permission, and review
metadata. Quarantined skills cannot execute.

Work orders:

1. WO-FORGE-001 - Skill Registry Schema
2. WO-FORGE-002 - Skill Quarantine Model
3. WO-FORGE-003 - Skill Risk Scanner Schema
4. WO-FORGE-004 - Skill Review Surface
5. WO-FORGE-005 - Procedure-to-Skill Proposal Flow
6. WO-FORGE-006 - Skill Permission Matrix
7. WO-FORGE-007 - Skill Activation Review Packet

### GOAL-WOS-008 - Hermes Sidecar Boundary

Purpose: define Hermes as a governed worker sidecar, not an autonomous agent
with open authority.

Success state: Hermes can be represented in the shell as disabled, available,
proposed, or authorized, with clear safety gates.

Work orders:

1. WO-HERMES-001 - Hermes Doctrine Page
2. WO-HERMES-002 - Hermes Status Surface
3. WO-HERMES-003 - Hermes Authority Boundary Tests
4. WO-HERMES-004 - Worker Packet Schema
5. WO-HERMES-005 - Hermes Activation Review Packet
6. WO-HERMES-006 - Hermes Denied/Blocked State UX

### GOAL-COUNTY-001 - County Ops Knowledge Pack

Identity note: `GOAL-WOS-009` is preserved for the later Academy + Wiki
reconciliation evidence and must not be reused for County Ops.


Purpose: add a dedicated assessor and county operations knowledge layer without
touching production county systems.

Success state: WilliamOS can organize PACS rules, levy workflow, BOE evidence,
permit import, public-data redaction, ratio study, and appeal packet knowledge
as read-only governed knowledge.

Work orders:

1. WO-COUNTY-001 - County Ops Knowledge Map
2. WO-COUNTY-002 - PACS Read-Only Rules Page
3. WO-COUNTY-003 - Levy Workflow Page
4. WO-COUNTY-004 - BOE Evidence Page
5. WO-COUNTY-005 - Permit Import Knowledge Page
6. WO-COUNTY-006 - Public Data Redaction Policy
7. WO-COUNTY-007 - Ratio Study Knowledge Page
8. WO-COUNTY-008 - Appeals Packet Playbook

### GOAL-WOS-010 - TerraFusion Project Command Layer

Purpose: make TerraFusion OS a governed project under command from WilliamOS,
not a disconnected repo.

Success state: WilliamOS can show TerraFusion status, active WOs, blocked
decisions, evidence, deployment state, and next recommended action.

Work orders:

1. WO-TF-COMMAND-001 - TerraFusion Project Card
2. WO-TF-COMMAND-002 - TerraFusion WO Feed
3. WO-TF-COMMAND-003 - TerraFusion Evidence Feed
4. WO-TF-COMMAND-004 - TerraFusion Blocker Queue
5. WO-TF-COMMAND-005 - TerraFusion Deployment Status Read Model
6. WO-TF-COMMAND-006 - TerraFusion Next Move Recommendation

## Historical Immediate Execution Sequence

### Phase A - Finish Shell Spine

1. WO-SHELL-004 - Primary Navigation Shell
2. WO-SHELL-005 - Work Orders Surface
3. WO-SHELL-006 - Evidence Surface
4. WO-SHELL-007 - Systems Status Surface
5. WO-SHELL-008 - Authority / Governance Surface

### Phase B - Make `/goal` And `/loop` Native

1. WO-WOE-008 - Evidence Rollup
2. WO-WOE-009 - Goal Detail Surface
3. WO-WOE-010 - Loop Detail Surface
4. WO-WOE-011 - Active Work Queue
5. WO-WOE-012 - Blocked Decision Queue

### Phase C - Brain Council Returns As Advisory Only

1. WO-COUNCIL-001 - Brain Council Doctrine Page
2. WO-COUNCIL-002 - Council State Machine Schema
3. WO-COUNCIL-003 - Council Decision Packet Schema

## Historical Recommended Next 12 Work Orders

1. WO-SHELL-004 - Primary Navigation Shell
2. WO-SHELL-005 - Work Orders Surface
3. WO-SHELL-006 - Evidence Surface
4. WO-SHELL-007 - Systems Status Surface
5. WO-SHELL-008 - Authority / Governance Surface
6. WO-WOE-008 - Evidence Rollup
7. WO-WOE-009 - Goal Detail Surface
8. WO-WOE-010 - Loop Detail Surface
9. WO-WOE-011 - Active Work Queue
10. WO-WOE-012 - Blocked Decision Queue
11. WO-COUNCIL-001 - Brain Council Doctrine Page
12. WO-COUNCIL-002 - Council State Machine Schema

Do not start Hermes activation, worker execution, autonomous loops, DB writes, or
external production actions until the shell, Work Order Engine, evidence,
authority, and Council doctrine layers are visible and tested.

## Completion Report Format

Every work order must return:

```text
RESULT:
WORK_ORDER:
GOAL:
LOOP:
BASE:
PR:
origin/main:
FILES_CHANGED:
SCOPE_CONFIRMED:
VALIDATION:
PRODUCTION_VERIFICATION:
AUTH_CHANGED:
DB_SCHEMA_CHANGED:
ENV_CHANGED:
PACKAGE_CHANGED:
VERCEL_SETTINGS_CHANGED:
AUTONOMY_CHANGED:
PRODUCTION_WRITE_BEHAVIOR:
SAFETY_POSTURE:
NEXT_RECOMMENDED_WO:
```

Blocked work orders must return:

```text
RESULT: BLOCKED_OWNER_DECISION
WORK_ORDER:
BLOCKER:
WHY_BLOCKED:
SAFE_TO_CONTINUE:
OWNER_DECISION_NEEDED:
NEXT_VALID_ACTION:
```

Read-only work orders must return:

```text
RESULT: PASS / READ-ONLY
WORK_ORDER:
FILES_CHANGED: none
EVIDENCE:
FINDING:
RECOMMENDED_NEXT_ACTION:
```

## Primary Operator Command Examples

Create the shell goal:

```text
/goal create

TITLE:
Primary Shell Completion

SYSTEM:
WilliamOS

PURPOSE:
Finish the WilliamOS Primary Operator shell so the system feels unified,
personal, and governed.

SUCCESS STATE:
WilliamOS has Home, Primary Navigation, Work Orders, Evidence, Systems,
Authority, Memory placement, and Governance placement.

CURRENT BASE:
origin/main = e516fad6b3ca2ff657c95c243b8b5b48d6ade9c4

FIRST LOOP:
WO-SHELL-004 - Primary Navigation Shell
```

Run the next loop:

```text
/loop run

ACTIVE_GOAL:
Primary Shell Completion

WORK_ORDER:
WO-SHELL-004 - Primary Navigation Shell

MODE:
UI-only, shell/navigation only

RETURN:
Completion report with validation, production health, safety posture, and next
recommended work order.
```

## North Star

WilliamOS should increasingly become a governed cognitive operating system
where:

- `/goal` defines intent.
- `/loop` governs progress.
- Work Orders control mutation.
- Evidence proves reality.
- Brain Council advises.
- Memory preserves continuity.
- Academy teaches the system.
- Wiki records the system.
- Forge prepares capability.
- Hermes acts only when authorized.
- The Primary remains the authority.

