# WilliamOS Execution Fabric — AEGIS Bounded Adapter 001

Status: `ADAPTER_PACKET_READY / LIVE_LANE_NOT_ACTIVE`

Work order: `WO-EF-DISPATCH-AEGIS-ADAPTER-001`

Parent work order: `WO-EF-PLACEMENT-001` / GitHub issue #538

Target: `aegis`

Template: `aegis.hash-verify.v1`

## Implemented packet

The repository now contains an executable, local-only `HASH_VERIFY` core for a future resident AEGIS
host integration. The core accepts only one exact reviewed template and one exact file under the
template-owned staging root. It validates a fresh replayed placement receipt, canonical resident
identity, exact Agent Forge permission and template digests, a separately reviewed authority scope,
a one-use claim, and an exclusive single-concurrency lease before reading the file.

The input is opened without following links and is bound by real path, device, inode, timestamps,
exact byte length, and a 1 MiB ceiling. The adapter computes SHA-256 and emits deterministic bounded
evidence. It does not contain a network, SSH, GitHub, subprocess, arbitrary-shell, scheduler,
authority-mutation, registry-write, remote-dispatch, fallback, workload-write, or output-write
surface.

## Independent trust boundaries

Agent Forge scope is not execution authority. A future authority must be admitted separately, bind
the exact request and retained scope bytes, identify distinct producer and reviewer identities, and
prove that its review commit is strictly after the execution-scope commit on trusted `main`.

The resident host must inject trusted implementations for:

- pinned-placement semantic replay;
- canonical AEGIS machine identity;
- trusted-main Forge and authority proof;
- atomic one-use claim; and
- exclusive local lease acquisition and release.

The adapter rechecks identity, placement freshness, Forge bindings, authority bytes, and scope after
claim and lease acquisition. Any drift consumes the claim, releases an acquired lease once, and
fails before the workload read.

## Current production boundary

No live AEGIS execution is claimed. The production authority registry remains empty, current AEGIS
placement evidence is stale, and no supported resident connector currently supplies the required
trusted host dependencies. These are retained as typed operational state, not converted into owner
work and not bypassed through HERMES, SSH, GitHub, or caller self-attestation.

```text
AEGIS_ADAPTER_PACKET: READY_FOR_REVIEW
AEGIS_PROVIDER: UNAVAILABLE
AEGIS_PLACEMENT_EVIDENCE: STALE
AEGIS_DISPATCH_AUTHORITY: NOT_GRANTED
AEGIS_BOUNDED_DISPATCH_LANE: PENDING
SCHEDULER: OFF
AUTONOMOUS_DISPATCH: FALSE
```

## Validation

- Focused AEGIS adapter contract: 22/22 passed.
- Combined AEGIS, placement, producer, admission, outcome, authority, and trust suites: 134/134
  passed.
- Production authority entries: 0.
- Fabricated AEGIS observations: 0.

## Successor contract

A resident AEGIS/Claude session can consume the repository-owned work-order packet and adapter
README without William relaying instructions. It must first refresh canonical AEGIS capability
evidence and provide the supported trusted host integrations above. Only then may the normal
two-step reviewed-scope and future-dated activation sequence admit one exact attempt. GitHub retains
the packet, review, authority, and result evidence; it does not schedule or authorize the work.
