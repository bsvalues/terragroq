# Owner-Operation Evidence Artifact Validator

## Purpose

This contract validates the proposed post-run evidence artifacts without placing the Owner in a per-run
signing or operating path. The standalone validator cannot prove that its file and pin inputs came from
independent stores, cannot certify a lifecycle state, and creates no dispatch, GitHub-write, merge,
release, or activation authority.

## Trust Model

The artifact protocol has three classes and two expectations that a future trusted host must source
independently:

1. A relatively static owner-signed `OWNER_TRUST_BUNDLE` authorizes assurance recorder and checkpoint
   keys by purpose, program, validity interval, and status. Its exact current content hash and owner-key
   fingerprint come from the existing external owner-controlled monotonic anchor.
2. An assurance-signed `OWNER_OPERATION_EVIDENCE` record binds a preregistered run ID and manifest,
   exact program/goal/loop/Work Order/decision/action context, terminal run state, complete observation
   boundaries, classification-policy hash, and the five counters, including
   `OWNER_ROUTINE_CONTACT_COUNT`.
3. An assurance-log-signed `OWNER_OPERATION_EVIDENCE_CHECKPOINT` chain commits each run ID exactly once
   to one evidence content hash. A separate external monotonic checkpoint anchor supplies the one
   authoritative latest log ID, sequence, and checkpoint hash.

The expected run manifest hash, run ID, context, source-log ID, and classification-policy hash must
eventually be read by the trusted host directly from the authoritative preregistered run registry. The
current CLI accepts paths for structural validation and therefore cannot establish that independence.

## Complete Observation

The evidence recorder is operationally separate from workers and coordinators. Its trust-bundle entry
has purpose `OWNER_OPERATION_ASSURANCE`. Evidence is eligible only when:

- `runState` is `COMPLETED`;
- `observation.complete` is true;
- start and end source-log hashes and sequences are present;
- observed event count equals the bounded sequence interval;
- the source-log ID and classification-policy hash match the preregistered run context;
- start, completion, recording, and checkpoint times are ordered;
- recorder and checkpoint keys were active, in-program, and purpose-restricted at signing time.

This static validator checks the signed completeness assertion and its immutable bindings. It does not
verify the source event chain or independently anchor the asserted end hash. The later assurance runtime
must make the source stream append-only and inaccessible to the observed worker, verify the complete
source chain through the authoritative run boundary, and source the current source-log head itself.

## Anti-Replay And Anti-Equivocation

The verifier consumes the complete checkpoint chain from sequence 1 through the independently anchored
head. It rejects broken links, forks, stale heads, duplicate checkpoint IDs, duplicate run IDs, mixed
logs, time reversal, missing commitments, and evidence-hash mismatches. The preregistered run UUID and
manifest hash prevent reuse for a later attempt with otherwise identical context.

## Validator Result Semantics

- Missing, malformed, unsigned, stale, forked, incomplete, or mismatched evidence fails with a typed
  `OWNER_OPERATION_EVIDENCE_*_WALL` and never produces lifecycle evidence.
- A structurally and cryptographically valid artifact set returns
  `EVIDENCE_ARTIFACTS_VALIDATED_NOT_CERTIFIED`, `certified: false`, and `authorityGranted: false`.
- Zero counters are reported as `ZERO_COUNTERS_UNVERIFIED`; nonzero counters as
  `NONZERO_COUNTERS_OBSERVED`. Neither result establishes an authoritative lifecycle state.
- Any nonzero counter, including `OWNER_ROUTINE_CONTACT_COUNT`, returns
  `FAIL_OWNER_BABYSITTING` immediately. Routine progress, confirmation, and status contact is not
  exempt from the zero-owner-operation requirement. This fail-closed result does not make zero
  counters certified; certification still requires independent trusted-host verification.
- A future trusted-host integration may emit `FAILED_OWNER_BABYSITTING` or
  `CERTIFIED_ZERO_OWNER_OPERATIONS` only after it independently sources all current anchors and expected
  run state and verifies the complete source-log chain.

Untrusted caller counters can deny local progression through the older non-certifying validation path,
but they cannot establish either authoritative failure or certification.

## CLI

`owner-operation-evidence-cli.mjs verify` is a verifier-only interface. The file paths below are
illustrative; the consuming coordinator is responsible for sourcing anchors and expected run state from
their independent stores.

```powershell
node scripts/multi-agent-operator/owner-operation-evidence-cli.mjs verify `
  --evidence C:\assurance\run-evidence.json `
  --checkpoints C:\assurance\checkpoint-chain.json `
  --checkpoint-anchor C:\independent-anchor\assurance-head.json `
  --expected-run C:\run-registry\expected-run.json `
  --trusted-owners C:\owner-store\trusted-owner-keys.json `
  --owner-key-fingerprint <pinned-sha256-spki-fingerprint> `
  --owner-bundle-hash <pinned-current-trust-bundle-content-hash>
```

A pass emits `OWNER_OPERATION_EVIDENCE_VERIFICATION=<json>` with `certified: false`. Every failure emits
only a typed wall code on stderr and exits 2. The CLI does not certify, issue, sign, record, anchor, or
authorize anything. Its caller-provided paths and pins must never be represented as independently
sourced evidence.
