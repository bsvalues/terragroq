# WilliamOS Execution Fabric pinned placement proof

**Work Order:** `WO-EF-PLACEMENT-001` / GitHub issue `#538`

**Phase:** 1 — deterministic recommendation only

**Scheduler:** OFF

## Outcome

The placement engine now consumes immutable capability snapshots rather than mutable producer feeds.
Before any recommendation logic runs, the engine invokes the producer-owned
`verify_snapshot.py` implementation of `CANONICALIZATION CONTRACT v1`, checks the exact required node
set, and loads only `snapshots/<node>/<snapshot_sha256>.json`.
The freshness policy pins the verifier's exact SHA-256, preventing substitution with an arbitrary
script that simply reports success.
The same policy binds each node to its exact v1 feed schema. The engine stages the exact referenced
bytes into a private temporary snapshot set, runs the pinned verifier on that set, confirms the bytes
did not change during verification, performs exact per-schema structural validation, and makes the
decision from those same bytes.
The verifier itself is staged from the already-hashed bytes and executed from that staged path; the
interpreter name and exact three-snapshot success transcript are also validated.

The recommendation receipt records:

- sorted `evidence_snapshot[]` node/hash references;
- `placement_policy_version`;
- hashes of the registry base, registry schema, freshness policy, and workload catalog;
- the exact workload and explicit evaluation time through `decision_input_sha256`;
- authority and scheduler non-mutation assertions.

Identical verified snapshots, workload, policy artifacts, and evaluation time produce identical
recommendations and decision-input hashes. Reference order does not affect the result.

## Live HERMES proof

The Phase 1 CLI invoked `C:\HermesLab\tools\verify_snapshot.py` against the immutable snapshot store
created by HermesLab commit `6f5ddb8`. Verification passed for all three feeds:

| Node | Snapshot SHA-256 |
|---|---|
| `aegis` | `77fc4cbc56702ea60a56c361e974e19f617d1845d03bbfb9c3bbb4c453fadfdd` |
| `atlas` | `1b49650dc3cfa73714dbca7a1f05e800124abb5f90c967e27d52e930b80ef62d` |
| `hermes-node` | `aa9b51c4f9225a0a69aab2611ef8c6132a9c1174ae626a71fa9c3d228451409e` |

At evaluation time `2026-08-10T10:30:00.000Z`, the policy correctly returned
`NO_ELIGIBLE_NODE`: every pinned live feed was older than the explicit 300-second freshness window,
OMEN remained declared/unpinned, and Azure remained declared/unavailable. This is a successful
fail-closed proof, not a placement failure. A new producer observation must mint a new immutable
snapshot before Phase 1 may recommend that node as fresh.

## Failure boundaries proven

- Missing or duplicate node references reject the entire input.
- Renamed files and embedded-hash mismatches reject the entire input.
- Reference-verifier failure rejects the entire input.
- Unknown feed schemas or absent freshness policy reject the entire input.
- Cross-node schema substitution and canonically valid but incomplete feed objects reject the input.
- Positive and adversarial tests invoke the real RFC 8785 verifier; no exported verifier bypass exists.
- Any feed that does not retain `scheduler: OFF` rejects the entire input.
- Stale evidence makes the affected node ineligible.
- Capability-specific failure removes only the affected capability; it does not falsely fail the
  whole node or alter authority.
- Authority lists are inherited from the committed registry and checked for non-mutation.
- Every recommendation and candidate retains `execution_authorized: false` and
  `dispatch_allowed: false`.

## Explicit exclusions

This phase does not dispatch, acquire leases, reserve capacity, mutate a node, refresh a producer
feed, create a snapshot, grant AEGIS compute authority, grant storage/backup authority, enable cloud
spend, or activate the scheduler.
