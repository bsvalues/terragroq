# WilliamOS Academy

The Academy is the governed learning layer for WilliamOS.

It teaches the Primary Operator and authorized agents how to use WilliamOS without turning the system into an autonomous runtime. Academy material is static, evidence-aware, and authority-gated.

## Purpose

- Teach the operating model: Home, Work Orders, Evidence, Authority, Memory, Trace Ledger, Academy, and Wiki.
- Teach safe `/goal` and `/loop` operation.
- Teach how to recognize stop conditions and owner authority gates.
- Give Codex and future agents a shared training baseline.

## Boundaries

- Academy does not execute commands.
- Academy does not grant authority.
- Academy does not track runtime progress.
- Academy does not train models, start workers, or activate Hermes/MCP.
- Academy does not write to memory or promote canon.

## Ownership

The Primary owns authority. Codex may use Academy lessons as static guidance inside an authorized Work Order packet, but Academy content does not override current owner instructions, Work Order scope, or evidence.

## Navigation

- `onboarding/` contains Primary Operator onboarding.
- `operator-training/` contains governed operating lessons.
- `agent-training/` contains agent-facing safety lessons.
- `exercises/` contains static drills.
- `certification/` defines learning levels without granting permissions.

## Directory Map

- `onboarding/operator-level-1.md` teaches first-run Primary orientation.
- `operator-training/work-order-governance.md` teaches WOs, `/goal`, and `/loop`.
- `operator-training/evidence-discipline.md` teaches proof rules.
- `operator-training/authority-gates.md` teaches owner authority boundaries.
- `operator-training/codex-operator-runbook.md` teaches Codex as bounded operator.
- `agent-training/agent-level-1.md` teaches safe agent conduct.
- `exercises/` contains static drills that do not mutate state.
- `certification/` describes learning levels without granting permissions.

## Naming Rules

Use lower-case, hyphenated filenames. Academy pages should name the audience or
lesson purpose directly. Wiki pages should name the concept directly.

## Expansion Rules

Add new lessons only through a scoped Work Order. Academy content may explain
authority gates, but it must not grant authority or add runtime behavior.
