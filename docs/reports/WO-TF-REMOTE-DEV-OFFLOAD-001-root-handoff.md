# WO-TF-REMOTE-DEV-OFFLOAD-001 root prerequisite handoff

## Result

`AEGIS_REMOTE_DEV_ROOT_HANDOFF: READY_FOR_REVIEW`

This generation supplies the fixed root-owned verifier, Linux OS adapter,
single-use transaction protocol, reviewed assets, and activation-side receipt
consumer for the issue 734 remote-development proof. It does not bootstrap its
own trust, contain credentials, authorize dispatch, or mutate a live node.

The first verifier/public-key installation is deliberately an out-of-band root
trust event. An authorized server lane must copy the exact reviewed bytes,
independently compare the owner-pinned digests, and pre-create the root-only
evidence/claim/journal/staging directories. Repository code cannot create that
initial trust root and never reports that it did.

## Exact package boundary

- trusted control-plane generation: `bcca6069a917d706314f7c8cb7b3cd40cdd910da`
- target node: Linux host `aegis`, exact reviewed machine-id SHA-256
- proof: `WO-TF-REMOTE-DEV-OFFLOAD-001`, TerraFusion issue `#734`
- storage: verify-only loopback XFS UUID
  `5744648d-9289-4d4e-ac6a-707e8405a5d6`, project `734`, hard limit
  `85899345920` bytes
- scheduler: disabled
- standing AEGIS authority: false
- Atlas access: denied
- closed `WO-EF-DISPATCH-AEGIS-001` HASH authority/evidence: immutable and
  never reused

The root manifest is the canonical v2 semantic supersession of the earlier
non-applying preflight manifest. It binds every installed asset by raw SHA-256, destination,
owner, group, and mode. The verifier separately pins the prerequisite manifest,
closed HASH evidence, inactive scope, canonical AEGIS identity, and fresh
`origin/main` equality with Git replace objects/configuration disabled.

## Transaction and failure model

The fixed CLI accepts one exact GUID authority path. The root verifier uses a
root-owned Ed25519 owner key, trusted OS clock, 15-minute authority window,
canonical JSON, and one durable `O_EXCL` claim consumed immediately before the
first mutation. The journal is hash chained, fsynced, and records authority
consumption plus step intent/applied, post-apply verification, and commit.

A crash can resume only the same transaction and claim. A terminal failure
consumes the authority permanently, leaves the proof inactive, and publishes no
success receipt. The canonical prerequisite receipt is published with
`O_EXCL` only after post-apply verification and durable commit. That receipt is
explicitly non-authorizing; activation also requires the exact trusted-main
files, resident identity/no-sudo proof, fresh per-run network proof, durable
claim/lease/release/replay evidence, and a valid single-use activation.

## Reviewed mutation set after external bootstrap

The signed owner authority may perform only these ordered operations:

1. reconcile locked non-root/no-sudo `williamos-fabric` and the non-login
   egress-broker identity;
2. install the exact root-owned launcher, provider, worker, broker, nftables,
   systemd, SSH, tmpfiles, and .NET wrapper assets;
3. generate or adopt the exact root-owned Ed25519 launch key;
4. establish worker direct-egress denial with a loopback HTTP CONNECT broker;
   every CONNECT must carry the signed launch ticket and exact operation, and
   the operation-to-host map permits only its reviewed Git or NuGet endpoint;
   Atlas, mapped-private IPv6, private/link-local destinations, and all other
   IPv4/IPv6 egress are denied;
5. install exact root-only GitHub host/account trust used for root repository
   reconciliation, plus a fixed systemd socket broker that receives the key as
   a service credential only for signed preflight/clone/fetch/push operations;
   worker and build processes cannot read the private key;
6. reconcile the root-owned, clean, remote-equal control checkout at
   `/var/lib/williamos-remote-dev/control/terragroq` and TerraFusion mirror at
   `/var/lib/williamos-remote-dev/repositories/terrafusion_os_1.0.git` without
   resetting dirty or worker-writable state; the separate preserved standing
   runtime checkout beneath `/var/lib/williamos/fabric` is never adopted,
   moved, chowned, or modified;
7. prove exact signed Git/Node/Corepack/pnpm binaries and install only the exact
   staged .NET SDK 8.0.423 archive when absent;
8. create the separate durable worker ledger and root-owned append-only launch
   ticket boundary;
9. install the source-restricted forced-command transport last.

Storage creation, formatting, mounting, remounting, quota mutation, workspace
creation, dispatch, live Git push, PR creation, Atlas access, Hermes changes, Forge,
backup disks, and closed HASH evidence are not root-handoff mutations.

## Inputs still required before live apply

Safe live apply remains blocked until all of the following exist as exact
root-owned inputs and are bound into one signed owner authority:

- externally installed verifier, adapter, CLI, manifest/bundle, owner public
  key, and append-only evidence/claim/journal roots with independently checked
  digests;
- the concrete Hermes forced-command public key and fingerprint;
- the concrete GitHub account public/private keypair, repository permissions,
  and exact `ssh.github.com:443` known-host bytes/fingerprint;
- exact preinstalled Git, Node, Corepack, and pnpm binary digests plus the exact
  staged .NET 8.0.423 archive digest/provenance;
- one canonical, signed, unconsumed 15-minute authority bound to the current
  AEGIS boot ID and this exact package generation.

No placeholder credential, fingerprint, package digest, or authority is
accepted. Missing or drifted input blocks before the durable claim and before
any package mutation.

The root handoff does not create the run-specific 30-second network receipt or
activate the expired proof authority. Those remain a separate, future
trusted-main activation step after prerequisite success; until then execution
remains disabled.

## Rollback

Rollback is not automatic. It requires a separate signed authority bound to
the transaction journal and may restore only an item whose current digest still
equals the digest installed by this transaction. Storage, signing keys, ticket
tombstones, ledger, and evidence are preserved. Rollback never deletes,
reformats, unmounts, reopens worker egress, or modifies Atlas/Hermes/Forge/HASH
state.

## Validation

- focused root handoff: 10 passed
- activation prerequisite receipt boundary: 24 passed
- surrounding trust/network/controller/contract regressions: 138 passed,
  27 intentionally dormant activation tests skipped
- two unchanged trusted-base test modules retain the known Windows Vitest
  import-only `SyntaxError`; direct Node syntax is green and the exact LF/Linux
  suite is required before merge
- independent exact-head security review: pending
