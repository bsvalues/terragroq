---
type: governance
status: accepted
tags:
  - maintenance
  - release
  - governance
---

# Maintenance Release

This folder contains the governance documentation and generated artifacts for WilliamOS maintenance releases.

## What v1.1 Means

WilliamOS v1.1 is a local maintenance release marker. It records that the post-v1 operating governance layer (WO-017 through WO-020) has been validated and snapshot.

Included in v1.1:
- WO-017: Daily / Weekly / Monthly Operating Routine
- WO-018: Human Review Queues
- WO-019: Official Acceptance Assistant
- WO-020: Post-Acceptance Closure Workflow

## What v1.1 Does NOT Mean

- Not a cloud release
- Not pushed to any remote
- Not uploaded anywhere
- Not a new subsystem — it is a governance checkpoint
- Not a breaking change — all v1.0 commands still work

## Governance Docs

- `MAINTENANCE_POLICY.md` — what maintenance releases mean and the rules
- `V1_1_CHECKLIST.md` — 20-point checklist for v1.1 validation
- `TAGGING_POLICY.md` — how tags are created and the safety rules
- `POST_MAINTENANCE_ROUTINE.md` — what to do after a maintenance release

## Generated Artifacts

- `reports/` — maintenance review reports (Markdown, committable)
- `data/` — maintenance data (JSON, committable)
- `MAINTENANCE_MANIFEST.md` — maintenance state manifest (committable)

## Commands

| Command | Purpose |
|---------|---------|
| `maintenance-status` | Show maintenance readiness and latest report |
| `maintenance-review --dry-run` | Preview maintenance checks without writing |
| `maintenance-review` | Run checks and generate maintenance report |
| `maintenance-manifest` | Generate/update maintenance manifest |
| `maintenance-tag --name v1.1.0 --dry-run` | Preview tag creation |
| `maintenance-tag --name v1.1.0` | Create local annotated tag |
