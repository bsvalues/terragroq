# WO-SHELL-009 - Memory Placement

## Result

`RESULT: PASS_PENDING_CHECKS`

## Goal

`GOAL-WOS-001 - Primary Shell Completion`

## Base

`origin/main = dcca804b9b2400c79eeb54b8cb9830ebc8e897b6`

## Scope

Place Memory inside the Primary Operator shell as the continuity layer for
evidence-linked context, review queues, stale or contradicted memory, and
authority-aware recall.

## Files

- `app/(shell)/memory/page.tsx`
- `components/memory/memory-native-area.ts`
- `components/memory/memory-native-area-panel.tsx`
- `components/memory/memory-governance-registry.ts`
- `components/memory/memory-view.tsx`
- `tests/memory-native-area.test.ts`
- `tests/memory-governance-registry.test.ts`
- `docs/reports/WO-SHELL-009-memory-placement.md`

## Changes

- Reframed Memory as the Primary Operator continuity layer.
- Added a visible shell placement sequence: capture, connect, correct, and
  constrain.
- Reordered `/memory` so Primary Memory placement appears before registry and
  queue details.
- Removed team-oriented placeholder copy from the memory form.
- Updated next lane guidance to WO-SHELL-010 - Shell Polish / Primary
  Experience Rollup.
- Updated tests to enforce Primary shell placement and blocked memory authority
  lanes.

## Safety

- `MEMORY_PLACEMENT_CHANGED: true`
- `MEMORY_INGESTION_ADDED: false`
- `MEMORY_EXTRACTION_ADDED: false`
- `MEMORY_WRITE_ADDED: false`
- `CANON_PROMOTION_ADDED: false`
- `DELETION_ARCHIVE_MUTATION_ADDED: false`
- `RUNTIME_MEMORY_READ_ADDED: false`
- `BRAIN_COUNCIL_RUNTIME_MEMORY_READ_ADDED: false`
- `HERMES_MEMORY_READ_ADDED: false`
- `MCP_MEMORY_READ_ADDED: false`
- `VECTOR_STORE_ADDED: false`
- `EMBEDDINGS_ADDED: false`
- `DB_SCHEMA_CHANGED: false`
- `FILESYSTEM_SCAN_ADDED: false`
- `DYNAMIC_INGESTION_ADDED: false`
- `COMMAND_EXECUTION_ADDED: false`
- `COMMAND_RUNNER_ADDED: false`
- `GITHUB_WRITE_ADDED: false`
- `CODEX_AUTOMATION_ADDED: false`
- `DOCKER_METADATA_ADDED: false`
- `BACKUP_SCAN_ADDED: false`
- `PORT_CHECKS_ADDED: false`
- `SERVICE_REGISTERED: false`
- `SCHEDULE_CREATED: false`
- `LAN_EXPOSURE_ENABLED: false`
- `AUTH_BEHAVIOR_CHANGED: false`
- `AUTH_POLICY_CHANGED: false`
- `PUBLIC_SIGNUP_REINTRODUCED: false`
- `CLOUD_CHANGED: false`
- `PRODUCTION_WRITE_ADDED: false`
- `SECRETS_EXPOSED: false`
- `HERMES_MCP_AUTONOMY_CHANGED: false`
- `TERRAFUSION_PACS_TOUCHED: false`

## Validation

Required before merge:

- focused Memory shell tests
- forbidden SaaS/auth/team/workspace/admin language scan on Memory shell surfaces
- secret scan on changed files
- `git diff --check`
- `npm run lint`
- `npm test -- --run`
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`
- PR checks
- review threads 0 unresolved
- production `/api/health`
- production `/api/auth/readiness`
- production `/memory`

## Next Recommended Work Order

`WO-SHELL-010 - Shell Polish / Primary Experience Rollup`
