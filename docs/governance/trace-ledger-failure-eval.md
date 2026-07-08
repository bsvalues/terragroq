# Trace Ledger + Failure-to-Eval Doctrine

Trace Ledger is a static/read-only proof-history layer for WilliamOS.
Failure-to-Eval is a static proposal model for future eval candidates.

## Doctrine

- Trace records explain how work, blockers, evidence, confidence, and authority
  gates were reasoned through.
- Trace records may cite Work Orders, evidence, memory labels, owner decisions,
  Brain Council advice, and production proof.
- Trace records do not collect runtime events.
- Trace records do not create telemetry, persistence, evals, tests, commands, or
  automation.
- Failure-to-Eval candidates describe future assertions only.
- Eval implementation, eval execution, telemetry, and runtime trace collection
  require a future owner-authorized Work Order.
- Confidence movement is advisory and evidence-based. It does not grant
  authority.

## Blocked

- runtime trace collection
- telemetry service
- eval runner
- command runner
- autonomous loop execution
- background worker or scheduler
- production-write behavior
- DB/schema/data mutation
- memory write or runtime memory retrieval
- vector/embedding/RAG runtime
- dynamic ingestion
- Hermes/MCP/worker activation
- TerraFusion/PACS touch
- secrets disclosure
