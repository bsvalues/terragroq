# AEGIS bounded HASH_VERIFY adapter

`aegis-hash-verify.mjs` is a non-active, local-only Phase 3 adapter packet. Its reviewed template is
`ADAPTER_PACKET_NOT_ACTIVE`. Production remains blocked
while `aegis-bounded-dispatch-authority-registry.json` has no exact active entry. Preparation requires
the exact reviewed template, Agent Forge permission, AEGIS identity, Work Order, fresh pinned receipt,
trusted-main Forge proof, canonical resident identity, and trusted-main authority proof.

The repository packet is the exact execution Work Order `WO-EF-DISPATCH-AEGIS-001`. The checked-in
packet remains `NOT_GRANTED`. A future single-use attempt must update that authenticated packet to
`GRANTED`, bind its sole `authorityGrantRefs` entry to the exact request, and retain a separately
reviewed scope with `authority_status=GRANTED` and `REVIEWED_ACTIVE_SINGLE_USE_SCOPE` for the same
Work Order. An active registry entry cannot override a denied or differently bound Work Order.

The only workload operation is a descriptor-bounded SHA-256 read of one exact regular file beneath
the template-owned repository root `docs/reports/bounded-dispatch/aegis-inputs`. Callers cannot
replace that root. Absolute paths, traversal, links/junctions, changed files, and inputs
over 1 MiB fail closed. The operation returns canonical evidence only. It contains no network, SSH,
GitHub, subprocess, arbitrary-shell, scheduler, registry-write, authority-write, remote-dispatch,
fallback, or output-storage surface.

Activation additionally requires injected atomic one-use claim and exclusive resident-AEGIS lease
providers. Those providers govern runtime-control state outside this read-only workload adapter; the
adapter itself performs no claim/lease filesystem writes. Identity and all trust inputs are rechecked
after the claim and before the file descriptor is opened.
The request is snapshotted before claim acquisition and checked again immediately before opening the
input. The staging-root real path and directory identity are revalidated after file-descriptor
acquisition and before any workload bytes are read.

Future authority must retain a separately reviewed scope artifact under
`config/execution-fabric/aegis-bounded-dispatch-authority-scopes/`. The registry entry and trusted-main
proof bind its exact bytes, request scope, staging-root ID, expected digest and length, byte/timeout
ceilings, Forge registries, reviewed identity, one-attempt limit, and prohibited actions.

There is intentionally no resident CLI wrapper yet. A safe wrapper still needs supported host
implementations for trusted pinned-placement replay, trusted-main Forge/authority proof, atomic
single-use claim, and exclusive local lease. The packet does not replace those trust providers with
self-attestation, Git, network access, or owner-carried evidence. Until that integration exists and a
future authority entry is separately reviewed, the exact terminal production state is
`BLOCKED_AUTHORITY / AUTHORITY_NOT_ADMITTED` at the Work Order and when this adapter evaluates the
empty registry. Resident-provider availability is a separate prerequisite and cannot substitute for
authority.
