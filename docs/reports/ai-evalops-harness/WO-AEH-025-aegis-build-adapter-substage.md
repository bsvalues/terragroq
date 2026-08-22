# WO-AEH-025 — AEGIS BUILD adapter repository substage

Status: `REPOSITORY_CONTRACT_VALIDATED / INDEPENDENT_REVIEW_PASS / R3_LIVE_BLOCKED / NOT_LIVE_ADAPTER_PROVEN`.

The redesigned adapter is a closed BUILD-only lifecycle distinct from HASH_VERIFY and TEST. Its canonical configuration fixes the template, toolchain, image, policy, dependency closure, declared output set, non-elevated identity, no-network policy, concurrency one, and resource limits. Requests contain only an opaque content-addressed source identity, source receipt/digest/size, the exact dependency closure, and exact normalized outputs. No caller command, arguments, environment, path, URL, or network override is accepted.

PULL and HEARTBEAT use the WO021 SDK boundary and heartbeat advances the retained binding. Each build independently opens a fresh read-only/no-follow source handle, verifies its immutable identity, internally stream-hashes the exact bytes with short/extra/corrupt rejection, rechecks identity, executes in a distinct run, and proves cleanup before the next run. Two separately identified sandbox executions receive the same frozen WO024-style containment specification. Each must return the exact output manifest with content object IDs, digests, and bounded sizes. Equal manifests produce `REPRODUCIBLE`; unequal valid manifests produce the typed `NON_REPRODUCIBLE` result rather than false success. TIMEOUT, OOM, disk quota, PID, network, malformed output, mutation, cleanup, store, and handoff failures reconcile.

Each run has an exact cleanup receipt. The stored result binds source, dependency closure, template/toolchain/image/config/policy, both containment and cleanup receipts, both output manifests, the current worker binding, and the reproducibility classification. Only its exact durable store receipt can clear active state. Signed current-renewal CANCEL/CANCEL_ACK uses observed ambiguity evidence and routes retained work to WO019.

Twelve native fake-boundary tests pass, including corrupt/short/extra source streams and a contamination adversary that would falsely match if both builds shared one mutable run context. No process, network, filesystem payload, cgroup, host, service, build toolchain, database, dependency installation, or live adapter was touched. This does not prove live AEGIS containment, actual clean-room reproducibility, kernel limits, source immutability, process termination, protocol persistence, or production readiness. R3 remains blocked.

Rollback removes only the WO025 adapter, validation configuration, test, report, and evidence.

## Independent review closure

- Reviewer: `/root/packet_matrix` (independent of the final builder lane)
- Verdict: `PASS_REPOSITORY_CONTRACT_ONLY`; zero unresolved repository-contract blockers
- Revalidation: native fake-boundary suite `12/12 PASS` twice
- Reproducibility contract: two independently opened, internally rehashed and cleaned run contexts, exact manifests, and contamination-driven `NON_REPRODUCIBLE` classification were verified
- Composition: signed current-renewal lifecycle, dependency/output closure, containment faults, result storage, durable handoff, cancellation evidence, and restart reconciliation remained green
- Integrity: adapter, test, and configuration hashes matched; scoped diff validation passed
- Required remaining gate: exact R3 AEGIS live build authority plus clean-room, kernel containment, toolchain, source immutability, process termination, protocol persistence, and uninstall proof. This substage does not complete WO-AEH-025.
