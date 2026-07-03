# WO-LOCAL-072 — Live Status Design Evidence Rollup

## Result

PASS / LIVE STATUS DESIGN COMPLETE.

This work order summarizes LOCAL-OMEN-LIVE-STATUS-DESIGN-BATCH-001 and determines that a future read-only live status implementation batch can be considered, subject to owner authority.

## Base

```text
origin/main = 13d761bc53b729b7d2ec6fd7ebfc58d4c6c7f74f
```

## Completed Work Orders

| Work Order | Result | PR | Evidence |
| --- | --- | --- | --- |
| WO-LOCAL-067 — Live Status Boundary Gate | PASS | #253 | Defined read-only display boundary and blocked execution/mutation. |
| WO-LOCAL-068 — Read-Only Status Source Design | PASS | #254 | Designed safe source model and blocked unsafe sources. |
| WO-LOCAL-069 — Local Status API Safety Gate | PASS | #255 | Recommended a future GET-only, local-only API with no action surface. |
| WO-LOCAL-070 — UI Live Status UX Design | PASS | #256 | Designed future `/runtime` live status UX without adding behavior. |
| WO-LOCAL-071 — Backup Metadata Read Safety Gate | PASS | #257 | Defined metadata-only backup policy and blocked backup contents/automation. |
| WO-LOCAL-072 — Live Status Design Evidence Rollup | PASS | pending | Added this rollup. |

## Recommended Read-Only Source Model

Use layered read-only status:

1. Static known posture from repo-owned model/docs.
2. GET-only localhost health/readiness checks.
3. Approved localhost port checks for `3100`, `3101`, and `15432`.
4. Read-only Docker metadata for explicitly named WilliamOS containers only, if later approved.
5. Metadata-only backup reads for approved fields only, if later approved.

Every source must independently fail closed to `unknown`.

## Status API Recommendation

```text
STATUS_API_RECOMMENDATION: future implementation may be considered
MODE: read-only
NETWORK_SCOPE: localhost-only
METHODS: GET only
ACTION_PARAMETERS: blocked
COMMAND_RUNNER: blocked
SHELL_BRIDGE: blocked
MUTATION: blocked
```

## UI Design Recommendation

Future `/runtime` live status should remain a status surface, not a control surface:

- manual-only banner
- local runtime status cards
- unknown/stale state language
- backup metadata posture
- localhost route checks
- links to manual wrapper guidance
- no action buttons

## Backup Metadata Policy

```text
SAFE_METADATA:
- backup directory exists
- latest backup filename
- latest backup timestamp
- age bucket
- manual reminder state
- restore drill reminder

BLOCKED:
- backup contents
- database dump contents
- secrets
- env files
- cloud sync assumptions
- automation or schedules
```

## Remaining Risks

- Any implementation that shells out from the app would cross the safety boundary.
- Docker metadata reads must be tightly constrained to known WilliamOS names.
- Backup metadata must never read dump contents.
- Live status can become stale; the UI must make staleness explicit.
- Localhost-only assumptions must be retested before any implementation.

## Safety Rollup

```text
LIVE_STATUS_DESIGN_READY: true
IMPLEMENTATION_ADDED: false
API_ENDPOINT_ADDED: false
COMMAND_EXECUTION_ADDED: false
COMMAND_RUNNER_ADDED: false
SHELL_ENDPOINT_ADDED: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
BACKUP_SCAN_IMPLEMENTED: false
SECRETS_DISCLOSED: false
TERRAFUSION_POSTGRES_TOUCHED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass
npm run build: pass
```

## Next Recommended Batch

```text
LOCAL-OMEN-LIVE-STATUS-IMPLEMENTATION-GATE-BATCH-001
```

Recommended scope:

- create an owner authority gate before any endpoint exists
- decide whether a GET-only local status API is authorized
- keep command execution, action endpoints, polling workers, persistence, LAN exposure, and autonomy blocked
