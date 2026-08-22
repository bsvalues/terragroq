# WO-AEH-024 — inert AEGIS installation packaging substage

Status: `REPOSITORY_PACKAGING_CONTRACT_VALIDATED / INDEPENDENT_REVIEW_PASS / R3_INSTALL_BLOCKED / NO_HOST_MUTATION`.

This repository-only package separates the loopback networked WO021 protocol broker from the no-socket `HASH_VERIFY` compute child. The broker accepts only PULL, HEARTBEAT, CANCEL, and CANCEL_ACK and delegates to the existing SDK/keyring/executor boundary. The child entrypoint only streams SHA-256; its launcher contract fixes the executable, opaque object identity, nonroot account, empty capabilities, read-only root, private scratch, no sockets, and bounded CPU, RAM, scratch, PID, time, and output limits. There is no command-runner interface.

Runtime configuration contains durable reference identifiers only. It contains no credential values. An immutable release manifest binds the broker, child, packaging verifier, reference configuration, three service templates, and CycloneDX SBOM by SHA-256 and intended mode. Tampered, duplicate, escaping, unowned, or malformed entries fail closed.

The resolved systemd broker and worker templates use fixed absolute paths and the dedicated `williamos-aegis` identity. Both require `/etc/williamos/authority/WO-AEH-024-R3`; neither has a `WantedBy` target. The broker alone permits loopback IP and owns external WO021 transport. The worker and transient scope use private networking and denied network syscalls; the transient scope is one-process and cannot be installed directly.

The deterministic dry-run install and uninstall planners require a closed observed-host snapshot covering every target path and unit, including existence, type, owner/group, mode, digest, reparse/mount status, unit activation state, and release ownership tag. Foreign files or units, unsafe shared directories, reparse points, mount points, stale hashes, incompatible modes, and incomplete snapshots fail closed. Each accepted plan has a content-derived plan ID, per-object ownership ledger, exact preimages, identity and cgroup/network/mount constraints, and no enable/start actions.

Install rollback removes only exact objects recorded as created by that plan, removes directories only when that plan created them and they are empty, restores the prior release, and preserves evidence/logs. Partial-install recovery requires the matching plan ID, matching ownership tag, and a fresh closed snapshot before resume. Uninstall removes only exact owned objects and retains their preimages for rollback without activation. Both planners refuse to operate when the R3 marker is present because this substage is validation-only, not the live installer.

Twelve native inert tests pass, including foreign file/unit collisions, shared-directory ownership mismatch, reparse and mount rejection, partial-install recovery, exact-owned idempotency, and rollback scope. They perform no socket, process, service-manager, filesystem installation, identity, credential, database, cgroup, namespace, or host mutation. This package does not prove Linux/systemd compatibility, credential retrieval, TLS, broker persistence, Atlas access, kernel containment, install/uninstall, or production behavior. Live installation remains blocked on a separate exact R3 grant.

Rollback removes only these new repository packaging artifacts and restores the previously reviewed inert template.

## Independent review closure

- Reviewer: `/root/packet_matrix` (independent of the final builder lane)
- Verdict: `PASS_PACKAGING_CONTRACT_ONLY`; zero unresolved repository-packaging blockers
- Revalidation: packaging suite `12/12 PASS` twice; accepted WO024 worker compatibility suite `16/16 PASS`
- Safety: closed host snapshots, foreign path/unit/current-pointer collision refusal, ownership/preimage ledger, partial recovery, hash-gated rollback, foreign preservation, and empty-created-directory handling passed
- Integrity: packaging, tests, manifest, SBOM, broker/child and inert unit hashes matched; scoped diff validation passed
- Required remaining gate: exact R3 AEGIS authority plus live identities, credentials, TLS, systemd, cgroup, namespace, filesystem, Atlas broker, canary, rollback, and uninstall proof. This packaging substage does not complete WO-AEH-024.
