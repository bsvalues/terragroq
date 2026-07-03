# WO-LOCAL-075 — Static + HTTP Status Implementation Plan

## Result

PASS / IMPLEMENTATION PLAN CREATED.

This work order creates the exact future implementation plan for the selected first slice: static posture plus localhost HTTP GET checks. No implementation is added.

## Base

```text
origin/main = 15f4962edbd26faf060c15282fb2a78780aeefb7
```

## Likely Files To Change Later

Potential future implementation files:

- `app/api/local/runtime/status/route.ts`
- `components/local/local-operator-surface.ts`
- `components/local/local-operator-panel.tsx`
- `tests/local-runtime-status-api.test.ts`
- `tests/local-operator-surface.test.ts`
- `docs/reports/<future-implementation-report>.md`

No file above is changed by this planning work order.

## Safe HTTP Targets

Future first-slice API may check only:

```text
http://127.0.0.1:3100/
http://127.0.0.1:3100/runtime
http://127.0.0.1:3100/goal-console
http://127.0.0.1:3100/api/health
http://127.0.0.1:3100/api/auth/readiness
```

Fallback:

```text
http://127.0.0.1:3101/<same paths>
```

Fallback is read-only only. The implementation must not bind, free, start, stop, or repair ports.

## Timeout Policy

Recommended timeout:

```text
per-target timeout: 750ms to 1500ms
total request budget: under 5 seconds
failure mode: unknown or degraded
```

Timeouts must not trigger remediation.

## Failure Handling

- all approved checks pass: `ready`
- root/shell passes but health/readiness fail: `degraded`
- no approved route responds: `stopped` or `unknown`
- timeout or fetch error: `unknown`
- stale cached data: `stale`

## UI Mapping

- `ready`: show green/readiness label
- `degraded`: show warning and manual wrapper guidance
- `stopped`: show manual start guidance only
- `unknown`: show status unavailable and manual status wrapper guidance
- `stale`: show stale timestamp and manual status wrapper guidance

## Test Plan

Future tests must cover:

- static posture appears in response
- localhost route checks map to `ready`
- partial failures map to `degraded`
- all failures map to `stopped` or `unknown`
- timeouts map to `unknown`
- fallback to `3101` is read-only
- no action parameters are honored
- non-GET methods are rejected
- response contains no secrets

## Manual Validation Steps

1. Ensure app is stopped and verify response reports `stopped` or `unknown`.
2. Start app manually with `scripts/local/williamos-omen-start.ps1`.
3. Verify status API reports route checks from `127.0.0.1:3100`.
4. Stop app manually with `scripts/local/williamos-omen-stop.ps1`.
5. Verify final posture returns to safe state.

## Rollback Plan

Future implementation rollback should be a code revert only:

- remove the new route file
- remove UI integration for live fields
- keep static Local Operations surface intact
- no host cleanup should be required because no host mutation is allowed

## Safety

```text
IMPLEMENTATION_PLAN_CREATED: true
IMPLEMENTATION_ADDED: false
COMMAND_EXECUTION_ADDED: false
PROCESS_EXECUTION_ADDED: false
DOCKER_INSPECT_ADDED: false
BACKUP_SCAN_ADDED: false
PORT_BINDING_CHANGED: false
START_STOP_BEHAVIOR_ADDED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-076 — Port Check Safety Plan
```
