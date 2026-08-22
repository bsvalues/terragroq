# WO-AEH-024 — AEGIS bounded worker repository substage

Status: `REPOSITORY_CONTRACT_VALIDATED / INDEPENDENT_REVIEW_PASS / R3_INSTALL_BLOCKED / NOT_LIVE_ADAPTER_PROVEN`.

The replacement worker is a closed, HASH_VERIFY-only lifecycle composed through the WO021 PULL, HEARTBEAT, CANCEL, and CANCEL_ACK SDK surface. Startup reconciles retained descriptors through WO019 before IDLE. Heartbeat advances the active renewal sequence; concurrency remains one; active identity persists through cleanup and HANDOFF, and only an exact durable WO017/018 receipt clears it.

The caller supplies no path or bytes. A typed fake sandbox opens an immutable object by bounded object ID and source-receipt digest using required no-follow/read-only/exclusive semantics. Before and after reads, the worker verifies the exact object, receipt, device, inode, regular-file type, single link, immutable flag, and declared size. It hashes every returned `Uint8Array` chunk internally, rejects malformed, short, extra, overflow, identity-changing, symlink, hardlink, device, and receipt-conflicting input, and distinguishes a valid digest mismatch from execution failure.

Cleanup is bounded and must return a closed receipt binding object, attempt, lease, fence, removal, UUID, and digest. Missing or mismatched cleanup proof retains the active attempt in RECONCILING. Cancellation requires the current renewed binding across tree/CANCEL/ACK, bounded supervisor evidence, exact ACK evidence, and cleanup before handoff or WO019 ambiguity routing.

The typed `executeHashVerify` call receives the complete immutable CPU, RAM, scratch, PID, timeout, output, and no-sockets policy with an empty socket allowlist. Its receipt must repeat every limit and classify only PASS, TIMEOUT, OOM, DISK_QUOTA, PIDS, or NETWORK_ATTEMPT; non-PASS classifications clean up and reconcile. Successful verification is written through a content-addressed result store, and durable handoff must exactly bind result, computed/input, cleanup, result-store, and current worker-binding digests.

The systemd artifact is explicitly validation-only and noninstallable: an impossible authority condition, unresolved fixed hashed entrypoint/identity placeholders, non-root controls, empty capabilities, strict filesystem/home/device/kernel protections, an isolated compute network namespace with network syscalls denied, restrictive syscall policy, 512 MiB memory, TasksMax=2 for worker plus one child, runtime/stop bounds, control-group kill, and no restart. WO021 transport belongs to a separate external broker boundary that is explicitly not implemented or proven.

Sixteen native fake-sandbox/property tests pass twice, covering chunk hashing, digest mismatch, short/extra/malformed reads, staging mutation and special-file/link defenses, strict opaque `obj_sha256_<64hex>` object identifiers, canonical full-configuration identity and signed binding mismatches, strict closed constructor/config validation and safe limits, bounded local timeout and cleanup ambiguity/restart blocking, concurrency and restart-first reconciliation, renewed cancellation binding/ACK evidence, durable handoff, and inert service hardening. The configuration digest is derived over the complete closed configuration except its own field, including runtime, template, policy, image, identity, network, and resource controls; signed bindings must exactly match its config, image, and policy digests. The behavioral vectors use the actual exported WO021 Ed25519 verifier/keyring for signed PULL and HEARTBEAT, then bind HASH_VERIFY and the renewed identity through content-addressed storage and durable handoff. A separate real-signature vector signs CANCEL and CANCEL_ACK against the exact current renewal; its RFC 4122 observation evidence identifier, digest, and ambiguous disposition must match the supervisor observation before the worker routes the retained execution to WO019 reconciliation.

No process, cgroup, namespace, AEGIS host, service, network, filesystem payload, broker, database, credential, live adapter, or issue #357 path was touched. Repository proof does not establish systemd installation, non-root token/ACL, kernel cgroup/network/mount enforcement, real no-follow reads, secure cleanup, process-tree kill, Atlas/WO021 transport, live leases/fences, OOM/timeout behavior, performance, or production readiness.

Rollback removes only the module, config/template, test, report, and evidence.

## Independent review closure

- Reviewer: `/root/packet_assurance` (independent of the final builder lane)
- Verdict: `PASS_REPOSITORY_CONTRACT_ONLY`; zero unresolved repository-contract blockers
- Revalidation: native fake-sandbox/property suite `16/16 PASS` twice
- Integrity: strict opaque object identifiers, canonical full configuration identity, and signed config/image/policy bindings were independently verified
- Containment contract: bounded classification, local timeout, cleanup retention, content-addressed result storage, durable handoff, renewed cancellation binding, and Ed25519 action flows passed injected tests
- Artifact integrity: worker, config, inert template, and test hashes matched; scoped diff validation passed
- Required remaining gate: exact R3 AEGIS installation authority plus live systemd, identity, cgroup, namespace, filesystem, cleanup, process-tree, broker, lease/fence, resource, and uninstall proof. This substage does not complete WO-AEH-024.
