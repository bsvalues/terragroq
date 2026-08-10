# Execution Fabric bounded dispatch-contract proof

Issue: `#535`
Work Order: `WO-FABRIC-DISPATCH-CONTRACT-001`
Mode: `STATIC_NON_CONSUMABLE`

## Purpose

Define and mechanically prove the exact gates between an evidence-backed placement recommendation
and one bounded job. The evaluator is a pure readiness projection. It never returns an instruction,
acquires a queue item, creates a live reservation or lease, invokes a worker, contacts a node, grants
authority, or enables the scheduler.

## Canonical composition

The packet embeds and validates the repository's existing v2 multi-agent dispatch envelope and v1
reservation-set contract. It then binds their normalized scope to the Fabric-specific recommendation,
resource envelope, non-consumable authority fixture, simulated reservation receipt, simulated
lease/checkpoint fence, recovery budget, and completion evidence contract.

The proof deliberately does not import the stateful reservation ledger, lease store, authority-event
store, or evidence ledger as runtime engines. A later live implementation must use those canonical
stores atomically and under separate authority. This proof reuses their vocabulary and invariants
without creating or mutating their records.

## Exact packet

`schema_version` is `0.1-dispatch-contract-proof`; `proof_mode` is
`STATIC_NON_CONSUMABLE`. Unknown fields fail closed. The exact sections are:

- `recommendation`: the canonical artifact emitted by `recommend-placement.mjs`, including exact
  snapshot/workload digests, ranked selected node, evidence freshness, scheduler walls, and the
  existing `execution_authorized=false` and `dispatch_allowed=false` walls.
- `dispatch_envelope`: canonical v2 program/goal/loop/Work Order, repository/base, roles, reservations,
  actions, bounded retries, review, evidence, and owner-operation contract.
- `reservation_set`: canonical v1 normalized path/contract/environment reservation set.
- `workload_envelope`: exact job/Work Order/repository/base/node/path/contract/environment/action scope, R1 ceiling, finite
  CPU/RAM/scratch/time/attempt limits, data/storage/network classifications, and prohibited actions.
- `authority`: versioned, expiring, revocable, single-use `proof-fixture` bound to the exact authority
  tuple and finite resource/attempt/time ceilings. It is evidence for contract evaluation and is not
  a live grant.
- `reservation`: one simulated acquisition with zero conflicts, exact holder/node/repository/paths,
  version, and validity window.
- `lease` and `checkpoint`: one simulated holder, reservation, lease ID, generation, monotonic fencing
  token, state, chronology, and evidence digest.
- `recovery`: bounded attempts, explicit retryable/terminal classes, expiry-before-reclaim rule, and a
  strictly greater next fencing token.
- `completion`: complete required-evidence field list and either a pending pre-dispatch claim or an
  exactly-once completion claim bound to the final checkpoint, retained ledger anchor, source-reference
  digest, and a host-resolved independently trusted manifest digest.
- `safety`: scheduler `disabled / not-granted`; dispatch, execution, remote mutation, and authority
  mutation all false.
- `bindings`: canonical SHA-256 digests over every constituent section.

Executable command/shell/endpoint fields and secret-like material are rejected before readiness is
projected. Git commits use their canonical 40-character SHA; evidence and content bindings use
SHA-256.

## Decisions

- `INPUT_REJECTED`: malformed, unknown, secret-bearing, executable, canonically invalid, or ambiguous
  input. No contract identity is projected.
- `CONTRACT_BLOCKED`: structurally valid input with one or more unsatisfied semantic gates. Every
  blocker includes stable code, required value, observed value, and evidence references.
- `CONTRACT_READY`: every static gate passes. This means the non-consumable packet is internally
  ready for a future separately authorized acquisition protocol; it does not authorize that protocol.

Every result contains:

```text
proof_mode=STATIC_NON_CONSUMABLE
recommendation_only=true
contract_proof_only=true
execution_authorized=false
dispatch_allowed=false
authority_mutated=false
remote_systems_modified=false
```

## Cross-binding and failure invariants

The selected node, Work Order, repository, base ref and commit, program/goal/loop authority tuple,
grant/status-event references, actions, and path/contract/environment reservations must agree across
all records. Repository and protected-resource reservation collections must remain empty. Placement
readiness requires a host-injected verifier bound to the exact artifact, snapshot, and workload
digests; packet input and the CLI cannot create that trust. Resource requirements must remain under
the authority ceiling and selected-node CPU evidence. Prohibited actions must be explicitly
denied and absent from both workload and authority allow sets. Authority must be unexpired,
non-revoked, single-use, and unused at pre-dispatch. Authority issuance, reservation acquisition,
lease issuance, and checkpoint recording must occur in dependency order. Reservation acquisition must be exactly once and
collision-free. Lease, reservation, checkpoint, and recovery must share the same holder and current
fence. Recovery can advance only to a greater fence within the finite attempt budget.

A completion claim requires a released simulated lease, a positive `COMPLETE` checkpoint, authority
consumption exactly once, every required output, and one recomputed evidence digest shared by the
completion and checkpoint records. Issuance, consumption, checkpoint, release, claim, and evaluation
must be strictly ordered inside the validity windows. Packet-local evidence cannot attest itself: the
host integration must resolve the exact trusted retained-evidence manifest through a verifier that
packet input and the CLI cannot override. Missing output, status-only
completion, second consumption, stale fence, changed binding, chronology drift, untrusted evidence,
or incomplete release blocks the claim.

Negative vectors cover stale placement, independently rebound contradictory canonical records,
expired/revoked authority, duplicate or conflicting acquisition, lease loss, fence mismatch, unsafe
reclaim, replay, recovery-class conflict, binding tamper, executable/secret input, invalid chronology,
unattested evidence, incomplete evidence, and false completion.

## Representative vector

The positive fixture describes a bounded CPU-heavy scratch build whose placement recommendation is
AEGIS. `CONTRACT_READY` is permitted because every static gate is present. AEGIS remains without live
compute, storage, NAS, or backup authority; no job is sent to it.

## Non-authority boundary

Scheduler activation, autonomous scheduling, dispatch, command execution, live queue/reservation/
lease mutation, node authority, remote writes, TerraFusion/Property Workbench/TerraPilot/county/PACS
scope, protected data, production mutation, paid overages, destructive action, secrets, and reuse of
issue `#357` remain prohibited.
