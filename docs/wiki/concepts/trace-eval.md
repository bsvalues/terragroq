# Trace + Eval

Trace Ledger is the static proof-history layer for WilliamOS. It records how
goals, loops, Work Orders, evidence, memory references, owner decisions,
authority gates, Council advice, blockers, and safety boundaries were reasoned
through.

Failure-to-Eval turns classified failures and evidence gaps into future eval
candidate packets. Those packets are proposals only.

## Trace Ledger

A trace record captures what happened, what evidence supported the conclusion,
which confidence or risk changed, and what the trace does not authorize. Trace
records are read-only reasoning artifacts.

## Evidence Gaps

Evidence gaps include missing base proof, missing PR checks, missing production
route proof, missing owner decisions, missing authority gates, missing safety
flags, contradicted evidence, and stale context. A gap lowers or blocks
confidence until the missing proof is supplied.

## Confidence Movement

Confidence can be raised, lowered, blocked, or unchanged. Confidence movement
explains the evidence behind the change; it never grants authority.

## Failure-to-Eval

A failure can become an eval candidate only after it is classified as a
repeatable risk, missing test, unclear doctrine, wrong operating assumption, or
evidence gap. The candidate packet may describe a future assertion, risk level,
authority required, and blocked actions.

## Boundary

This page does not add runtime trace collection, telemetry service, eval runner,
command runner, autonomous loop execution, background worker, memory write,
dynamic ingestion, production write, Hermes/MCP activation, or test generation
automation. Trace and eval remain static knowledge until a future Work Order
authorizes implementation.
