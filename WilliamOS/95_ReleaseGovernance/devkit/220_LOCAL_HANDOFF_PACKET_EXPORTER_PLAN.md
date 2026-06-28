---
type: devkit-plan
phase: 5Q
lane: Local Handoff Packet Exporter
status: implemented-local
generated: 2026-06-27
---

# Phase 5Q Local Handoff Packet Exporter Plan

## Objective

Add a preview-only handoff packet exporter that composes the current operator
handoff from existing read-only governance surfaces.

## Scope

- `GET /api/handoff-packet` read-only preview endpoint.
- Compose packet from repo state, evidence pack, validation runbooks, commit
  readiness review, Work Order metadata, and next valid gate.
- Control Center GUI preview with clipboard copy.
- Focused backend tests and validation evidence.

## Safety Contract

The exporter:

- does not write packet files;
- does not run validators;
- does not stage files;
- does not commit;
- does not push, PR, merge, tag, or release;
- does not schedule work;
- does not activate MCP;
- does not enable autonomy;
- does not perform production/data writes;
- does not execute external agents.

Clipboard copy is allowed as a user-initiated preview/export action and does not
write repository files.

## API Contract

```text
GET /api/handoff-packet
```

The response includes structured source payloads and `packet_text` for copy.
No file-write, run, execute, schedule, mutate, commit, push, or release endpoint
is part of Phase 5Q.

## Validation

```text
python -m pytest control-center/backend/tests/test_handoff_packet_exporter.py -q
python -m pytest control-center/backend/tests -q
cd control-center/frontend && npm run build
```
