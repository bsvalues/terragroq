# WO-LOCAL-113 — Next-Gate Decision Packet: Refinement vs Port/Docker/Backup Metadata

## Result

PASS.

The next local status lane was classified without authorizing metadata expansion
or control behavior.

## Current Capability

```text
CAPABILITY: read-only local runtime status display
ROUTE: GET /api/local/runtime/status
STATUS_ROUTE_MODEL: checks.statusRoute reports this request handler as serving
APP_HTTP_MODEL: checks.appHttp reports approved host-loopback HTTP checks
COMPATIBILITY_ALIAS: checks.app mirrors checks.appHttp
MODE: manual-only
SCOPE: localhost-only
EXECUTION_ENABLED: false
PERSISTENCE_ENABLED: false
LAN_EXPOSURE_ENABLED: false
```

The current source can show whether the status route is serving and can display
bounded localhost HTTP check results for approved app URLs. It does not manage,
repair, start, stop, inspect, or persist the local runtime.

## WO-LOCAL-108 Correction

```text
CORRECTED: route-serving semantics separated from host-loopback checks
BEFORE: container-localhost failures could make the route appear semantically stopped
AFTER: checks.statusRoute remains ready when the handler serves the request
HOST_LOOPBACK: checks.appHttp can still report stopped, degraded, or unknown
```

This corrected the proof-container namespace mismatch: `127.0.0.1:3100` and
`127.0.0.1:3101` can mean the container namespace when the route runs inside
the app proof image, while the status route itself is still live.

## Remaining Risks

```text
RISK_1: Host-loopback checks remain namespace-relative.
RISK_2: Operators may still over-read appHttp as full runtime truth.
RISK_3: Docker, backup, and port metadata remain intentionally absent.
RISK_4: Docker Desktop and WSL remain local host dependencies outside app control.
RISK_5: Manual wrapper operation remains required for runtime changes.
```

These are acceptable for the first live status slice because the API is
observational, bounded to approved GET checks, and explicit about its control
boundary.

## Options Classified

### Option A — UX Refinement Only

```text
SCOPE: stale-state UX refinement, manual refresh affordance if read-only, safer error copy, evidence polish
RISK: lowest
AUTHORITY_REQUIRED: normal docs/UI/test implementation gate
RECOMMENDATION: selected
```

### Option B — Approved Port Status Gate

```text
SCOPE: future host port status, only if separately authorized
RISK: medium, because host-port inspection can drift toward OS probing
STATUS: deferred
```

### Option C — Approved Docker Metadata Gate

```text
SCOPE: future named-container read-only metadata, only if separately authorized
RISK: medium-high, because Docker socket/API access can drift toward control
STATUS: deferred
```

### Option D — Approved Backup Metadata Gate

```text
SCOPE: future backup filename/timestamp metadata, only if separately authorized
RISK: medium, because backup scanning can expose local filesystem assumptions
STATUS: deferred
```

### Option E — Local Status Evidence Polish

```text
SCOPE: static evidence presentation polish
RISK: low
STATUS: compatible with Option A
```

### Option F — Pause Local Runtime Lane and Return to WilliamOS Shell/WOE

```text
SCOPE: stop local status lane and resume broader WilliamOS shell/work-order experience work
RISK: low
STATUS: valid alternative
```

### Option G — Phase 2 Ubuntu Server Planning

```text
SCOPE: return to dedicated host planning
RISK: planning-only if gated
STATUS: valid later lane, not required for this local status closure
```

## Recommended Option

```text
RECOMMENDED_OPTION: A — UX refinement only
RATIONALE: the first live status slice is now proved; expanding to port,
Docker, or backup metadata would add risk before the Primary needs it.
NEXT_SAFE_LANE: operator UX refinement and evidence clarity
```

This is preferred over new authority. The next lane should reduce confusion
around `statusRoute` versus `appHttp`, improve stale/error copy, and preserve
the manual-only posture.

## Authorization Posture

```text
METADATA_EXPANSION_AUTHORIZED: false
DOCKER_METADATA_AUTHORIZED: false
PORT_CHECKS_AUTHORIZED: false
BACKUP_METADATA_AUTHORIZED: false
COMMAND_EXECUTION_AUTHORIZED: false
```

## Blocked Next Lanes

```text
LIVE_STATUS_IMPLEMENTATION_EXPANSION: blocked until separately authorized
COMMAND_EXECUTION: blocked
COMMAND_RUNNER: blocked
DOCKER_METADATA: blocked
BACKUP_METADATA: blocked
PORT_CHECKS: blocked
PERSISTENCE: blocked
SERVICE_REGISTRATION: blocked
SCHEDULING: blocked
LAN_EXPOSURE: blocked
FIREWALL_DNS_ROUTER_CHANGES: blocked
DB_SCHEMA_MIGRATION: blocked
PACKAGE_DEPENDENCY_CHANGE: blocked
CLOUD_DEPLOYMENT: blocked
SECRETS_DISCLOSURE: blocked
HERMES_MCP_AUTONOMY: blocked
TERRAFUSION_PACS_TOUCH: blocked
UNRELATED_CONTAINER_TOUCH: blocked
```

## Decision Answers

```text
1_CURRENT_CAPABILITY:
Read-only local runtime status display with route-serving state separated from
host-loopback HTTP checks.

2_WO_LOCAL_108_CORRECTION:
checks.statusRoute now represents this status request; checks.appHttp represents
approved localhost app HTTP checks; checks.app remains a compatibility alias.

3_REMAINING_RISK:
Namespace-relative localhost checks can still be misread as complete runtime
truth, and metadata/control surfaces remain intentionally absent.

4_NEXT_SAFE_LANE:
A. live status refinement / operator UX refinement / evidence clarity.

5_EXPLICITLY_BLOCKED:
Command execution, Docker metadata, backup metadata, port checks, persistence,
services, schedules, LAN exposure, cloud changes, secrets, and unrelated systems.

6_VALIDATION_EVIDENCE:
WO-LOCAL-108 source validation passed focused status tests, full test suite,
build, and diff check; this packet reruns full docs-safe validation.

7_NEXT_WO_BATCH:
LOCAL-OMEN-LIVE-STATUS-REFINEMENT-BATCH-001.
```

## Next Recommended Batch

```text
LOCAL-OMEN-LIVE-STATUS-REFINEMENT-BATCH-001
```

Allowed scope should remain read-only UX refinement:

```text
stale-state UX refinement
manual refresh affordance if still read-only
safer error copy
evidence links
Local Operations page polish
no Docker metadata expansion
no backup metadata expansion
no port status expansion
no command execution
```

## Safety

```text
IMPLEMENTATION_ADDED: false
METADATA_EXPANSION_AUTHORIZED: false
DOCKER_METADATA_AUTHORIZED: false
PORT_CHECKS_AUTHORIZED: false
BACKUP_METADATA_AUTHORIZED: false
SERVICE_REGISTERED: false
SCHEDULE_CREATED: false
LAN_EXPOSURE_ENABLED: false
SECRETS_DISCLOSED: false
TERRAFUSION_PACS_TOUCHED: false
UNRELATED_CONTAINERS_TOUCHED: false
```

## Validation

```text
git diff --check: pass
npm test -- --run: pass
NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build: pass
```
