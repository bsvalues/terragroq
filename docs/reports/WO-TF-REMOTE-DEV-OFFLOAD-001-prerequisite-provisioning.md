# WO-TF-REMOTE-DEV-OFFLOAD-001 AEGIS prerequisite provisioning package

## Result

`AEGIS_REMOTE_DEV_PREREQUISITE_PACKAGE: READY_FOR_REVIEW`

This is a fail-closed preflight and dry-run package. It does not authorize or
perform live AEGIS provisioning. `executionAuthorized` and `applyAuthorized`
remain false even when a proposed owner authority object is internally
consistent. A separate exact live-apply handoff is required.

No AEGIS, Hermes, Atlas, GitHub, closed HASH scope, receipt, ledger, or runtime
evidence was changed while producing this package.

## Trusted baseline

- control plane: `bsvalues/terragroq` `refs/heads/main`
- trusted package base: `fea7785fd480d3b5f107c286cc8eb1bac6d04793`
- proof: `WO-TF-REMOTE-DEV-OFFLOAD-001`, TerraFusion issue `#734`
- TerraFusion proof base: `ffd2fa35f5152de2b95e7f63b220050d18193d7a`
- activation posture: `INACTIVE_PENDING_PREREQUISITES`
- general scheduler: disabled
- standing AEGIS authority: disabled

The package manifest JCS SHA-256 is
`51410d9fe7781ccd3e707fa60a2f985cc7abfad7782d1cfa710a5be3a3031034`.
It is recorded by the trusted planner constant and recomputed in the test
evidence for this correction.
The trusted planner pins that complete manifest digest. The manifest binds the
activation, worker, network provider, network launcher, network policy,
installer gate, and forced-command entrypoint. This is internal consistency,
not a trust root: the currently executing planner cannot authenticate itself.
The truthful state is always `PACKAGE_INTERNAL_CONSISTENCY_ONLY` with
`EXTERNAL_TRUST_ROOT_REQUIRED`. A future root-owned handoff must independently
pin the exact reviewed planner, manifest, and seven artifact bytes before any
live preflight or apply. This package itself can never return an authoritative
trusted-main or apply success state.

## Reserved paths

These paths were declared before editing:

- `config/execution-fabric/aegis-remote-dev-prerequisites.json`
- `scripts/execution-fabric/provision/aegis-remote-dev-prerequisites.mjs`
- `scripts/execution-fabric/provision/aegis-remote-dev-prerequisites.sh`
- `scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs`
- `tests/execution-fabric-aegis-remote-dev-prerequisites.test.ts`
- `docs/reports/WO-TF-REMOTE-DEV-OFFLOAD-001-prerequisite-provisioning.md`
- `scripts/execution-fabric/live/aegis-remote-dev-worker.sh`
- `tests/execution-fabric-remote-dev-offload-worker.test.ts`
- `config/execution-fabric/remote-dev-offload-v1-inactive-scope.json`
- `config/execution-fabric/remote-dev-offload-v1.policy.json`
- `scripts/execution-fabric/live/invoke-remote-dev-offload.ps1`
- `config/execution-fabric/remote-dev-offload-v1-activation.json`

## Accepted read-only audit gaps

The package is designed to close, without concealing, these previously audited
facts:

1. `williamos-fabric` exists but does not yet have a usable bounded transport;
   the existing `bs` administrator path is not an authorized worker path.
2. the resident `terragroq` checkout is stale and a trusted TerraFusion mirror
   is absent.
3. the exact Node, .NET SDK, Corepack, and pnpm toolchain is incomplete.
4. workspace storage was the existing ext4 root filesystem and required a
   bounded mechanism compatible with the worker's exact 80 GiB ceiling. This
   gap is now closed by the verified loopback-XFS evidence below.
5. dual-stack default-deny egress, broker enforcement, and Atlas denial are not
   proven.
6. `ssh.github.com:443` host trust and the dedicated account authentication
   boundary are not proven.
7. the root signing authority, root-attested network slice/receipt, trusted
   launcher installation, append-only ticket directory, and durable evidence
   ledger are not provisioned as one reviewed generation.

## Exact dry-run decisions

The planner consumes one complete read-only observation and returns only one of
these states:

- `READY`: every exact prerequisite already matches; no mutation is planned and
  execution remains unauthorized.
- `DRY_RUN_REQUIRED`: absent state is mapped to a deterministic mutation list;
  apply and execution remain unauthorized.
- `BLOCKED / PREFLIGHT_EVIDENCE_INCOMPLETE`: evidence is incomplete.
- `BLOCKED / PREREQUISITE_DRIFT`: existing state differs; overwrite is refused.
- `BLOCKED / PACKAGE_BINDING_DRIFT`: a reviewed package/runtime byte differs.

The bounded SSH entrypoint accepts only the existing fixed launcher path, the
eleven reviewed operation names, canonical standard-base64 arguments, the
controller's exact single-quoted patch argument, attempts 1-3, and `null` or an
exact SHA-256 predecessor. It never evaluates a command
string and rejects a shell, metacharacter suffix, newline, unknown operation,
or malformed replay binding.

## Exact live mutations still requiring owner authorization

No item below is authorized by this package. A later handoff must bind all
inputs to one immutable package generation and consume that authority before
the first mutation.

1. **Identity**: create or reconcile locked non-root account
   `williamos-fabric`, prove no sudo capability, set `/bin/bash` only for the
   forced-command SSH mechanism, and enable its user manager. Existing `bs`
   administrator access is preserved but must not be used by worker dispatch.
2. **Bounded transport**: install one owner-approved Hermes public key at
   `/home/williamos-fabric/.ssh/authorized_keys` with `restrict`, no PTY,
   forwarding, agent, X11, or password access, source `192.168.1.154`, and the
   fixed `/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs`
   forced command. The exact key fingerprint is an owner input.
3. **Trusted repositories**: reconcile
   `/var/lib/williamos/fabric/workspaces/terragroq` to clean remote-equal commit
   `d5e725e47dc32f8ea113d0a0168e956bac84659e`; create root-reviewed bare mirror
   `/var/lib/williamos/fabric/repositories/terrafusion_os_1.0.git` and prove
   commit `ffd2fa35f5152de2b95e7f63b220050d18193d7a` exists. Drift or local work
   blocks; it is never reset away.
4. **Toolchain**: install fixed paths and versions: Git `2.43.0`, Node
   `22.18.0`, .NET SDK `8.0.423`, Corepack `0.34.0`, and pnpm `9.0.0`.
   Package/archive hashes and provenance must be attached to the live authority
   before installation.
5. **Workspace storage — already completed and not an apply mutation**: the
   bounded mechanism is `LOOPBACK_XFS_PROJECT_QUOTA_V1`, backed by the existing
   AEGIS ext4 root at
   `/var/lib/williamos/fabric/aegis-remote-dev-workspaces.xfs`. The image is
   exactly `107374182400` bytes, `root:root`, mode `0600`; it is attached as
   observed `/dev/loop0` and mounted at `/srv/william` as XFS UUID
   `5744648d-9289-4d4e-ac6a-707e8405a5d6`, label `AEGIS_RDEV`, with
   `rw,nosuid,nodev,prjquota,exec`. `/srv/william/workspaces` is
   `williamos-fabric`, mode `0700`. Project `734` has inherit flag `P`, quota
   accounting/enforcement are ON, and the numeric project report proves hard
   limit `83886080` KiB (`85899345920` bytes). Observed workspace free space was
   `85899345920` bytes. No external disk or backup storage is used. No further
   format, mount, remount, or workspace creation is authorized by this correction.
6. **Network**: install a root-owned broker/enforcement generation for the exact
   worker cgroup; default-deny IPv4 and IPv6; deny Atlas
   `192.168.1.156/32` and its IPv4-mapped IPv6 address on all ports; permit only
   `ssh.github.com:443`, `api.github.com:443`, `api.nuget.org:443`, and
   `globalcdn.nuget.org:443` for their declared operations. Direct worker
   egress remains denied. Live DNS/IP generation, nftables bytes, broker bytes,
   cgroup identity, and ruleset digest must be root-attested before activation.
7. **GitHub boundary**: install root-reviewed `ssh.github.com:443` host trust,
   strict checking and batch mode, one owner-approved account key, and repository
   allowlist `bsvalues/terragroq` plus `bsvalues/terrafusion_os_1.0`. No GitHub
   mutation is part of prerequisite apply; push/PR remains the future proof run.
8. **Root launch assets**: generate or adopt one root-owned Ed25519 launch
   authority without exposing its private key; install the exact trusted-main
   launcher/provider/worker, network slice and root receipt writer; create
   `/var/lib/williamos-fabric/remote-dev-launch-tickets` as root-owned group
   `williamos-fabric`, mode `3770`, append-only. Existing key or byte drift
   blocks instead of replacement.
9. **Durable ledger**: create
   `/var/lib/williamos-fabric/remote-dev-ledger`, root-owned, group
   `williamos-fabric`, mode `2750`, on durable storage with atomic publication
   and append-only evidence. It is separate from and does not read, reuse,
   consume, or modify closed `WO-EF-DISPATCH-AEGIS-001` HASH evidence.

## Owner inputs required for a future live handoff

- storage owner input: closed by the exact loopback-XFS evidence above
- exact Hermes bounded-transport public-key fingerprint
- exact GitHub account public-key fingerprint and repository permissions
- exact package/archive hashes and source for the pinned toolchain
- authorization to create/adopt the root launch signing key
- authorization to add proof-specific systemd, broker, nftables, SSH, quota,
  and ledger configuration
- exact future window and single-use authority receipt for one provisioning run

## Exact rollback plan

Rollback is never automatic and requires an authority bound to the mutation
journal from the live apply.

1. disable new proof dispatch;
2. stop only proof-specific units after proving no proof process is active;
3. remove only the exact proof-specific egress generation;
4. disable only the dedicated forced-command key;
5. restore only files recorded as package-managed in the mutation journal;
6. prove no proof process, lease, or transient service remains;
7. retain the signing key, ticket tombstones, workspace data, and durable ledger
   for owner review.

Rollback never deletes or reformats the loopback image, unmounts storage, deletes workspaces, removes evidence, reopens
direct egress, restores `bs` as a worker transport, or changes AEGIS's general
administrator posture.

## Test evidence

- RED 1: missing provisioning module prevented the new suite from loading.
- GREEN 1: 10 focused prerequisite tests passed.
- RED 2: an internally consistent caller-supplied authority incorrectly
  returned `applyAuthorized: true`.
- GREEN 2: even an exact proposed authority now returns
  `LIVE_APPLY_OWNER_HANDOFF_REQUIRED`, `applyAuthorized: false`, and
  `executionAuthorized: false`.
- package inspection: seven internal artifact digests exact and manifest digest
  exact, but status remains `PACKAGE_INTERNAL_CONSISTENCY_ONLY` /
  `EXTERNAL_TRUST_ROOT_REQUIRED` with exit 2. A separate previously trusted,
  root-owned verifier must pin this exact generation; the package never
  self-promotes to trusted or applicable.

No live preflight was claimed. The accepted audit says the current node is not
ready for dispatch because non-storage prerequisites remain. Storage itself was
independently completed and is represented here as verified existing state, not
as a proposed external disk or another mutation. Activation stays inactive until
the remaining prerequisites and their root-owned evidence are independently reviewed.
