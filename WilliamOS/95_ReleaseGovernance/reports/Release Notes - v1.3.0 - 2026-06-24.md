---
type: release-notes
status: tagged
generated: 2026-06-24 17:50 PDT
release: v1.3.0
baseline: 2c44ff2
tags:
  - release
  - governance
  - control-center
---

# WilliamOS v1.3.0 Release Governance - 2026-06-24

## Decision

v1.3.0 is tagged as the stable local operator baseline.

Tag: `v1.3.0`
Tagged commit: `2c44ff2 chore(governance): record post-devkit validation artifacts`

Phase 6 remains blocked. WilliamOS v1.3.0 is the stable local operator baseline.

## Baseline

- Baseline commit: `2c44ff2 chore(governance): record post-devkit validation artifacts`
- Branch: `copilot-phase1`
- Previous tag: `v1.2.0`
- Remotes: none
- Phase 6: blocked until explicit operator decision

## Included Capability Baseline

- Phase 5A: Operator Shell complete
- Phase 5B: Launcher Runtime complete
- Phase 5C: Research Drop Zone complete
- Phase 5D: Agent Dock / External Worker Registry complete

WilliamOS remains the control plane. External workers are registered capacity only; they may produce proposals after explicit approval, but they cannot directly write, apply patches, commit, promote, delete, or mutate canon.

## Gate Results

- Backend tests: PASS, 158/158
- Frontend build: PASS
- Control Center smoke: PASS
- Runtime smoke: PASS, 28/28, 0 critical failures
- Production readiness: PASS, 9/9
- Release acceptance: PASS, 20/20
- Forbidden file scan: PASS
- Remote scan: PASS, no remotes configured
- Source note integrity: PASS

## Optional Live Checks

- Control Center API: reachable on `http://127.0.0.1:8420`
- Local model health: offline; Ollama service refused connection, so Phase 5A live model chat loop was not rerun in this release pass
- Research Drop Zone history: reachable; latest accepted intake item remains `phase5c-research-marker.txt`
- Agent Dock disabled-worker boundary: PASS; Claude Code delegation request returned `delegation_not_allowed`
- Agent Dock proposal boundary: PASS; proposal run without approved request returned `unknown_or_unapproved_request`

## Tag Decision

`v1.3.0` was created after the final clean-tree tag gate.

Final tag gate:

```text
Tag name: v1.3.0
Can tag: YES
Commit: 2c44ff2 chore(governance): record post-devkit validation artifacts
Clean tree: yes
Existing tags: v1.0.0, v1.2.0
Acceptance report: Acceptance Review - 2026-06-24.md
Runtime smoke: PASS, 28/28, 0 critical
Production readiness: PASS, 9/9
Backend tests: PASS, 158/158
Frontend build: PASS
Control Center smoke: PASS
```

Next allowed action: resume normal operating routine or plan a separate post-v1.3.0 hardening work order. Do not begin Phase 6 without explicit operator authorization.

## Out Of Scope

- No Phase 6 implementation
- No new features
- No ledger checkbox reconciliation for Phase 2/3/4
- No unrelated dirty-file cleanup
- No enabling real external worker authority
- No Phase 6 unlock
