# WO-MAO-030 Post-Merge Assurance Remediation

**Canonical Work Order:** `WO-MAO-030`

**Status:** `ELEVEN_ORIGINAL_FINDINGS_CLOSED / PR381_FOLLOWUP_REMEDIATED /
INDEPENDENT_REREVIEW_PENDING`

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

Downstream assurance superseded the transient-hold projection. This report recorded the original
invalidated state at WO-MAO-030 hardening time. Current successor evidence re-proves WO-MAO-031 and
WO-MAO-034; WO-MAO-035 is blocked on its separate direct WO-MAO-033 dependency edge, while
WO-MAO-036 and WO-MAO-037 remain pending behind that gate. Historical code and reports are retained
as evidence, not treated as completed proof. The mandatory order is WO-MAO-030 hardening, WO-MAO-031
redesign/re-proof, the independently verified WO-MAO-032/WO-MAO-033 settlement gate for WO-MAO-034,
WO-MAO-034 re-review/re-proof, WO-MAO-035 dependency-edge correction and re-proof, WO-MAO-036
re-proof, then Phase 5.

## Descendant invalidations

- WO-MAO-034 cannot become ready merely because a caller includes WO-MAO-033 in a deferred set. The
  UI registry accepts no raw settlement-edge input and treats only completed dependencies as
  satisfied. WO-MAO-034 remains blocked until the WO-MAO-032 assessment is `COMPLETE`, WO-MAO-033
  remains exactly `DEFERRED / PROVIDER_UNAVAILABLE`, and the projection consumes the hardened DAG
  contract's exact independently verified `WO-MAO-034<-WO-MAO-033` settlement artifact and provenance.
  That settlement is consumer-specific and cannot satisfy another edge.
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

## PR #381 follow-up remediation

- Exact committed sends now replay their original frozen result after terminal assignment state;
  conflicting or new terminal sends remain walled and cannot repeat the bridge call.
- Authority status-event references are checked as an exact duplicate-free set independent of
  reference order. The original signed event array remains chain-ordered for authoritative
  validation, and malformed event entries produce a typed authority wall.
- Oversized generated assignment IDs retain short-ID compatibility but use a domain-separated,
  deterministic SHA-256 suffix so all valid near-limit inputs remain handleable within 128 characters
  and distinct inputs remain separated.
- An exact provider cancellation observation may initialize terminal evidence only after the same
  assignment/native binding has a committed bridge-acknowledged cancellation. Other null-hash
  terminal states and later conflicting cancellation evidence remain fail-closed.
- Public-plan privacy regression checks the actual fixture host-session identifier rather than an
  unrelated substring.
- Runtime occupancy deduplicates the active shared coordinator identity within one multi-lane plan,
  while counting each active or ambiguous child separately and excluding prepared or terminal
  assignments.
- Every operation, committed replay, and ambiguous lookup reloads a production-empty immutable
  host-backed authority-status chain. Exact signed ACTIVE chains advance a private monotonic fence;
  signed revocation latches terminally before any bridge call, lookup, observation, or cached replay.
- Authority requests are derived only from the normalized V2 envelope and cover the complete exact
  repository-by-action matrix, including declared repositories without reservations. The same matrix
  is retained privately for live revalidation, and a scope-superset grant remains valid.
- Multi-repository execution is deliberately not claimed. Once the complete authority matrix passes,
  a plan declaring more than one repository typed-walls before assignment preparation because the
  preventive trust/provider evidence contract lacks repository-qualified artifact attribution.
  Identical relative paths and case-variant logical repository identities remain contained by this
  wall pending an end-to-end repository-qualified evidence contract.
- The authority-status registry fixture preserves installed registry identity, version, and declared
  fencing head while deriving the content-hash head from the immutable last record, matching the
  production loader. Substituted identities, fence heads ahead of or behind the record chain, accepted
  fence rollback, registry-version rollback, and equal-fence equivocation are attacked fail-closed.

## Canonical files

- `scripts/multi-agent-operator/codex-coordinator-adapter.mjs`
- `scripts/multi-agent-operator/codex-coordinator-adapter-cli.mjs`
- `scripts/multi-agent-operator/codex-native-bridge-registry.mjs`
- `scripts/multi-agent-operator/hosted-codex-authority-status-registry.mjs`
- `tests/multi-agent-codex-coordinator-adapter.test.ts`
- `tests/fixtures/codex-native-bridge-registry-fixture.mjs`
- `tests/fixtures/hosted-codex-authority-status-registry-fixture.mjs`

## Independent re-review

The hardened source received independent contract-attack `PASS` after all eleven findings were
closed. State/evidence review separately passed the non-inflation boundary: the adapter remains
`PROVEN / WORKER_CANDIDATE`, not an executable worker, service, durable transport, GitHub operator,
or unattended-runtime certification.

## Known limitations before WO-MAO-031 reliance

- The adapter reloads and cryptographically revalidates host authority status immediately before an
  operation, replay, or lookup, but the bridge request/result does not yet echo and atomically enforce
  the accepted authority fence. The residual final-load-to-side-effect TOCTOU remains an explicit
  prerequisite; this report does not claim host-side fence enforcement.

## Validation

- current-branch focused adapter/role/routing/health/conformance/state/portfolio suites:
  `9 files / 90 tests`, PASS;
- current-branch authoritative repository-wide Vitest: `173 files / 1,323 tests`, PASS;
- prior latest-main repository-wide Vitest: `173 files / 1,308 tests`, PASS;
- current-branch ESLint, Node syntax, secret-pattern sweep, and `git diff --check`: PASS;
- latest-main Next.js production build: PASS;
- prior remediation-branch canonical adapter suite: `1 file / 25 tests`, PASS;
- prior remediation-branch repository-wide Vitest: `171 files / 1,282 tests`, PASS;

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
