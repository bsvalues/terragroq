# WilliamOS Runtime Operator Program

Program: `PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001`

Goal: `GOAL-WILLIAMOS-RUNTIME-OPERATOR-001`

Loop: `LOOP-WILLIAMOS-RUNTIME-OPERATOR-001`

Owner authorization: explicit, 2026-07-10

## Mission

Run bounded R0/R1 Work Orders after the initiating Codex session ends. The
runtime leases owner-created queue records, asks Codex for a structured patch
inside a read-only sandbox, validates the patch in a separate job, opens or
updates a pull request, monitors checks and review threads, retries bounded
remediation, merges eligible work, and records append-only evidence.

## Architecture

GitHub Actions is the control plane. GitHub Issues is the durable queue and
checkpoint ledger. `openai/codex-action@v1` is the reasoning worker. Codex gets
no GitHub token and runs with `sandbox: read-only`; it returns a schema-bound
unified diff. A separate publish job applies the patch, enforces the exact path
allowlist, runs fixed validation, attests the result, and owns repository writes.

The repository variable `WILLIAMOS_RUNTIME_OPERATOR_ENABLED` is the global kill
switch. The workflow remains inert unless its value is exactly `true`.

## Work Order Chain

1. `WO-RUNTIME-OPERATOR-001 - Runtime Authority and Threat Boundary`
2. `WO-RUNTIME-OPERATOR-002 - Durable Work Order Envelope`
3. `WO-RUNTIME-OPERATOR-003 - Authority Policy Evaluator`
4. `WO-RUNTIME-OPERATOR-004 - Deterministic Lease and Idempotency Model`
5. `WO-RUNTIME-OPERATOR-005 - Read-Only Codex Patch Boundary`
6. `WO-RUNTIME-OPERATOR-006 - Validation and Publish Isolation`
7. `WO-RUNTIME-OPERATOR-007 - Pull Request Check Monitor`
8. `WO-RUNTIME-OPERATOR-008 - Review Remediation and Retry Ceiling`
9. `WO-RUNTIME-OPERATOR-009 - Audit Artifact Attestation`
10. `WO-RUNTIME-OPERATOR-010 - Kill Switch and Stop Runbook`
11. `WO-RUNTIME-OPERATOR-011 - Adversarial Safety Tests`
12. `WO-RUNTIME-OPERATOR-012 - Disabled Control Plane Deployment`
13. `WO-RUNTIME-OPERATOR-013 - Owner Credential Activation Gate`
14. `WO-RUNTIME-OPERATOR-014 - End-to-End Low-Risk Pilot`

Work Orders 001-012 are repository-operable. Work Order 013 is a genuine owner
wall because only the Owner may place `OPENAI_API_KEY` in GitHub Actions
secrets. Work Order 014 begins only after that secret exists and the kill switch
is explicitly enabled.

## Initial Authority

Allowed:

- repository `bsvalues/terragroq` only;
- queue records authored by `bsvalues` only;
- R0/R1 tasks only;
- exact file allowlists per Work Order;
- fixed diff, lint, test, and build gates;
- runtime branches under `runtime/`;
- PR creation, bounded review remediation, eligible squash merge;
- GitHub issue comments, Actions logs/artifacts, and artifact attestations.

Blocked:

- PACS, county systems, county data, or TerraFusion production;
- production writes, deployment, release, tags, or rollback execution;
- auth, DB, schema, data, environment, package, dependency, or Vercel changes;
- secret disclosure or credentials inside repository content;
- arbitrary commands supplied by queue records;
- destructive Git, force push, history rewrite, or broad repository mutation;
- concurrent leases, unbounded retries, or authority self-expansion.
