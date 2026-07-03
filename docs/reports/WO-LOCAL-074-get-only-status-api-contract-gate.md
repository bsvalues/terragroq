# WO-LOCAL-074 — GET-Only Status API Contract Gate

## Result

PASS / STATUS API CONTRACT DEFINED.

This work order defines the contract for a future GET-only read-only OMEN local runtime status API. No API endpoint is implemented.

## Base

```text
origin/main = f0d2202e2fbcf3c8c86b5b19f6b7ef44be3b021a
```

## Route Recommendation

```text
GET /api/local/runtime/status
```

## Methods

```text
METHODS_ALLOWED:
- GET

METHODS_BLOCKED:
- POST
- PUT
- PATCH
- DELETE
```

## Request Contract

The first implementation should accept no request parameters.

Blocked request inputs:

- action
- command
- container
- service
- port mutation
- start
- stop
- restart
- repair
- backup
- schedule

## Response Contract

Recommended response shape:

```json
{
  "ok": true,
  "mode": "manual-only",
  "host": "HP OMEN Gaming Laptop 16-ap0xxx",
  "scope": "localhost-only",
  "executionEnabled": false,
  "persistenceEnabled": false,
  "lanExposureEnabled": false,
  "checks": {
    "app": {
      "state": "ready|stopped|unknown|degraded|stale",
      "url": "http://127.0.0.1:3100",
      "health": "pass|fail|unknown",
      "readiness": "pass|fail|unknown"
    },
    "postgresProof": {
      "state": "documented|unknown",
      "expectedPort": "127.0.0.1:15432"
    }
  },
  "warnings": []
}
```

## Status States

- `ready`: approved HTTP checks pass
- `stopped`: app appears not reachable by approved HTTP checks
- `unknown`: source unavailable, unauthorized, unsafe, or not implemented
- `stale`: last safe reading exceeds freshness window
- `degraded`: some approved checks pass and others fail

## Error And Timeout Behavior

- HTTP check timeout should degrade the affected check to `unknown` or `degraded`.
- Endpoint errors should not trigger repair.
- No route should attempt start/stop/restart as recovery.
- Response must redact all secret-like data.

## Test Expectations

Future implementation must prove:

- GET returns the contract shape
- non-GET methods are rejected
- action-like query parameters are ignored or rejected safely
- no command runner exists
- no secret values appear in response
- localhost HTTP failures degrade safely

## Safety

```text
STATUS_API_CONTRACT_DEFINED: true
ROUTE_RECOMMENDATION: /api/local/runtime/status
METHODS_ALLOWED: GET
METHODS_BLOCKED: POST, PUT, PATCH, DELETE
COMMAND_RUNNER_ALLOWED: false
IMPLEMENTATION_ADDED: false
SHELL_ENDPOINT_ADDED: false
DOCKER_MUTATION_ADDED: false
SECRETS_DISCLOSED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass
npm run build: pass
```

## Next Recommended WO

```text
WO-LOCAL-075 — Static + HTTP Status Implementation Plan
```
