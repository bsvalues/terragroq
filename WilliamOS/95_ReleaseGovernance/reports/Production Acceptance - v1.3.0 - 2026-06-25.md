---
type: production-acceptance
status: accepted
generated: 2026-06-25
release: v1.3.0
tagged_commit: 2c44ff2
ledger_commit: 07b89c6
tags:
  - release
  - production
  - acceptance
---

# Production Acceptance - WilliamOS v1.3.0 - 2026-06-25

## Decision

WilliamOS v1.3.0 is accepted as the stable daily-use local operator baseline.

Phase 6 remains an intentionally blocked expansion gate. It is not a v1.3.0 production gap.

## Source Of Truth

| Item | Value |
|------|-------|
| v1.3.0 tag | `2c44ff2 chore(governance): record post-devkit validation artifacts` |
| Current ledger reconciliation | `07b89c6 docs(copilot): reconcile v1.3.0 production baseline language` |
| Phase status | Phase 1-5D complete |
| Phase 6 status | Expansion gate, intentionally blocked |
| Dev Kit | Complete |

## Baseline Gate

Commands run on 2026-06-25:

```bash
git status --short
git tag -l v1.3.0
git rev-parse v1.3.0
git log -1 --oneline
python scripts/william.py runtime-smoke
python scripts/william.py production-readiness
```

Results:

| Check | Result |
|------|--------|
| `v1.3.0` exists | PASS |
| `v1.3.0` points to `2c44ff2a00bd28a312cd23b28a3011fa9261e20f` | PASS |
| Runtime smoke | PASS, 28/28, 0 critical |
| Production readiness | PASS, 9/9 |
| Copilot/model health | Offline, informational |

The unrelated untracked appraisal note was left outside this work order.

## Daily Pilot Proof

Control Center:

- Started Control Center on `127.0.0.1:8420`.
- `control-center-status` reported backend OK, frontend OK, built frontend present, server running, and owned PID.
- Restarted Control Center and confirmed it returned on PID `52484`.
- `/api/smoke` returned PASS for home, agent, and safety.

Operator actions:

- Asked backup status through chat. WilliamOS routed to governed `backup-status` and returned backup evidence.
- Requested `snapshot now`. WilliamOS produced an approval event for `snapshot`; denial returned: `Denied. No command was executed for william snapshot.`
- Opened worker status through Agent Dock API. Claude Code, Codex, and Hermes were visible when installed; all external workers remained disabled by default.
- Attempted Claude Code delegation. Request failed cleanly with `delegation_not_allowed`.
- Attempted proposal execution without approved delegation. Request failed cleanly with `unknown_or_unapproved_request`.

Observed friction, not fixed in this work order:

- `control-center` and `control-center-restart --no-open` started/restarted the server successfully, but stayed attached long enough for the Codex shell command timeout.
- Control Center status display still includes the older runtime label `WilliamOS v1.2.0 v1.0.0`; release governance records v1.3.0 correctly.

## Backup And Recovery Proof

Commands run:

```bash
python scripts/william.py backup-status
python scripts/william.py restore-status
```

Results:

| Item | Value |
|------|-------|
| Backup dir | Present |
| Local archives | 4 |
| Latest backup | `WilliamOS-backup-20260616-014220.zip` |
| Latest backup path | `WilliamOS/92_BackupGovernance/local_archives/WilliamOS-backup-20260616-014220.zip` |
| Latest backup age | About 9.6 days on 2026-06-25 |
| Restore docs | Present |
| Latest restore report | `Restore Drill - 2026-06-15.md` |

No destructive restore was performed. This was readiness proof, not disaster simulation.

## Degraded Model Proof

Ollama/model health was offline:

```text
[WinError 10061] No connection could be made because the target machine actively refused it
```

Verified behavior:

- Control Center still opened.
- Status reported model offline clearly.
- `runtime-smoke` remained green.
- `production-readiness` remained green.
- Non-model surfaces worked: status, backup status, safety, research intake, semantic search, worker registry, delegation guard, proposal guard, and restart.
- Model-dependent RAG chat degraded clearly with an Ollama connection error.
- No silent cloud or external fallback occurred.

## Research Drop Zone Proof

Test file:

```text
production-finish-marker-2026-06-25.txt
```

Confirmed:

- Original was preserved under `WilliamOS/110_ControlCenter/research_intake/originals/`.
- Metadata JSON was created under `WilliamOS/110_ControlCenter/research_intake/metadata/`.
- Markdown note was created under `WilliamOS/07_Learning/Research Intake/`.
- Duplicate upload returned `duplicate: true` and did not create a second original or note.
- Research history showed the intake item.
- Semantic search found the generated intake note as the top result.
- Generated note remained `authority: unreviewed` and `canon: false`.

RAG status:

- RAG indexing failed because Ollama embeddings were offline.
- This is acceptable degraded-mode behavior for the production baseline.

The temporary intake artifacts were removed after proof so this work order could commit only the acceptance report.

## Agent Dock Proof

Confirmed workers:

| Worker | State |
|--------|-------|
| Claude Code | Installed/available, disabled external worker |
| Codex | Installed/available, disabled external worker |
| Hermes | Installed/available, disabled external worker |
| Ollama | Local model runtime, service unavailable, not delegatable |
| WilliamOS | Control plane |

Authority boundaries held:

- External workers are disabled by default.
- External workers are proposal-only.
- Delegation requires explicit approval.
- Proposal execution cannot write, commit, promote, or mutate canon.
- Disabled-worker delegation failed cleanly.
- Proposal execution without approved delegation failed cleanly.

## Known Non-Blockers

- Model runtime may be offline; WilliamOS core remains usable.
- Native Tauri/PWA/Docker are future production-hardening tracks.
- External workers remain proposal-only and disabled by default.
- Phase 6 remains an intentionally blocked expansion gate.
- Untracked appraisal note is outside this production acceptance work order.
- An unrelated untracked inbox note is outside this production acceptance work order.

## Final Acceptance

WilliamOS v1.3.0 is usable every day, recoverable, documented, validated, and safe to extend.

No Phase 6 work was started. No proactive intelligence was enabled. No new worker authority was granted. No packaging or runtime-adapter implementation was started.

Recommended next decision:

```text
A. Use v1.3.0 daily for a pilot period.
B. Open a separate Phase 5E production-hardening track.
C. Open a separate Phase 6 authorization packet.
```
