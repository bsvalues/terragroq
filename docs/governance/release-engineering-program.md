# Release Engineering Program

Program: `PROGRAM-RELEASE-ENGINEERING-001`

Goal: `GOAL-RELEASE-ENGINEERING-001 - Release Engineering Foundation`

Loop: `LOOP-RELEASE-ENGINEERING-001`

Risk ceiling: `R1`

Authority mode: `CODEX_ELIGIBLE`

## Mission

Create a static, evidence-backed release engineering foundation before any
release automation, deployment, tagging, production mutation, or rollback
execution is considered.

## Ordered Work Orders

1. `WO-RELEASE-001 - Current Release Evidence Reconciliation` (complete)
2. `WO-RELEASE-002 - Release Artifact and Provenance Contract` (complete)
3. `WO-RELEASE-003 - Release Readiness Gate Model` (complete)
4. `WO-RELEASE-004 - Rollback Evidence Contract` (complete)
5. `WO-RELEASE-005 - Release Operator Read-Only Surface` (complete)
6. `WO-RELEASE-006 - Safety Validation and Program Rollup` (complete)

## Static Model

The program's current static/read-only model is
`components/operator/release-engineering-program.ts`, with focused validation in
`tests/release-engineering-program.test.ts`. The model covers
`WO-RELEASE-002` through `WO-RELEASE-006`, pins their report paths, and keeps
release execution, deployment, tagging, rollback execution, production writes,
GitHub mutation, secrets, environment/package/Vercel/auth/database changes,
workers, schedulers, runtime activation, autonomy, and owner tasks outside the
program.

## Boundaries

Allowed: repository evidence, static/read-only governance models and surfaces,
tests, reports, normal Git/PR lifecycle, and read-only post-merge verification.

Blocked: deployment, release, tag, rollback execution, production writes,
secrets, credentials, environment or package changes, Vercel settings,
database/schema/data mutation, command runners, workers, schedulers, autonomy,
Hermes/MCP activation, memory writes or retrieval, dynamic ingestion, and
TerraFusion/PACS access.
