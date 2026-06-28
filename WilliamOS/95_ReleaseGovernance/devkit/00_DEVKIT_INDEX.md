---
type: devkit-index
version_target: v1.3.1
phase: post-5e-pre-6
phase_6_status: blocked
generated: 2026-06-24
tags:
  - devkit
  - governance
  - release
---

# WilliamOS Developer Kit — Index

## What WilliamOS Is

WilliamOS is a local-first personal operator system. It is a governed control plane
for one person's knowledge, decisions, and actions. It routes work through tiered
safety gates, records evidence, and requires explicit approval before any write,
commit, promotion, or canon mutation. Nothing executes without a gate.

WilliamOS is not an autonomous agent. It is a second brain that waits for its operator.

**North Star:**
```
Local-first. Evidence-backed. Approval-gated. Recoverable. Auditable.
Worker-aware. No hidden authority.
```

## What the Control Center Is

The Control Center is a FastAPI backend + React frontend served as a single process
at `http://localhost:8420`. It provides:

- Operator chat (streamed, model-grounded, tool-gated)
- Briefing + alert surfaces
- Command panel (submit → review-required → approve/deny)
- Research Drop Zone (file intake pipeline)
- Agent Dock / Workers panel (registry + delegation gate)
- Evidence rail, History, Memory surfaces
- Model online/offline status strip

The Control Center does not execute commands on its own. Every command goes through
`safety.check_command → command_runner`.

## Current Production Baseline

| Item | Value |
|------|-------|
| Version target | v1.3.1 |
| Branch | copilot-phase1 |
| Latest tag | v1.3.1 |
| Latest hardening commit | 50e16f9 |
| Backend tests | 206/206 PASS |
| Production readiness | 10/10 PASS |
| Runtime smoke | 28/28 (0 critical) |
| Control-center smoke | 22/22 PASS |
| Command registry | 92/92 matched |
| Default chat model | qwen2.5:14b-instruct-q4_K_M |
| Embed model | nomic-embed-text |
| Port | 8420 |

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Brain + Chat | ✅ Complete |
| 2 | Briefing + Watchdog | ✅ Complete |
| 3 | Capture + Memory | ✅ Complete |
| 4 | Vault RAG | ✅ Complete |
| 4.5 | Response Streaming | ✅ Complete |
| 5A | No-Slop Operator Shell | ✅ Complete |
| 5B | Launcher Runtime | ✅ Complete |
| 5C | Research Drop Zone | ✅ Complete |
| 5D | Agent Dock / External Worker Registry | ✅ Complete |
| 5E | Runtime Adapter / Model Runtime | ✅ Complete |
| 6 | Proactive Intelligence | ⛔ BLOCKED |
| 7+ | Routines / Multi-step Autonomy | ⬜ Future |

## Quick-Start Commands

```bash
# Launch Control Center
python scripts/william.py control-center

# Launch without opening browser
python scripts/william.py control-center --no-open

# Check status (no side effects)
python scripts/william.py control-center-status

# Restart
python scripts/william.py control-center-restart --no-open
```

## Validation Commands

```bash
# Backend tests
python -m pytest control-center/backend/tests -q

# Frontend build
cd control-center/frontend && npm run build

# Smoke tests
python scripts/william.py control-center-smoke
python scripts/william.py runtime-smoke

# Full gate
python scripts/william.py production-readiness
```

## Release Commands

```bash
# Check release readiness
python scripts/william.py release-status
python scripts/william.py acceptance

# Generate manifests
python scripts/william.py release-manifest

# Tag (only from clean tree after gates pass)
# See 90_RELEASE_AND_TAG_PLAYBOOK.md before running this
python scripts/william.py release-tag
```

## Recovery References

- Restore from backup: `python scripts/william.py restore-drill`
- Backup status: `python scripts/william.py backup-status`
- Git snapshot: `python scripts/william.py snapshot`
- Restore manifest: `python scripts/william.py restore-manifest`

## Safety Boundaries

The following are never permitted regardless of operator instruction:

- Phase 6 behavior (proactive intelligence) until Bill explicitly authorizes it
- External worker direct write, commit, promote, or delete
- Automatic canon promotion without reviewed approval
- Cloud LLM fallback without explicit approval
- Remote push or sync
- Weakening `safety.check_command` or `command_runner` boundaries
- Tagging from a dirty tree

## Dev Kit Documents

| File | Purpose |
|------|---------|
| `00_DEVKIT_INDEX.md` | This file — map of everything |
| `05_GOAL_AND_LOOP.md` | /goal + /loop for future agents |
| `10_OPERATOR_RUNBOOK_v1.3.0.md` | Daily operator procedures |
| `20_CLEAN_SETUP_GUIDE.md` | Fresh environment setup |
| `30_VALIDATION_GATES.md` | All gate criteria and commands |
| `40_RESEARCH_DROP_ZONE.md` | Intake pipeline guide |
| `50_AGENT_DOCK_EXTERNAL_WORKERS.md` | Worker registry and delegation |
| `60_MODEL_RUNTIME_ADAPTER_PLAN.md` | Multi-runtime adapter plan |
| `70_CONTAINERIZATION_PLAN.md` | Container scope and non-goals |
| `80_PWA_TAURI_PACKAGING_PLAN.md` | Native packaging plan |
| `90_RELEASE_AND_TAG_PLAYBOOK.md` | Release and tag procedures |
| `100_ENTERPRISE_SECOND_BRAIN_DEV_PLAYBOOK.md` | Enterprise second-brain development playbook and track map |
| `110_DECISION_REGISTER_PLAN.md` | Phase 5G decision register plan and seed register scope |
| `120_DOCTRINE_REGISTRY_PLAN.md` | Phase 5H doctrine registry plan and seed rule scope |
| `130_WORK_ORDER_ENGINE_PLAN.md` | Phase 5I work order engine plan and seed registry scope |
| `140_AGENT_CONFIG_INVENTORY_PLAN.md` | Phase 5J agent config inventory plan and redacted discovery scope |
| `150_DEVOPS_WORK_ORDER_PLAYBOOK.md` | DevOps work order playbook for governed `/goal`, `/loop`, evidence, authority, and closure |
| `160_AGENT_SKILLS_REGISTRY_PLAN.md` | Phase 5K agent skills registry plan and metadata-only capability cards |
| `170_EVIDENCE_PACK_GENERATOR_PLAN.md` | Phase 5L evidence pack generator plan and read-only handoff preview scope |
| `180_REPO_STATE_DASHBOARD_PLAN.md` | Phase 5M repo state dashboard plan and read-only operational visibility scope |
| `190_WORK_ORDER_COMPOSER_PLAN.md` | Phase 5N work order composer plan and preview-only packet generation scope |
| `200_VALIDATION_RUNBOOK_REGISTRY_PLAN.md` | Phase 5O validation runbook registry plan and metadata-only approved recipe scope |
| `210_COMMIT_READINESS_REVIEWER_PLAN.md` | Phase 5P commit readiness reviewer plan and preview-only commit candidate decision support |
| `220_LOCAL_HANDOFF_PACKET_EXPORTER_PLAN.md` | Phase 5Q local handoff packet exporter plan and preview-only copy/export scope |
| `230_OPERATOR_REVIEW_INBOX_PLAN.md` | Phase 5R operator review inbox plan and preview-only generated queue scope |
| `240_DECISION_GATE_CONSOLE_PLAN.md` | Phase 5S decision gate console plan and preview-only owner decision support scope |
| `250_OPERATOR_ACTION_ROUTER_PREVIEW_PLAN.md` | Phase 5T operator action router preview plan and classification-only authority routing scope |
| `260_AUTHORITY_LEDGER_PREVIEW_PLAN.md` | Phase 5U authority ledger preview plan and read-only authority visibility scope |
| `270_OWNER_DECISION_RECORD_PREVIEW_PLAN.md` | Phase 5V owner decision record preview plan and draft-only decision record scope |
| `280_APPROVAL_PACKET_PREVIEW_PLAN.md` | Phase 5W approval packet preview plan and clipboard-only approval packet scope |
| `290_GOAL_REGISTRY_PREVIEW_PLAN.md` | Phase 5X goal registry preview plan and metadata-only governed goal scope |
| `300_LOOP_REGISTRY_PREVIEW_PLAN.md` | Phase 5Y loop registry preview plan and metadata-only governed loop scope |
| `310_GOAL_LOOP_READINESS_REVIEWER_PLAN.md` | Phase 5Z goal/loop readiness reviewer plan and preview-only owner review decision support |
| `320_GOAL_COMMAND_PREVIEW_HARDENING_PLAN.md` | Phase 6A goal command preview hardening plan and non-executing /goal classifier scope |
| `330_LOOP_COMMAND_PREVIEW_HARDENING_PLAN.md` | Phase 6B loop command preview hardening plan and non-executing /loop classifier scope |
| `340_GOVERNED_GOAL_LOOP_CONSOLE_PLAN.md` | Phase 6C governed goal/loop console plan and preview-only integrated decision support scope |
| `devkit-manifest.json` | Machine-readable Dev Kit manifest |
