# Resident Hermes shadow producer

`resident-shadow-producer.mjs` is the observation-only producer adapter for
`WO-EF-SHADOW-001`. The resident session must call it in this order:

1. `preflightResidentShadowProducer` validates the exact digest-bound pinned-placement receipt
   before invoking any injected provider. It then reads `trustedResidentIdentity()` and accepts only
   `{node_id:"hermes-node", producer_lane:"resident-hermes"}`. `trustedClock()` supplies the
   preflight instant. The adapter loads the fixed repository authority registry; callers cannot pass
   authority. `trustedAuthorityProof(input)` must return this exact proof of the bytes and entry:

   ```json
   {
     "schema_version": "0.1-trusted-shadow-authority-proof",
     "trusted_ref": "refs/heads/main",
     "registry_sha256": "<input registrySha256>",
     "authority_reference": "<input authority.reference>",
     "authority_reviewed_commit": "<input authority.reviewed_commit>",
     "exact_entry_count": 1
   }
   ```

   Missing or forged proof, mutable-only authority, inactive authority, an ineligible node, or a
   preflight at/after receipt freshness expiry fails before facts are read. Success is
   `PREFLIGHT_PASSED` with `preflight_sha256`.
2. After genuine, separately authorized resident execution, `captureResidentShadowOutcome` invokes
   `readTrustedProducerFacts(binding)`. The reader must return every field below; none is defaulted:

   ```json
   {
     "schema_version": "0.1-resident-shadow-producer-facts",
     "preflight_sha256": "<exact preflight digest>",
     "receipt_sha256": "<exact receipt digest>",
     "work_order_id": "WO-EF-SHADOW-001",
     "resident_node_id": "hermes-node",
     "producer_lane": "resident-hermes",
     "started_at": "<UTC milliseconds>",
     "completed_at": "<UTC milliseconds>",
     "authority_checked_at": "<must equal started_at>",
     "authority_reference": "<exact reviewed reference>",
     "authority_status": "COMPLIANT",
     "status": "COMPLETED|FAILED|BLOCKED|CANCELLED",
     "result": "SUCCEEDED|FAILED|BLOCKED|CANCELLED",
     "resource_observations": [
       {
         "metric": "cpu_load_pct",
         "observed_at": "<UTC milliseconds within the outcome>",
         "unit": "percent",
         "value": 32
       }
     ]
   }
   ```

   The status/result pair must match. Start must follow preflight and precede receipt freshness
   expiry; authority must cover check/start/completion. Success is `GENUINE_FACTS_CAPTURED` with
   exact canonical outcome bytes and a deterministic delivery record. The adapter derives latency
   only.
3. `materializeResidentShadowEvidence` revalidates capture semantics and retains the exact receipt,
   deterministic delivery, and canonical outcome under realpath-confined `docs/reports` paths. It
   never overwrites different bytes. Commit those three artifacts as the execution commit. Retain a
   later independent review containing all four bindings:

   ```text
   WO-EF-SHADOW-001
   <full execution commit>
   REVIEWER: <identity distinct from resident-hermes>
   VERDICT: PASS
   ```

   `materializeResidentShadowCandidate` requires the exact execution commit, later review commit,
   reviewer identity, a fresh authority proof, and `proveReviewCommitOrder()` returning
   `{trusted_ref:"refs/heads/main", execution_commit, review_commit,
   execution_is_strict_ancestor:true}`. It emits canonical candidate bytes with separate
   `authority.reviewed_commit`, `execution_commit`, and `review_commit` fields and status
   `PENDING_REVIEWED_REGISTRY_ADMISSION`.

4. `compileReviewedResidentShadowCandidate` requires an injected trusted-main `reviewProof`; it
   delegates to the existing admission compiler. Only `READY_FOR_REVIEWED_REGISTRY_ADMISSION` is an
   admissible proposal. A separate reviewed repository change writes the proposed receipt, outcome,
   and authority entries to registries and then evaluates the observation. The producer never does.

The resident integration injects identity, clock, completed-fact reader, trusted-main authority
proof, commit-order proof, and final admission proof. No CLI argument or candidate field can replace
those trust seams. The adapter contains no job launcher, scheduler, dispatch, registry write,
Git/GitHub operation, shell execution, or remote-access surface. Terminal rejection is
`FABRIC_RESIDENT_SHADOW_PRODUCER_INVALID`; missing genuine facts stay pending and are never invented.
