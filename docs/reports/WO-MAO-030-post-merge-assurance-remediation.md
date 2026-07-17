# WO-MAO-030 Post-Merge Assurance Remediation

**Canonical Work Order:** `WO-MAO-030`

**Status:** `PASS / ELEVEN_FINDINGS_CLOSED / INDEPENDENT_REREVIEW_PASS`

**Remediation base:** `c973e2e8e9728e3aa422fbb81c127e8e736cc92a`

**Original merged implementation:** `4d1bb1c`

**Approved hardened source:** `41b3b048931801575eba71b66e75966c0258a287`

**Superseded transient hold:** `ASSURANCE_HOLD=WO035_UNTIL_REMEDIATION_MERGE`

**Canonical invalidation:** `WO031_INVALIDATED / WO034_INVALIDATED / WO035_INVALIDATED /
WO036_INVALIDATED`

## Result

The weaker post-merge WO-MAO-030 implementation was replaced in the existing canonical adapter,
CLI, and test filenames. No parallel hosted-adapter module was introduced. The replacement retains
the existing capability identifier and canonical adapter reference while restoring the independently
attacked current-session-only, fail-closed contract.

Downstream assurance superseded the transient-hold projection. WO-MAO-030 and WO-MAO-032 remain
complete; the historical WO-MAO-031, WO-MAO-034, WO-MAO-035, and WO-MAO-036 evidence is invalidated
pending re-proof. WO-MAO-031 is the sole ready Work Order; WO-MAO-033 remains deferred and resumable;
WO-MAO-034 and later Work Orders are pending. Historical code and reports are retained as evidence,
not treated as completed proof. The mandatory order is WO-MAO-030 hardening, WO-MAO-031
redesign/re-proof, WO-MAO-034 re-review/re-proof, WO-MAO-035 re-proof, WO-MAO-036 re-proof, then
Phase 5.

## Descendant invalidations

- WO-MAO-034 cannot become ready merely because a caller includes WO-MAO-033 in a deferred set. The
  UI registry accepts no raw settlement-edge input and treats only completed dependencies as
  satisfied. WO-MAO-034 remains pending until this projection consumes the hardened DAG contract's
  exact independently verified `WO-MAO-034<-WO-MAO-033` settlement artifact and provenance. That
  settlement is consumer-specific and cannot satisfy another edge.
- WO-MAO-035 accepted caller-defined providers, caller-carried observations, and a stateless breaker
  projection. That could manufacture health and reroute proof without trusted operational evidence.
  Its API and CLI are therefore walled with
  `PROVIDER_HEALTH_REROUTE_INVALIDATED_PENDING_REPROOF`.
- WO-MAO-036 accepted caller-defined provider records and a WO-MAO-029 fixture as if those inputs
  proved operational provider coverage. Its API and CLI are therefore walled with
  `PROVIDER_CONFORMANCE_SUITE_INVALIDATED_PENDING_REPROOF`.
- WO-MAO-035 and WO-MAO-036 retain direct WO-MAO-033 dependency edges. The WO-MAO-034 settlement
  does not launder those edges into satisfaction; they remain fail-closed until an independently
  ratified dependency correction exists.

## Closed findings

1. `MAO030_CALLER_MINTED_TRUST_HANDLE` — caller-provided trust booleans/handles could authorize a
   role. Fixed by loading exact role, worker, lane, path, envelope-hash, expiry, and status bindings
   only from the immutable host trust registry.
2. `MAO030_ASSIGNMENT_RECIPIENT_SUBSTITUTION` — messaging did not confine the peer identity to the
   assignment. Fixed by opaque assignment handles and adapter-derived coordinator/child routing.
3. `MAO030_POST_TERMINAL_MESSAGE_DELIVERY` — messages could be sent after terminal state. Fixed by
   requiring an active exact native binding and walling terminal or quarantined assignments.
4. `MAO030_FALSE_CANCELLATION_DELIVERY` — active cancellation could claim delivery without an exact
   host acknowledgement. Fixed by exact bridge acknowledgement validation; prepared cancellation
   makes no bridge call and claims neither delivery nor acknowledgement.
5. `MAO030_CALLER_SUPPLIED_EVIDENCE` — caller response objects could be represented as independently
   observed evidence. Fixed by bridge-only observation and common WO-MAO-019 provider validation.
6. `MAO030_FICTIONAL_PRESPAWN_IDENTITIES` — builder/reviewer identities were accepted as if already
   live host sessions. Fixed by validating only the coordinator session before host-native spawn and
   binding child identities solely from the exact spawn result.
7. `MAO030_WEAK_MESSAGE_SANITIZATION` — bespoke filtering missed credential-shaped content. Fixed by
   reusing the canonical provider sanitizer and returning digests instead of message bodies.
8. `MAO030_MUTABLE_CALLER_STATE` — retained conformance/envelope objects could change after compile.
   Fixed by detached, deep-frozen normalized state held behind private plan handles.
9. `MAO030_TERMINAL_HASH_NOT_SEALED` — a later response with the same terminal state but different
   detail was accepted. Fixed by sealing terminal state to the exact provider-response hash.
10. `MAO030_OBSERVATION_REPLAY_UNBOUND` — observation identifiers lacked an idempotency/conflict map.
    Fixed by binding each observation ID to its validated response digest and exact public result;
    changed replays wall.
11. `MAO030_AMBIGUOUS_SIDE_EFFECT_DUPLICATION` — malformed post-effect spawn/send/cancel results could
    be retried into duplicate effects. Fixed by recording transactions before invocation, quarantining
    any uncertain outcome, consuming the assignment slot, and permitting recovery only through a
    lookup-only replay of the exact original idempotency key. The immutable bridge must assert host
    idempotency and that lookup cannot perform a side effect.

## Canonical files

- `scripts/multi-agent-operator/codex-coordinator-adapter.mjs`
- `scripts/multi-agent-operator/codex-coordinator-adapter-cli.mjs`
- `scripts/multi-agent-operator/codex-native-bridge-registry.mjs`
- `tests/multi-agent-codex-coordinator-adapter.test.ts`
- `tests/fixtures/codex-native-bridge-registry-fixture.mjs`

## Independent re-review

The hardened source received independent contract-attack `PASS` after all eleven findings were
closed. State/evidence review separately passed the non-inflation boundary: the adapter remains
`PROVEN / WORKER_CANDIDATE`, not an executable worker, service, durable transport, GitHub operator,
or unattended-runtime certification.

## Validation

- latest-main reconciliation focused adapter/role/routing/health/conformance/state/portfolio suites:
  `9 files / 54 tests`, PASS;
- prior remediation-branch canonical adapter suite: `1 file / 25 tests`, PASS;
- prior remediation-branch repository-wide Vitest: `171 files / 1,282 tests`, PASS;
- latest-main repository-wide Vitest, production build, and lint are assigned to independent assurance
  against the immutable remediation commit; they are not claimed by this report before that review.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
