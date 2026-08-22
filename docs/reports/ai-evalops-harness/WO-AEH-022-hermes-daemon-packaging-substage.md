# WO-AEH-022 — inert Hermes daemon packaging substage

Result: `REPOSITORY_PACKAGING_CONTRACT_VALIDATED / INDEPENDENT_REVIEW_PASS / R3_INSTALL_BLOCKED`.

The package adds a standalone Node entrypoint and runner around the accepted Hermes resident worker and WO021 SDK boundary. It accepts only `INERT_NO_CLAIM`, verifies an immutable release manifest before boot, loads the validation config and a Windows Credential Manager reference through absolute OS paths, and starts either IDLE with claims/network/process creation disabled or RECONCILING when durable descriptors exist. It does not accept a private key, secret, or credential literal in configuration.

The release manifest pins the entrypoint, package runner, worker, SDK, protocol, validation config, and validation-only CycloneDX SBOM by byte count and SHA-256. Missing, altered, duplicate, traversal, or unlisted-entrypoint material fails closed.

The Windows Task Scheduler template is disabled, cannot be demand-started, uses the fixed `NT SERVICE\WilliamOSHermesWorker` least-privilege identity, a fixed absolute Node/entrypoint command, absolute config/key-reference paths, and an inert mode. The dry-run planner consumes a closed observation for every candidate path with type, hash, owner, ACL, emptiness, and task definition identity. Reparse points, incomplete or untrusted observations, changed files, foreign files, and task collisions fail closed. Its per-file ledger records the exact preimage and whether the plan created the file. Rollback removes a created file only when its current hash still equals the planned hash, restores preexisting files from exact preimages, and removes only plan-created directories observed empty. Partial installation can resume only after created hashes verify. Evidence is always preserved.

Twelve native tests passed twice. They cover manifest verification and tamper, OS-reference loading, malformed/secret-shaped key metadata, no-claim startup and descriptor reconciliation, live-mode rejection, deterministic/idempotent planning, exact preexisting-file idempotency, changed-file and task collisions, reparse and foreign-file rejection, partial-install recovery, exact rollback scope, alternate-identity rejection, and disabled/nonadmin task semantics. Tests imported and invoked repository code only; no child process, task, service, credential store, network, host, or external state was accessed.

Nonproofs: this does not prove a bundled Node binary, production dependency bundle, genuine credential retrieval, ACL application, Task Scheduler registration, Windows service identity creation/logon rights, Atlas connectivity, Ollama connectivity, live claim handling, restart persistence, or uninstall behavior. The manifest/SBOM are validation artifacts, not a production release attestation. R3 remains blocked.

Rollback removes only the six new packaging artifacts, native test, this report, and its evidence file.

## Independent review closure

- Reviewer: `/root/packet_matrix` (independent of the final builder lane)
- Verdict: `PASS_PACKAGING_CONTRACT_ONLY`; zero unresolved repository-packaging blockers
- Revalidation: packaging suite `12/12 PASS` twice
- Safety: closed observed snapshots, collision/reparse refusal, per-file ownership/preimages, partial recovery, hash-gated rollback, foreign-file preservation, and empty-created-directory handling passed
- Integrity: package, entrypoint, test, release manifest, SBOM, and inert task hashes matched; scoped diff validation passed
- Required remaining gate: exact R3 Hermes host authority and live bundle, credential retrieval, ACL, task/service identity, Atlas/Ollama connectivity, restart, canary, and uninstall proof. This packaging substage does not complete WO-AEH-022.
