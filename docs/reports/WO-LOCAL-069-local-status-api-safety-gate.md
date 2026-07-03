# WO-LOCAL-069 — Local Status API Safety Gate

## Result

PASS / STATUS API POLICY DEFINED.

This work order defines whether a future local status API is allowed and the constraints it must satisfy. No API endpoint is implemented in this batch.

## Base

```text
origin/main = e864ae507b36af781008c5e630ef85474d13fa0a
```

## Recommendation

A future local status API may be allowed only as an explicitly read-only, local-only endpoint.

Recommended posture:

```text
STATUS_API_RECOMMENDED: yes, behind a future owner-approved implementation WO
API_MODE: read-only
NETWORK_SCOPE: localhost-only
ACTION_VERBS: none
COMMAND_RUNNER: forbidden
SHELL_BRIDGE: forbidden
```

## Required API Limits

The future API must:

- use `GET` only
- return status objects only
- accept no action parameters
- expose no start, stop, restart, repair, create, delete, or mutate operations
- return `unknown` when a source is unavailable, stale, unsafe, or unauthorized
- redact all secret-bearing values
- avoid reading env files or backup contents
- stay local-only
- include tests proving no action surface exists

The future API must not:

- execute shell commands from UI input
- expose a command runner
- call Docker mutation commands
- start/stop containers
- register services or schedules
- expose LAN or public access
- reveal `DATABASE_URL`, auth secrets, access grant secrets, env values, logs, or backup dump contents
- touch TerraFusion Postgres

## Response Shape

Recommended future shape:

```text
{
  mode: "read-only",
  host: "HP OMEN Gaming Laptop 16-ap0xxx",
  posture: "manual-only",
  sources: [{ name, status, checkedAt, stale, reason }],
  actionsEnabled: false,
  commandExecutionEnabled: false,
  warnings: []
}
```

## Testing Requirements

Future implementation must test:

- `GET` returns safe status fields
- no mutating HTTP methods are accepted
- no action query/body parameters are honored
- secrets are never present in response JSON
- unavailable sources degrade to `unknown`
- localhost-only deployment assumptions are documented

## Safety

```text
STATUS_API_POLICY: read-only/local-only
STATUS_API_RECOMMENDED: true
IMPLEMENTATION_ADDED: false
COMMAND_RUNNER_ADDED: false
SHELL_ENDPOINT_ADDED: false
MUTATION_ADDED: false
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
WO-LOCAL-070 — UI Live Status UX Design
```
