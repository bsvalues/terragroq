# WO-MAO-030 Hosted Codex Coordinator Adapter

**Work Order:** `WO-MAO-030`

**Status:** `COMPLETE / POST_MERGE_ASSURANCE_HARDENED / CURRENT_SESSION_ONLY / FAIL_CLOSED`

**Control-plane risk:** `R3`

**Supported task risk:** `R0`, `R1`

**Depends on:** `WO-MAO-024`, `WO-MAO-028`, `WO-MAO-029`

## Outcome

WO-MAO-030 implements the bounded hosted Codex coordinator adapter contract. It recomputes the
canonical WO-MAO-024 topology input and admits only its dependency-cleared `candidateFanOut`. Before
preparing a native assignment, it verifies an active owner-signed authority artifact, exact reserved
paths and envelope hash from an immutable host trust registry, the exact WO-MAO-029 provider
conformance, one opaque live coordinator-session identity, and an immutable current-session native
bridge. Builder and reviewer identities are accepted only from the bridge's exact spawn result; they
are not invented as pre-existing sessions.

The compiled result is current-session-only. It stages coordinator, build, review, and remediation
phases under the Codex concurrency ceiling of three. `mergeController` and `verifier` remain topology
roles but are not falsely represented as WO-MAO-029 native assignments. Assignment artifacts retain
only a hash of the canonical objective, not its body. At spawn, the bridge receives a detached
structured task derived from that canonical envelope; a caller cannot add a separate prompt or forge
a topology result, session identity, trust boolean, authority grant, path set, or assignment handle.

Coordinator-routed messages and cancellation requests use opaque plan/assignment bindings. Every
operation revalidates the current coordinator-session and trust-expiry boundaries and reloads the
immutable host-backed authority-status chain before any bridge call, lookup, observation, or cached
replay. Signed revocation is terminally latched.
The assignment handle determines its only permitted peer, so a caller cannot substitute another lane
recipient. Message and cancellation idempotency keys return an exact replay and reject a changed
replay. Prepared work cancels without a bridge call or delivery claim. Active work invokes the host
bridge and requires its exact cancellation acknowledgement before becoming terminal. Terminal work
rejects later messages and conflicting completion or cancellation. Spawn, send, and cancellation
side effects require host-enforced idempotency plus lookup-only reconciliation. A throw, malformed
result, mismatched result, or duplicate native identity quarantines the assignment as ambiguous;
retries cannot repeat the side effect and only the exact original key may reconcile it by lookup.

Only host-bridge observations can become evidence; public response objects are rejected. Observations
pass the common WO-MAO-019 sanitizer and exact assignment/path binding. Captured
evidence stores attribution and hashes only; it excludes session identifiers, prompt/result bodies,
attributes, credentials, and raw provider output. Observation identifiers are bound to their first
validated response hash and exact public result. Terminal evidence is sealed to the exact response
hash, so a later response cannot alter terminal detail while retaining the same terminal state.

## Post-merge assurance remediation

The implementation merged at original commit `4d1bb1c` was subsequently found weaker than the
independently attacked WO-MAO-030 contract. The canonical module and tests were therefore replaced on
base `c973e2e8e9728e3aa422fbb81c127e8e736cc92a` with the approved hardened implementation from
`41b3b048931801575eba71b66e75966c0258a287`. The eleven typed findings, fixes, independent
re-review, and transient WO-MAO-035 assurance hold are recorded in
`docs/reports/WO-MAO-030-post-merge-assurance-remediation.md`.

Downstream assurance invalidates the historical WO-MAO-031 and WO-MAO-034 completion evidence
without deleting their code or reports. Canonical state therefore keeps WO-MAO-030 and WO-MAO-032
complete, returns WO-MAO-031 to `READY`, keeps WO-MAO-033 deferred and resumable, and returns
WO-MAO-034 and later Work Orders to `PENDING`. Re-proof order is WO-MAO-030, WO-MAO-031,
WO-MAO-034, then WO-MAO-035. WO-MAO-031 completion alone does not release WO-MAO-034: readiness also
requires the completed WO-MAO-032 assessment, WO-MAO-033 exactly
`DEFERRED / PROVIDER_UNAVAILABLE`, and independently verified consumer-specific settlement
`WO-MAO-034<-WO-MAO-033`. The UI remains fail-closed until the verified DAG artifact and provenance
are integrated.

## Exact boundary

This adapter does **not** claim or create:

- provider-contract dispatch, a service worker, durable transport, or durable persistence;
- a background scheduler, local runtime activation, nested `codex exec`, or issue `#357` reuse;
- credential, token, auth-cache, prompt-body, result-body, or raw-provider-output inspection;
- GitHub, production, merge, release, or authority-minting behavior;
- bridge-echoed, atomic host-side enforcement of the last accepted authority fence; the residual
  final-load-to-side-effect TOCTOU remains a prerequisite;
- an owner operation, owner relay, owner diagnostic, or owner credential action.

The production host-session, preventive-trust, native-bridge, and authority-status registries remain
intentionally empty and immutable. The CLI therefore fails with a typed current-session wall unless a trusted hosted
environment supplies those non-serializable bindings. JSON cannot register or forge them.

## Mechanical proof

- `scripts/multi-agent-operator/codex-coordinator-adapter.mjs`
- `scripts/multi-agent-operator/codex-coordinator-adapter-cli.mjs`
- `scripts/multi-agent-operator/codex-native-bridge-registry.mjs`
- `scripts/multi-agent-operator/hosted-codex-authority-status-registry.mjs`
- `tests/multi-agent-codex-coordinator-adapter.test.ts`
- `tests/fixtures/codex-native-bridge-registry-fixture.mjs`
- `tests/fixtures/hosted-codex-authority-status-registry-fixture.mjs`

The adversarial suite covers topology recomputation, incomplete dependencies, role substitution,
immutable trust records and assignment handles, exact path/envelope scope, host identity substitution
and expiry, bridge substitution, ambiguous spawn quarantine and lookup-only recovery, detached caller state,
cryptographic authority scope, runtime/#357/durable-claim walls, coordinator-only routing, secret
rejection, exact replay, cross-run handles, ambiguous send/cancel acknowledgement recovery,
pre-dispatch cancellation, active cancellation acknowledgement, exact terminal-response sealing,
post-terminal committed-send replay, order-independent exact authority-event reference sets,
bounded domain-separated assignment identifiers, acknowledged cancellation-evidence initialization,
observation replay binding, actual host-session identifier privacy, sanitized hash-only evidence,
artifact path confinement, provider binding, shared-coordinator multi-lane occupancy, concurrency,
live signed authority revocation before bridge/replay/lookup paths, authority-fence equivocation,
production-empty status registry behavior, and production-CLI failure.

Validation:

- focused Vitest: `1 file / 46 tests`, PASS;
- latest-main focused adapter/role/routing/health/conformance/state/portfolio suites:
  `9 files / 75 tests`, PASS;
- latest-main repository-wide Vitest: `173 files / 1,308 tests`, PASS;
- latest-main ESLint, Node syntax, secret-pattern sweep, and `git diff --check`: PASS;
- latest-main Next.js production build: PASS.

## Next transition

`WO-MAO-001` through `WO-MAO-030` and `WO-MAO-032` are complete. `WO-MAO-031` is the sole
dependency-cleared Work Order. `WO-MAO-033` remains `DEFERRED / PROVIDER_UNAVAILABLE` and resumable;
`WO-MAO-034` and later Work Orders remain pending. WO-MAO-034 cannot become ready until WO-MAO-031
is independently complete and the exact WO-MAO-032/WO-MAO-033 settlement gate above is verified and
integrated.
## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
