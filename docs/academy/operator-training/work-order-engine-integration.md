# Work Order Engine Integration

WilliamOS treats the Work Order Engine as a native read-only operating layer.

## Purpose

The Work Order Engine shows the Primary and Codex operator where governed work
stands:

- `/goal` intent and success state.
- `/loop` batch scope, Work Orders, validation, and stop conditions.
- Active Work Orders.
- Blocked owner decisions.
- Evidence rollups.
- Completion reports.
- Next safe lane.

## Boundary

The Work Order Engine does not execute work.

It does not add command runners, autonomous loop execution, background workers,
schedulers, services, production writes, runtime control, Hermes activation,
MCP activation, memory writes, dynamic ingestion, vector stores, embeddings, or
RAG runtime.

## Operator Rule

Codex may operate an authorized loop through implementation, validation, PR,
review remediation, merge, and verification when the packet grants that scope.
William remains Owner and authority, not the courier.

## Stop Conditions

Stop when the requested work needs authority outside the packet, secrets,
credential disclosure, auth behavior changes, DB/schema changes, env/package
changes, Vercel changes, production writes, worker activation, runtime control,
or a validation failure that cannot be fixed inside scope.
