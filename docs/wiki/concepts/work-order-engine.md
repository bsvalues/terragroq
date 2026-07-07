# Work Order Engine

The Work Order Engine is the native read-only WilliamOS surface for governed
work.

It makes `/goal`, `/loop`, active Work Orders, blocked owner decisions, evidence
rollups, completion reports, search/filter state, and next-lane decisions
inspectable inside the Primary command environment.

## What It Is

- A static-first read model for governed work.
- A native shell surface for the Primary Operator and Codex operator.
- A way to see what is active, complete, blocked, and proven.
- A way to keep completion reports and evidence close to the Work Orders they
  support.

## What It Is Not

- A command runner.
- An autonomous loop engine.
- A background worker.
- A scheduler or service.
- A GitHub write integration.
- A production-write surface.
- A Hermes, MCP, Brain Council, memory, vector, embeddings, ingestion, or RAG
  runtime.

## Native Surfaces

- `/work-orders` shows queues, details, filters, blocked decisions, and
  completion reports.
- `/goal-console` places `/goal` and `/loop` in the Primary shell.
- `/audit` carries evidence rollups and proof records.
- `/decisions` carries owner blockers and authority choices.
- `/academy` teaches the operating pattern.
- `/wiki` defines the concept and its boundary.
