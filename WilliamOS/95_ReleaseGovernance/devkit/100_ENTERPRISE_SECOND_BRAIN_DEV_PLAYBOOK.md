---
type: enterprise-second-brain-playbook
wo_id: WO-WILLIAMOS-ENTERPRISE-SECOND-BRAIN-DEV-001
status: draft-ready-for-operator-approval
project: WilliamOS
baseline: post-v1.3.1-phase5e-local
phase_6_status: blocked
generated: 2026-06-26
tags:
  - devkit
  - governance
  - enterprise
  - second-brain
  - work-order
---

# WO-WILLIAMOS-ENTERPRISE-SECOND-BRAIN-DEV-001

# Enterprise Second Brain Development Playbook

## Current Posture

WilliamOS is a local-first governed operator system.

Known local tags:

- `v1.3.0` -> `2c44ff2a00bd28a312cd23b28a3011fa9261e20f`
- `v1.3.1` -> `4676792cf529bf211374a844e75b977b957509d1`

Current post-tag hardening:

- Phase 5E Runtime Adapter: complete at `50e16f97bc9a9f260cc2cf10ff8df1cb2e7f49f9`
- Default runtime: Ollama
- Default model: `qwen2.5:14b-instruct-q4_K_M`
- Candidate runtimes: LM Studio, llama-server
- Fallback: disabled
- Auto-switch: disabled
- Runtime provenance: recorded

Phase 6 remains intentionally blocked unless explicitly authorized.

Control plane: WilliamOS.
Operator: Bill.
External workers: proposal-only unless separately authorized.

---

## /goal

### Mission

Build WilliamOS into an enterprise-level advanced second brain and local operator
system.

The system must capture information once, preserve provenance, retrieve with
evidence, manage memory, track decisions, govern workers, and help the operator
act without hiding authority or silently expanding autonomy.

WilliamOS is not a chatbot.

WilliamOS is a governed local-first operating brain.

### North Star

WilliamOS should become:

```text
A local-first governed second brain and operator control system
that captures research,
remembers decisions,
retrieves with evidence,
delegates safely,
records actions,
guards authority,
and supports daily production work.
```

The system must be:

```text
Local-first
Evidence-backed
Approval-gated
Recoverable
Auditable
Worker-aware
Provenance-preserving
Runtime-transparent
No hidden authority
```

### Core Principle

Do not build more AI.

Build more trust.

The mature WilliamOS system should not be judged by how autonomous it is, but by
whether it is:

```text
accurate
traceable
recoverable
safe
fast to use
easy to audit
hard to misuse
```

Autonomy comes last.

Governance comes first.

### Current Baseline

WilliamOS already has:

```text
Phase 1: Brain + Chat
Phase 2: Briefing + Watchdog
Phase 3: Capture + Memory
Phase 4: Vault RAG
Phase 4.5: Response Streaming
Phase 5A: No-Slop Operator Shell
Phase 5B: Launcher Runtime
Phase 5C: Research Drop Zone
Phase 5D: Agent Dock / External Worker Registry
Phase 5E: Runtime Adapter
Dev Kit: complete
v1.3.0: stable local operator baseline
v1.3.1: local hardening tag for Ollama startup/runtime reliability
```

Current governing line:

```text
WilliamOS delegates.
Workers propose.
WilliamOS records evidence.
Bill approves writes/promotions/commits.
```

### Target Enterprise Architecture

WilliamOS should be developed as these layers:

```text
Operator Shell
Memory System
Retrieval System
Decision Register
Doctrine Registry
Work Order Engine
Governance Engine
Model Runtime Layer
Worker Dock
Action Runner
Audit / Release System
Backup / Restore System
Packaging / Distribution Layer
```

Each layer must have:

```text
clear authority
clear data ownership
clear provenance
clear validation
clear failure behavior
```

### Final Product Definition

WilliamOS is considered enterprise-ready when it can:

1. Capture research from files, notes, screenshots, text, and future sources.
2. Preserve originals and provenance.
3. Extract and normalize usable knowledge.
4. Separate unreviewed intake from canon.
5. Search by keyword, semantic retrieval, structured metadata, and future graph.
6. Cite sources and authority levels in answers.
7. Track decisions as structured objects.
8. Track work as WOs with `/goal` and `/loop`.
9. Govern agent workers through explicit delegation.
10. Record every approval, denial, run, failure, and evidence item.
11. Support multiple local model runtimes without silent fallback.
12. Keep cloud/external runtimes disabled unless approved.
13. Expose memory facts for review/edit/delete/stale marking.
14. Back up and restore memory, notes, evidence, and configs.
15. Package cleanly through browser/PWA/Tauri later.
16. Run validation gates repeatably.
17. Remain usable when model runtime is offline.
18. Prevent Phase 6/proactive behavior unless explicitly authorized.

### Explicit Non-Goals

This work order does not authorize:

```text
Phase 6 proactive intelligence
autonomous background agents
silent cloud fallback
external worker write authority
automatic canon promotion
automatic commits
automatic tagging
automatic release publication
broad internet research agents
provider relay switching
unreviewed secrets exposure
PWA/Tauri/Docker implementation unless opened as its own WO
```

### Phase 6 Status

Phase 6 is not a production gap.

Phase 6 is an expansion gate.

Current status:

```text
Phase 6 - Proactive Intelligence: EXPANSION GATE - intentionally blocked.
```

Phase 6 may only open after an explicit operator authorization packet.

### Stop Conditions

Stop immediately if:

```text
- Work requires Phase 6 behavior.
- Work requires silent model fallback.
- Work requires cloud use by default.
- Work grants external workers write/commit/promote authority.
- Work changes v1.3.0 or v1.3.1 tags.
- Work commits generated/local-only notes without classification.
- Work modifies memory/canon/doctrine without evidence.
- Work adds a broad phrase-router.
- Work hides runtime provenance.
- Work weakens safety.check_command or command_runner.
- Work changes daily-use behavior without validation.
- Work crosses multiple phases without split WOs.
```

### Definition Of Done For This Playbook

This playbook is done when it exists as the controlling development packet for
WilliamOS enterprise second-brain evolution and future agents can use it to:

```text
choose the next phase
respect boundaries
run the right loop
avoid Phase 6 drift
preserve local-first authority
produce auditable changes
```

---

## /loop

### Loop Mode

All WilliamOS development must follow:

```text
READ -> CLASSIFY -> PLAN -> ACT NARROWLY -> VERIFY -> RECORD -> STOP
```

No loop may end with vague continuation.

Every loop ends with one of:

```text
PASS
BLOCKED
HOLD
NEEDS OPERATOR DECISION
SPLIT INTO NEW WO
```

### Loop 0 - Preflight

Before any action, run or report:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
git tag -l "v1.3*"
```

Report:

```text
REPO:
BRANCH:
HEAD:
TAGS:
WORKTREE_STATUS:
PHASE_STATUS:
AUTHORIZED_WO:
OUT_OF_SCOPE_FILES:
```

If the branch, phase, or dirty state is unclear, stop.

### Loop 1 - Classify The Work

Classify the work into exactly one lane:

```text
A. Runtime Adapter / Model Runtime
B. Memory Governance
C. Decision Register
D. Doctrine Registry
E. Work Order Engine
F. Agent Config Inventory
G. Retrieval Upgrade
H. Packaging / PWA / Tauri
I. Containerized Gates / Worker Sandbox
J. Backup / Restore Hardening
K. Phase 6 Authorization Packet
L. Documentation / Playbook Only
M. Out-of-scope / Stop
```

If work spans multiple lanes, split it.

### Loop 2 - Plan

Before editing files, write a short plan:

```text
GOAL:
PHASE:
FILES EXPECTED:
FILES FORBIDDEN:
COMMANDS:
VALIDATORS:
STOP CONDITIONS:
COMMIT_ALLOWED:
TAG_ALLOWED:
PUSH_ALLOWED:
PHASE_6_ALLOWED:
```

Defaults:

```text
COMMIT_ALLOWED: only if WO explicitly allows
TAG_ALLOWED: no
PUSH_ALLOWED: no
PHASE_6_ALLOWED: no
```

### Loop 3 - Act Narrowly

Touch only files named or clearly permitted by the active WO.

If additional files become dirty:

```text
STOP.
CLASSIFY DIRTY DELTA.
DO NOT CONTINUE.
```

No generated reports, intake notes, local config, daily notes, screenshots, or
runtime residue may be committed without explicit classification.

### Loop 4 - Verify

Run validators appropriate to the work.

Default WilliamOS validators:

```bash
python -m pytest control-center/backend/tests -q
cd control-center/frontend && npm run build
python scripts/william.py runtime-smoke
python scripts/william.py production-readiness
```

Optional validators:

```bash
python scripts/william.py control-center-smoke
python scripts/setup_copilot.py
python scripts/william.py control-center-status
```

If model runtime is offline, state whether that is:

```text
expected degraded mode
blocking failure
informational
```

Never claim model-backed acceptance if model-backed checks were skipped.

### Loop 5 - Record

Every loop must record:

```text
RESULT:
REPO:
BRANCH:
HEAD:
PHASE_STATUS:
FILES_CHANGED:
VALIDATORS_RUN:
VALIDATORS_PASSED:
VALIDATORS_BLOCKED:
MODEL_RUNTIME_STATUS:
SAFE_TO_COMMIT:
SAFE_TO_TAG:
SAFE_TO_PUSH:
SAFE_TO_RELEASE:
NEXT_DECISION:
```

### Loop 6 - Stop

After report, stop unless the next loop is explicitly authorized.

---

## Development Tracks

### Track A - Runtime Adapter / Model Runtime

Purpose: make model runtime selection explicit, visible, replaceable, and
auditable. Ollama remains default unless changed by explicit approval. No silent
fallback.

Current state:

```text
Ollama: default
Production default model: qwen2.5:14b-instruct-q4_K_M
7B: env override only
LM Studio: candidate
llama-server: candidate
Cloud fallback: disabled
Auto-switch: disabled
```

Acceptance:

```text
1. Default runtime remains Ollama.
2. 14B remains production model unless explicitly changed.
3. 7B remains override/dev option.
4. Runtime status is visible in UI/API.
5. Runtime provenance is persisted with assistant outputs.
6. Fallback is disabled unless explicitly approved.
7. Runtime-smoke remains PASS.
8. Production-readiness remains 10/10.
```

### Track B - Memory Governance

Purpose: prevent memory rot.

Required capabilities:

```text
list remembered facts
show source of fact
show created timestamp
show last used timestamp
show authority state
mark stale
delete fact
edit fact
promote fact to canon
demote canon to working memory
export memory
```

Authority states:

```text
intake
unreviewed
working
reviewed
canon
deprecated
superseded
archived
```

Stop if:

```text
fact source is unknown
canon promotion lacks evidence
memory deletion would be irreversible without backup
model proposes memory change without approval
```

### Track C - Decision Register

Purpose: turn important decisions into structured, searchable, enforceable
objects.

Decision object:

```yaml
decision_id:
title:
status:
decision:
reason:
owner:
created_at:
review_at:
scope:
evidence:
supersedes:
superseded_by:
authority:
```

Required decisions to seed:

```text
Phase 6 remains intentionally blocked.
Research Drop Zone is intake-only.
External workers are proposal-only.
v1.3.0 is stable baseline.
v1.3.1 is runtime-hardening tag.
14B is production default.
7B is env override only.
Cloud fallback is disabled by default.
```

### Track D - Doctrine Registry

Purpose: make operating rules machine-readable.

Doctrine is not memory. Doctrine is authoritative instruction.

Doctrine object:

```yaml
rule_id:
title:
scope:
status:
allowed:
forbidden:
requires_approval:
evidence:
supersedes:
created_at:
owner:
```

Required doctrine seeds:

```text
Claude Code may not push by default.
Codex is audit/evidence scout by default.
Workers propose; WilliamOS governs.
Research intake is non-canon until reviewed.
No silent model fallback.
No Phase 6 without explicit authorization.
No generated artifact commit without classification.
```

### Track E - Work Order Engine

Purpose: make `/goal` and `/loop` first-class.

WO object:

```yaml
wo_id:
title:
status:
goal:
loop:
scope:
non_goals:
allowed_files:
forbidden_files:
validators:
stop_conditions:
owner_decisions:
result:
evidence:
commit:
tag:
phase:
```

Required statuses:

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

### Track F - Agent Config Inventory

Purpose: discover external agent/tool configurations without changing them.

Rules:

```text
read-only
no secrets displayed by default
no config mutation
no provider switching
no cloud enablement
no deep-link import
```

### Track G - Retrieval Upgrade

Purpose: move from basic RAG to enterprise retrieval.

Retrieval modes:

```text
keyword
semantic
structured metadata
graph relationships
decision search
doctrine search
WO search
evidence search
```

Acceptance:

```text
1. Answers cite sources.
2. Authority level is shown.
3. Unreviewed intake is not treated as canon.
4. Contradictions are flagged.
5. Search works when model is offline where possible.
6. Gates remain green.
```

### Track H - Packaging / PWA / Tauri

Purpose: make WilliamOS feel like a real local app.

Hard rule:

```text
Tauri must not become a second command system.
WilliamOS core remains authority.
```

### Track I - Containerized Gates / Worker Sandbox

Purpose: use containers for reproducible validation and worker isolation, not
daily operator runtime.

Containerize first:

```text
backend tests
frontend build
release gates
worker sandbox
optional backend service
optional llama-server runtime
```

Do not containerize yet:

```text
daily desktop operator shell
tray app
Obsidian/vault workflow
local launcher
LM Studio desktop
normal drag/drop workflow
```

### Track J - Backup / Restore Hardening

Purpose: prove the second brain can be recovered.

Must cover:

```text
vault notes
research originals
metadata JSON
copilot.db
memory
evidence logs
release reports
worker run records
config registry
doctrine registry
decision register
WO registry
```

### Track K - Phase 6 Authorization Packet

Purpose: open proactive intelligence only when governance is strong enough.

Prerequisites:

```text
Memory Governance complete
Decision Register complete
Doctrine Registry complete
WO Engine complete
Runtime Adapter stable
Agent Config Inventory complete
Backup/Restore proven
```

Explicit authorization required:

```text
Authorize Phase 6 proactive intelligence.
```

Phase 6 may not begin from implication.

---

## Recommended Execution Order

```text
1. Phase 5E Runtime Adapter. COMPLETE at 50e16f9.
2. Phase 5F Memory Governance.
3. Phase 5G Decision Register.
4. Phase 5H Doctrine Registry.
5. Phase 5I Work Order Engine.
6. Phase 5J Agent Config Inventory.
7. Phase 5K Backup / Restore Hardening.
8. Phase 5L Packaging / PWA / Tauri.
9. Phase 5M Containerized Gates / Worker Sandbox.
10. Phase 6 Authorization Packet.
```

Do not open Phase 6 before memory, decision, doctrine, and WO governance are
real.

---

## Next Work Order

Recommended next lane:

```text
WO-WILLIAMOS-PHASE5F-MEMORY-GOVERNANCE-001
```

Purpose:

```text
Make remembered facts visible, reviewable, correctable, stale-able, removable,
and promotable only through evidence-backed approval.
```

Default status:

```text
NOT STARTED / NEEDS OPERATOR APPROVAL
```

---

## Commit Policy

Allowed commit types:

```text
feat(copilot): ...
fix(copilot): ...
docs(devkit): ...
docs(release): ...
docs(governance): ...
test(copilot): ...
chore(governance): ...
```

Do not move existing tags unless the WO explicitly authorizes a new release.

## Push / Publication Policy

Default:

```text
PUSH: NO
MERGE: NO
PUBLISH: NO
TAG: NO
```

Explicit operator approval required for each.

## Reporting Template

Every agent report must end with:

```text
RESULT:
REPO:
BRANCH:
HEAD:
PHASE_STATUS:
FILES_CHANGED:
VALIDATORS:
MODEL_RUNTIME_STATUS:
SAFE_TO_COMMIT:
SAFE_TO_TAG:
SAFE_TO_PUSH:
SAFE_TO_RELEASE:
NEXT_DECISION:
```

## Final Machine Rule

Do not chase intelligence.

Build trust.

Completion means every memory, decision, worker, runtime, and action has:

```text
source
authority
evidence
status
owner
audit trail
rollback path
```

WilliamOS becomes enterprise-grade when it is not merely helpful, but dependable.
