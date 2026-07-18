# WO-RELEASE-002 - Release Artifact and Provenance Contract

Result: `PASS / STATIC_ARTIFACT_PROVENANCE_CONTRACT_MODELED`

Program: `PROGRAM-RELEASE-ENGINEERING-001`

Lane: `codex-release-engineering-foundation`

## Scope

This Work Order defines the static evidence that a future release artifact must
carry before it can be considered release-ready. It does not build, deploy, tag,
publish, upload, or mutate an artifact.

## Contract

A release artifact evidence record must include:

- source commit and tree identity
- changed-path inventory
- validation commands and outcomes
- artifact names, hashes, and storage location when artifacts exist
- authority, reviewer, and evidence references

## Acceptance Gates

- Every artifact has source, hash, and validation provenance.
- Missing artifact proof blocks release readiness.
- Provenance does not contain secrets or raw credentials.

## Safety

```text
RELEASE_OR_DEPLOYMENT_EXECUTED: false
TAG_OR_ROLLBACK_EXECUTED: false
PRODUCTION_WRITE_ADDED: false
GITHUB_CALL_PERFORMED: false
AUTH_DB_ENV_PACKAGE_VERCEL_CHANGED: false
SECRET_OR_CREDENTIAL_ACCESSED: false
COMMAND_RUNNER_OR_WORKER_ADDED: false
RUNTIME_OR_AUTONOMY_ACTIVATED: false
OWNER_TASK_CREATED: false
```

## Downstream

`WO-RELEASE-003 - Release Readiness Gate Model` is ready for static modeling.
