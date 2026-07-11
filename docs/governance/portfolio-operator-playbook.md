# WilliamOS Portfolio Operator Playbook

Program: `portfolio-operator`

Goal: `GOAL-PORTFOLIO-OPERATOR-001 - Continuous Program and Goal Selection`

Loop: `LOOP-PORTFOLIO-OPERATOR-001`

## Standing Rule

A completed program routes to the next approved executable program. It does
not route back to William by default.

Codex closes the current evidence, reads live Git and PR truth, filters the
ratified backlog, selects the highest-priority dependency-cleared program
inside standing authority, generates its goal, loop, and bounded Work Order
chain, and continues.

## Selection Order

1. Unfinished active Work Order or goal.
2. Active PR remediation.
3. Dependency-cleared next goal in the current program.
4. Highest-ranked executable program in the canonical backlog.
5. Owner decision only when no approved executable program exists.

## Ranking

Programs gain priority for operational value, engineering value, dependency
readiness, risk reduction, downstream enablement, reversibility, bounded
scope, and available evidence. Protected authority, unresolved dependencies,
architectural conflict, destructive scope, or unclear success criteria reduce
or eliminate eligibility.

## Owner Decision Queue

The queue accepts only a genuinely empty approved backlog, strategic priority
conflict, production or deployment decision, destructive operation,
secret/credential requirement, architectural canon change, or material risk
increase. Routine implementation, Git, validation, PR, review remediation,
eligible merge, evidence, and continuation remain Codex operator work.

## Safety

The portfolio model is static and read-only. It adds no command runner,
autonomous runtime loop, scheduler, background worker, production write,
authentication change, database mutation, memory runtime, dynamic ingestion,
Hermes/MCP activation, or TerraFusion/PACS access.
