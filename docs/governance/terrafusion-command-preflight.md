# TerraFusion Command Layer Preflight

Program: `PROGRAM-WILLIAMOS-TF-COMMAND-PREFLIGHT-001`

Goal: `GOAL-TF-COMMAND-PREFLIGHT-001`

Loop: `LOOP-WILLIAMOS-TF-COMMAND-PREFLIGHT-001`

Base: `origin/main = 49fa4ffe7917bdc0440950ed7a1fb47cd2c0a837`

Risk ceiling: `R0`

Status: active

## Purpose

Reconcile what WilliamOS can truthfully represent about TerraFusion before
building `GOAL-TF-COMMAND-001`. The preflight defines identity, provenance,
staleness, evidence, and authority boundaries without reading or mutating a
TerraFusion runtime, deployment, database, county system, or external
repository.

## /goal

Desired state:

- one canonical TerraFusion project identity inside WilliamOS;
- explicit distinction between declared, observed, stale, unknown, and blocked
  state;
- static contracts for project card, Work Order feed, evidence feed, blocker
  queue, deployment posture, and next-move recommendation;
- a decision on whether the implementation can remain R1 static/read-only or
  requires a higher-risk integration gate.

Allowed:

- inventory existing WilliamOS TerraFusion references;
- static doctrine, schemas, fixtures, tests, and evidence;
- links to already-merged WilliamOS evidence;
- normal Codex branch, PR, review, eligible merge, and proof work.

Blocked:

- access to or mutation of a TerraFusion repository, runtime, deployment,
  database, API, cloud resource, county system, PACS, or credential;
- dynamic GitHub, Azure, Vercel, filesystem, Docker, or network ingestion;
- production health claims without current observed proof;
- auth, DB/schema/data, env/package, deploy, release, tag, command runner,
  background worker, scheduler, Hermes/MCP/skill activation, memory runtime,
  or autonomy.

## /loop

Mode: R0 preflight.

Continue until: the six preflight Work Orders complete or a typed authority wall
is reached.

Work Orders:

1. `WO-TF-COMMAND-000A - Existing WilliamOS TerraFusion Reference Inventory`
2. `WO-TF-COMMAND-000B - Project Identity and Provenance Contract`
3. `WO-TF-COMMAND-000C - Static Project Card and Feed Contracts`
4. `WO-TF-COMMAND-000D - Deployment and Staleness Semantics`
5. `WO-TF-COMMAND-000E - Authority and Safety Classification`
6. `WO-TF-COMMAND-000F - Implementation Decision and Evidence Rollup`

## Decision Rule

Proceed to `GOAL-TF-COMMAND-001` only if the first slice can use static,
explicitly sourced records and remain R1. Stop for owner authority before any
external repository connection, live status ingestion, deployment inspection,
county/PACS interaction, or mutation.

## Safety

This file creates no integration and makes no live TerraFusion claim.
