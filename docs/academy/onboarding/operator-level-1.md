# Operator Level 1 Onboarding

Operator Level 1 teaches the Primary how to read WilliamOS safely.

## What WilliamOS Is

WilliamOS is a private Primary/Owner operating environment. It is not a SaaS dashboard and not an autonomous agent runtime. It organizes goals, Work Orders, evidence, authority, memory, traces, and knowledge so the Primary can make precise decisions.

## Home

Home is the Primary briefing surface. It should show what matters now: stable systems, ready next work, blocked decisions, recent phases, local status, and evidence links.

## Work Orders

Work Orders define bounded work. They state what is allowed, what is blocked, what proves completion, and when Codex must stop.

## Evidence

Evidence proves reality. Tests, builds, PR checks, production readiness, route proof, and safety sweeps are evidence. Evidence does not authorize mutation by itself.

## Authority

Authority belongs to the Primary. WilliamOS may display gates and blocked decisions, but it must not approve itself.

## Memory

Memory preserves context. It can be stale, contradicted, evidence-supported, or owner-confirmed. Memory does not grant authority or execute work.

## Academy and Wiki

Academy teaches operation. Wiki defines concepts and policies. Both are read-only knowledge surfaces unless a Work Order explicitly scopes edits.

## Safe Next Move Model

1. Read the active goal and loop.
2. Confirm current `origin/main`.
3. Check allowed and blocked scope.
4. Execute the next listed Work Order if no stop condition exists.
5. Validate and record evidence.
6. Stop only for true blockers or batch completion.
