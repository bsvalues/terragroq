# WO-AEH-023 — Model-aware GPU admission

Status: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / SIMULATION_ONLY`.

The admission engine is a closed, versioned, deterministic projection. It binds the complete WO-AEH-021 job, claim, attempt, lease, effect-domain, idempotency, worker/instance/boot, fence/renewal, authority/capability, and immutable artifact digest set. The immutable measurement envelope—not the request—owns measured weights, runtime overhead, KV formula/version/digest, KV bytes per token, resource availability, temperature, queue, residency, confidence, observation time, and TTL. Model, runtime, measurement, snapshot, policy, and worker identities must agree exactly.

Results distinguish malformed, stale, future, conflicting, unmeasured, unsafe, or identity-mismatched `INPUT_REJECTED` inputs from valid but insufficient `REJECT` decisions. The engine derives and verifies canonical SHA-256 digests for the complete measurement and policy objects (excluding only their own digest fields), requires the derived policy digest to equal the WO-AEH-021 policy binding, then derives and verifies the complete closed admission input (excluding only its own digest). Historical snapshot and KV hashes are explicitly source-reference digests, not trusted content-integrity claims. A passing result is only `ADMIT_SIMULATION`; every result is `recommendationOnly`, `dispatchAllowed: false`, and `executionAuthorized: false`. Checked safe-integer arithmetic covers KV, context plus requested output, runtime, weights, and protected VRAM reserve. Reason codes are unique and sorted; input, measurement, policy, binding, and source digests are repeated into the canonical decision receipt.

Eight native behavioral and property tests pass twice. They cover exact and ±1 VRAM boundaries, monotonic reserve/context growth, sorted multi-reason rejection, strict UTC freshness and future rejection, model/runtime/KV identity mismatch, concurrency greater than one, closed fields, undefined/zero/NaN/overflow values, conflicting free/total VRAM, historical Hermes placement insufficiency, and concurrent evaluation of one immutable snapshot. A field-by-field mutation sweep covers every material binding, measurement, and policy field: stale supplied digests are rejected, while recomputed integrity digests produce a different decision receipt. Concurrent simulation results intentionally create no reservation; two requests may both estimate against the same snapshot and therefore cannot authorize dispatch.

Existing Hermes placement receipts historically establish only recommendation eligibility from short-lived snapshots. They do not supply a current measured model resource envelope, atomic resource reservation, or WO-AEH-021 lease/fence authority. No Hermes probe, model load, GPU execution, database, scheduler, service, network, dependency installation, live metric read, or issue #357 path occurred. Live empirical qualification remains WO-AEH-045; dynamic resource admission and reservation remain WO-AEH-026.

Rollback removes only the WO023 module, test, report, and evidence.

## Independent review closure

- Reviewer: `/root/packet_assurance` (independent of the final builder lane)
- Verdict: `PASS`; zero unresolved blocking findings
- Revalidation: native behavioral/property suite `8/8 PASS` twice
- Integrity: complete measurement, policy, WO021 binding, and root input are canonically digest-bound; stale mutations reject and fully resealed material changes alter the decision digest
- Safety: undefined/zero, NaN/overflow, identity, freshness, exact capacity boundary, and concurrency cases fail closed or remain explicitly non-authorizing simulation
- Integrity evidence: both recorded artifact hashes matched and scoped diff validation passed
- Evidence limit: no current Hermes measurement, resource reservation, model execution, dispatch authority, or live qualification is established.
