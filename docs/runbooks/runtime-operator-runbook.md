# WilliamOS Runtime Operator Runbook

## Deployment State

The workflow is deployed disabled. It performs no queue lease, Codex call, Git
write, or merge while `WILLIAMOS_RUNTIME_OPERATOR_ENABLED` is absent or not
equal to `true`.

## Owner Activation

The Owner performs both actions without sharing the secret with Codex:

1. Add an Actions repository secret named `OPENAI_API_KEY` in GitHub.
2. Set the repository variable `WILLIAMOS_RUNTIME_OPERATOR_ENABLED` to `true`.

The API key must never be pasted into an issue, terminal transcript, document,
test, screenshot, workflow input, commit, PR, or report.

## Queueing Work

Use the `WilliamOS Runtime Work Order` issue form. Only `bsvalues` is accepted
as an initial queue actor. The JSON envelope supplies the exact task, R0/R1
risk, exact paths, and fixed validation gates. Adding `williamos:ready` wakes
the workflow; the oldest eligible issue is leased first.

## `/stop` and Kill Switch

Immediate stop:

```powershell
gh variable set WILLIAMOS_RUNTIME_OPERATOR_ENABLED --repo bsvalues/terragroq --body false
gh run list --repo bsvalues/terragroq --workflow runtime-operator.yml --status in_progress --json databaseId --jq '.[].databaseId' | ForEach-Object { gh run cancel $_ --repo bsvalues/terragroq }
```

This disables future leases and requests cancellation of in-flight workflow
runs. Existing PRs remain open and auditable; the operator does not delete
branches, issues, comments, artifacts, or evidence on stop.

## Recovery

Leases and checkpoints are recorded on the queue issue. Runtime branches and
PRs use the issue number as the idempotency key. The scheduled monitor resumes
green PR processing, queues at most three review/check remediation attempts,
and moves exhausted retries to `williamos:blocked`.

## Audit

Each run retains its request and structured result as Actions artifacts. The
publish job creates a GitHub artifact attestation for the structured Codex
result. Issue checkpoint comments, commits, pull requests, checks, review
threads, merge commits, Actions logs, and attestations form the evidence chain.
