# WO-LOCAL-077 — Docker Metadata Deferral Gate

## Result

PASS / DOCKER METADATA DEFERRED.

This work order explicitly defers Docker metadata from the first live status implementation slice and defines the stricter gate required before it can be reconsidered.

## Base

```text
origin/main = 0d38d6769c1c719e5d502f4e64b938cb2be027da
```

## Decision

```text
DOCKER_METADATA_DEFERRED: true
FIRST_SLICE_INCLUDES_DOCKER: false
```

The first implementation slice must not read Docker metadata, use the Docker socket, shell out to Docker, or call Docker commands.

## Why Docker Metadata Is Higher Risk

- Docker introspection can expose env values, mounts, image metadata, and host paths if not constrained.
- Docker socket access is powerful and can become host-control access.
- Shelling out to `docker` would create command execution inside the app boundary.
- Container metadata can drift into start/stop/restart affordances.
- Named-container filtering must be proven before any app-level Docker visibility is trusted.

## Future Gate Requirements

A future Docker metadata gate must define:

- named-container-only allowlist
- read-only fields only
- no environment values
- no logs by default
- no Docker socket exposure unless separately authorized
- no shell command execution
- no Docker mutation commands
- no start/stop/restart/remove/create actions
- tests proving non-WilliamOS containers are ignored

## Read-Only Metadata Fields For Future Review

Potential future fields, subject to a later gate:

- container name
- expected image tag
- status label
- health label
- port mapping summary
- last metadata checked timestamp

Blocked fields:

- env values
- mounts with sensitive paths
- full inspect payload
- logs
- secrets
- unrelated container data

## Safety

```text
DOCKER_METADATA_DEFERRED: true
FUTURE_DOCKER_GATE_REQUIRED: true
IMPLEMENTATION_ADDED: false
DOCKER_INTEGRATION_ADDED: false
DOCKER_SOCKET_EXPOSED: false
COMMAND_EXECUTION_ADDED: false
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
WO-LOCAL-078 — Live Status Implementation Gate Evidence Rollup
```
