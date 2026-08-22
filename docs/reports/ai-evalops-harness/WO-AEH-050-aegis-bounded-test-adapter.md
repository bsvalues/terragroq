# WO-AEH-050 — AEGIS bounded TEST adapter repository substage

Result: `REPOSITORY_CONTRACT_VALIDATED / INDEPENDENT_REVIEW_PASS / R3_INSTALL_BLOCKED / NOT_LIVE_ADAPTER_PROVEN`.

The TEST adapter is separate from BUILD and HASH_VERIFY. It accepts only a closed `TEST` request bound to a fixed profile, runner, toolchain, image, configuration, and policy; an opaque content-addressed read-only source; declared test selection and output artifacts; `network: NONE`; concurrency one; and bounded CPU, RAM, scratch, PID, time, source, and output limits. The supplied configuration digest is recomputed over the complete closed configuration excluding only itself.

The adapter composes the WO021 SDK boundary for PULL, HEARTBEAT, CANCEL, and CANCEL_ACK and retains the WO024 restart-first, active-until-handoff lifecycle. It validates an immutable source stat receipt, independently hashes all source chunks, and compares the complete source identity again after execution. Selection and artifact names are normalized repository-relative identifiers with traversal, absolute, URI, backslash, and empty-segment forms rejected. PASS, FAIL, TIMEOUT, INFRA_ERROR, OOM, DISK_QUOTA, PIDS, NETWORK, CANCELLED, and AMBIGUOUS are stored classifications grounded in a matching containment specification and receipt. In particular, a failing test is not treated as an adapter or infrastructure failure. Results bind runner, toolchain, config, policy, image, containment, source, cleanup, and exact per-artifact digest/size/store receipts.

Twenty-two native fake-sandbox behavioral tests passed twice. They cover the complete typed outcome set, failure/result separation, normalized selector/artifact rejection, closed request/path/env/command rejection, pre/post source identity and internal rehashing, short/corrupt/mutated sources, undeclared access/output/network, containment and artifact receipts, deterministic replay identity, binding mismatch, cleanup/restart, local timeout and abort, durable handoff, and cancellation cleanup. The real WO021 Ed25519 vector exercises PULL and HEARTBEAT followed by CANCEL and CANCEL_ACK against the exact current renewal; ACK observation ID, digest, and disposition must match supervisor evidence.

No process, host, service, cgroup, namespace, live source, network, credential, database, container, package install, or external system was touched. This does not prove actual AEGIS execution, kernel containment, real read-only filesystem enforcement, runner/toolchain correctness, Ed25519 database receipt persistence, process-tree termination, or production readiness. R3 remains blocked.

Rollback removes only the TEST adapter module, validation configuration, native test, this report, and its evidence JSON.

## Independent review closure

- Reviewer: `/root/packet_matrix` (independent of the final builder lane)
- Verdict: `PASS_REPOSITORY_CONTRACT_ONLY`; zero unresolved repository-contract blockers
- Revalidation: native behavioral suite `22/22 PASS` twice
- Correctness: assertion `FAIL` remains a durable test result rather than infrastructure failure; immutable source rehash, normalized selection/artifact boundaries, containment classifications, artifact/result storage, cancellation evidence, handoff, and restart behavior passed
- Integrity: adapter, test, and configuration hashes matched; scoped diff validation passed
- Required remaining gate: exact R3 AEGIS installation and live runner, filesystem, containment, cancellation, toolchain, and uninstall proof. This substage does not complete WO-AEH-050.
