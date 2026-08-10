# WilliamOS Execution Fabric Shadow Placement Proof 001

Issue: #538
Phase: 2 — shadow placement observation
Phase 1 baseline: merge `794a665`

## Result boundary

This proof adds the contract and adversarial coverage for comparing an immutable Phase 1 placement
receipt with a separately recorded observation of where real work ran. It is observation-only.

It does not launch a workload, contact a node, acquire a lease, reserve capacity, mutate a remote
system, activate a scheduler, authorize execution, or silently redirect work. It also makes no claim
that the placement policy is calibrated. Calibration requires a reviewed body of representative
shadow observations and remains successor work under #538.

## Bound inputs

The evaluator accepts exactly:

```text
--receipt <Phase 1 result JSON>
--observation <shadow observation JSON>
--snapshot-root <Phase 0 snapshot store>
--verifier <frozen canonical verifier>
--python <approved Python interpreter>
--registry <exact Phase 1 registry base JSON>
--schema <exact Phase 1 registry schema JSON>
--policy <exact Phase 1 pinned-evidence policy JSON>
--workloads <exact Phase 1 workload catalog JSON>
```

The evaluator reruns the trusted Phase 1 recommendation function from these exact artifacts and
requires the replayed output to match the supplied receipt exactly. That replay authenticates the
recommendation, candidate ranks, evidence set, full workload, decision-input digest, and artifact
digests together. Its only subprocess is the contract-pinned canonical snapshot verifier; it never
starts a workload or contacts a node.

The observation uses schema `0.1-shadow-placement-observation` and binds the exact receipt bytes by
SHA-256. Its `actual_target` is either `RECORDED` with an identified node and outcome reference, or
`NOT_RUN` with no invented execution. Its divergence is explicitly `MATCH`, `DIVERGED`, or
`NOT_COMPARABLE` with a reason and explanation appropriate to that state.

## Fail-closed invariants

- Only a recommendation-only Phase 1 receipt with scheduler `disabled / not-granted` is accepted.
- The receipt and observation digest must match exactly.
- A target mismatch requires an explicit explained divergence; it is never fallback.
- A target marked ineligible by authority or stale evidence cannot be normalized into an acceptable
  shadow result.
- An otherwise eligible target is rejected when the observation time reaches or exceeds its pinned
  evidence expiry.
- Executable, credential-like, and secret-like input fields are rejected.
- Malformed, tampered, dispatch-enabled, or execution-authorized receipts are rejected.
- Rehashed receipts cannot conceal root-level authority mutation, remote modification, verifier
  failure, malformed verifier identity, stale eligible candidates, contradictory authority reasons,
  or inconsistent/duplicate ranks.
- Verifier contract and implementation identity, the exact required evidence-node set, and observed
  or proven confidence with fresh eligibility remain mandatory after receipt rehashing.
- The shadow evaluator freezes the Phase 1 verifier digest and authenticates the complete
  recommendation by exact replay from its pinned snapshots and input artifacts. A coherently
  rewritten recommendation or rank order therefore fails even when its receipt bytes are rehashed.
- Secret-like values are rejected even when placed inside otherwise permitted text fields, and
  rejected result serialization does not reflect those values.
- Every outcome preserves `shadow_only=true`, `dispatch_allowed=false`,
  `execution_authorized=false`, and `remote_systems_modified=false`.

## Adversarial verification

`tests/execution-fabric-shadow-placement.test.ts` covers:

1. deterministic replay from identical receipt and observation bytes;
2. matching target observation;
3. explained divergence to another eligible node;
4. workload not run / not comparable;
5. receipt digest mismatch and post-observation tampering;
6. malformed, rejected, no-eligible-node, dispatch-enabled, and execution-authorized receipts;
7. mismatch without explanation;
8. authority-ineligible and stale actual targets;
9. executable, credential-like, and secret-like fields; and
10. rehashed receipt shape tampering;
11. root authority/mutation claims, verifier failure, stale eligibility, authority contradictions,
    and rank inconsistency after receipt rehashing; and
12. GitHub-token-like, private-key-like, and credentialed-database values without result leakage; and
13. fictitious verifier identity, empty/duplicate/wrong evidence-node sets, and declared,
    insufficient, or missing confidence at root and eligible-candidate levels; and
14. verifier-digest replacement plus snapshot, workload, policy, time, and artifact mutation against
    the original Phase 1 decision-input digest, including a forged digest paired with a wrong verifier;
    and
15. workload-catalog byte tampering, receipt/catalog summary mismatch, and missing catalog input.
16. coherently rewritten recommendation/rank output rejected by exact trusted Phase 1 replay; and
17. observations at or after the selected target's evidence expiry rejected as stale.
18. both directions of the `MATCH` if-and-only-if actual-target equality invariant.

## Interpretation

`SHADOW_MATCH` means only that one observation matched one pinned recommendation.
`SHADOW_DIVERGENCE` means an allowed, explicit comparison was recorded for review.
`SHADOW_NOT_RUN` means there was no real execution to compare.
`INPUT_REJECTED` means the comparison could not be trusted.

Every result carries `shadow_result_sha256`: SHA-256 over the canonical JSON result object with the
`shadow_result_sha256` field itself omitted from the preimage.

None of these states grants launch authority. The progression remains recommendation → shadow proof
→ bounded dispatch under separate authority → recovery → intelligence routing.

## Integration verification

After rebasing onto the AEGIS capability-evidence integration from PR #540, the pinned-evidence
adapter was updated to project verified capability-local health into the v0.2 registry. The projected
axis preserves the snapshot observation time, policy TTL, snapshot SHA-256, and durable evidence
reference. This closes the compatibility seam without changing node authority or relaxing freshness.

The complete Execution Fabric integration family passes: 5 files, 248 tests. The focused shadow
suite passes: 1 file, 27 tests.
