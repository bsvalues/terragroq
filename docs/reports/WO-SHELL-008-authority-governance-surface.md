# WO-SHELL-008 - Authority / Governance Surface

## Result

`RESULT: PASS_PENDING_CHECKS`

## Goal

`GOAL-WOS-001 - Primary Shell Completion`

## Base

`origin/main = 0d8441d871b183b2f40e21d75cd8476bd79ccff9`

## Scope

Refine the Authority / Governance shell surface so it reads as the Primary
Operator authority layer for scope, gates, evidence requirements, owner
decisions, blocked authority, and static registry posture.

## Files

- `app/(shell)/governance/page.tsx`
- `components/governance/governance-native-area.ts`
- `components/governance/governance-native-area-panel.tsx`
- `components/governance/authority-registry.ts`
- `tests/governance-native-area.test.ts`
- `tests/authority-registry.test.ts`
- `docs/reports/WO-SHELL-008-authority-governance-surface.md`

## Changes

- Reframed Governance as the Primary Operator authority layer.
- Added a visible shell sequence: authority, gate, evidence, and decision.
- Preserved static read-only authority registry behavior and default-deny gates.
- Updated next lane guidance to WO-SHELL-009 - Memory Placement.
- Updated tests to enforce Primary shell framing, static registry posture, and
  blocked memory/runtime/autonomy lanes.

## Safety

- `AUTHORITY_GOVERNANCE_SURFACE_CHANGED: true`
- `APPROVAL_CONTROLS_ADDED: false`
- `AUTHORITY_STATE_MUTATION_ADDED: false`
- `PERMISSION_MODEL_CHANGED: false`
- `ACCESS_GRANTS_IMPLEMENTED: false`
- `COMMAND_EXECUTION_ADDED: false`
- `COMMAND_RUNNER_ADDED: false`
- `GITHUB_WRITE_ADDED: false`
- `CODEX_AUTOMATION_ADDED: false`
- `COUNCIL_RUNTIME_ADDED: false`
- `HERMES_ACTIVATION_ADDED: false`
- `MCP_ACTIVATION_ADDED: false`
- `WORKER_ACTIVATION_ADDED: false`
- `MEMORY_WRITE_ADDED: false`
- `RUNTIME_MEMORY_READ_ADDED: false`
- `DYNAMIC_RETRIEVAL_ADDED: false`
- `DOCKER_METADATA_ADDED: false`
- `BACKUP_SCAN_ADDED: false`
- `PORT_CHECKS_ADDED: false`
- `RUNTIME_CONTROL_ADDED: false`
- `AUTH_BEHAVIOR_CHANGED: false`
- `AUTH_POLICY_CHANGED: false`
- `PUBLIC_SIGNUP_REINTRODUCED: false`
- `DB_SCHEMA_CHANGED: false`
- `ENV_CHANGED: false`
- `PACKAGE_CHANGED: false`
- `LAN_EXPOSURE_ENABLED: false`
- `CLOUD_CHANGED: false`
- `PRODUCTION_WRITE_ADDED: false`
- `SECRETS_EXPOSED: false`
- `TERRAFUSION_PACS_TOUCHED: false`

## Validation

Required before merge:

- focused Authority / Governance shell tests
- forbidden SaaS/auth/admin/workspace language scan on Governance shell surfaces
- secret scan on changed files
- `git diff --check`
- `npm run lint`
- `npm test -- --run`
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`
- PR checks
- review threads 0 unresolved
- production `/api/health`
- production `/api/auth/readiness`
- production `/governance`

## Next Recommended Work Order

`WO-SHELL-009 - Memory Placement`
