# WO-MAO-031 Codex Builder, Assurance, and Remediation Lifecycle

**Work Order:** `WO-MAO-031`

**Status:** `COMPLETE / INDEPENDENTLY APPROVED`

**Control-plane risk:** `R3`

**Supported task risk:** `R0`, `R1`

**Depends on:** `WO-MAO-026`, `WO-MAO-029`, `WO-MAO-030`

## Result

The historical JSON-receipt adapter remains invalid. Its replacement is a reusable current-session
consumer of the hardened WO-MAO-030 coordinator contract. A caller can supply only a private
coordinator plan, opaque builder and reviewer assignment handles, four observation identifiers, an
idempotency namespace, and sanitized routing summaries. The caller cannot supply a stage result,
provider response, verdict, unresolved-thread count, semantic constraint, evidence handle, native
identity, authority fence, or completion receipt.

The adapter starts the exact native builder and reviewer assignments and proves one bounded
request-changes/remediation cycle in this fixed order:

1. builder `BUILD_COMPLETE` while the builder remains `RUNNING`;
2. the independently bound reviewer reports `REQUEST_CHANGES` with exactly one unresolved thread;
3. the exact original builder reports remediation cycle 1 complete and becomes `SUCCEEDED`;
4. the same reviewer reports `APPROVED` with zero unresolved threads and becomes `SUCCEEDED`.

This is deliberately a one-cycle contract. It requires the envelope remediation budget to permit at
least one cycle, reports the full configured maximum, and makes no claim to execute arbitrary
multi-cycle review loops. A later Work Order may generalize the state machine without weakening this
proof.

## Opaque trust boundary

The lifecycle does not inspect coordinator-private WeakMaps and does not accept serialized
lookalikes. It uses only narrow WO-MAO-030 functions:

- native start and coordinator-routed message operations;
- semantic capture selected by an observation identifier and closed expected-kind enum;
- a private semantic attestation that rebinds the evidence handle to the same plan, assignment,
  native binding, provider response, and accepted authority fence;
- a private role-pair attestation that proves same Work Order/lane, exact reservation digest,
  available remediation budget, and distinct native builder/reviewer bindings.

The semantic attestation accepts a closed constraint identifier, not caller-provided attributes.
Coordinator-owned mappings require `PROVIDER_EVIDENCE`, exact provider state, exact evidence type,
and exact bounded attributes. Public summaries and delivery receipts never become stage evidence.

Every bridge side effect is protected by WO-MAO-030's atomic authority-fence request/echo contract.
The role adapter does not construct, read, or weaken fences; it publishes only the returned fence
digest. Native worker identifiers, provider summaries, evidence attributes, host-session details,
proof identifiers, and raw provider output are absent from the public lifecycle result.

## Lifecycle safety

- builder and reviewer handles must bind to the same private plan, Work Order, and lane;
- logical identities, native worker digests, and native binding digests must be distinct;
- pair-attested native worker digests must exactly match both native-start receipts;
- builder and reviewer reservations must be identical and contain at least one exact path;
- remediation uses the original builder handle and native binding; there is no remediator input;
- operation keys include run, Work Order, lane, assignment, namespace, and operation domains;
- exact replay returns the frozen result without repeating bridge effects;
- conflicting in-flight replay walls; successful and semantic-failure outcomes are terminal;
- only typed ambiguous side effects, reconciliation-pending outcomes, trusted observation-pending
  outcomes, and atomic active-fence rejections remain safely retryable with the exact request;
- the privately attested retry budget bounds attempts; its backoff is enforced before another
  attempt can increment or reach a lifecycle bridge effect;
- retry exhaustion first reconciles any known spawn/send ambiguity through that operation's exact
  lookup-only replay; children are canceled only after the ambiguous operation resolves;
- a persistently ambiguous potentially running child is explicitly quarantined and is never
  represented as canceled; the other exact child is canceled, lookup-only containment is bounded,
  and exhaustion produces a typed terminal-quarantine wall;
- unrecoverable semantic failures cancel both exact children; ambiguous cancel outcomes are
  quarantined, reconciled by lookup without a second cancel, and terminal-quarantined when their own
  bounded cleanup attempts are exhausted;
- duplicate observation identifiers, reordered kinds, foreign assignments, terminal BUILD,
  terminal REQUEST_CHANGES, wrong cycle, nonzero final threads, and forged evidence all wall;
- provider, adapter, path, sanitization, residual-secret, raw-output, and terminal-state walls remain
  owned by the hardened coordinator and provider contract.

## CLI boundary

`codex-role-adapters-cli.mjs` is intentionally non-executing. JSON cannot preserve the private plan,
assignment, semantic-evidence, native-binding, or authority-fence capabilities. Every syntactically
valid CLI invocation returns `CODEX_ROLE_CLI_PRIVATE_SESSION_WALL`; malformed invocation returns the
usage wall. Production registries remain empty and immutable.

## Public evidence

The public result contains only:

- Work Order, lane, run, and opaque assignment identifiers;
- logical/native/binding digests and a reservation digest;
- ordered stage names, roles, observation identifiers, semantic kinds, evidence-binding digests,
  and accepted authority-fence digests;
- one-cycle remediation counts and typed review verdict/count summaries;
- zero owner-touch, runtime-disabled, issue-357-disabled, no-GitHub-mutation, and no-authority-minting
  assertions.

Assignment and observation identifiers are retained because they are the bounded replay and audit
correlation keys. They are not native worker, session, proof, credential, or raw-output identifiers.

## Validation

The earlier independent `APPROVE` on integrated head `e9d4a75` was superseded by the ambiguity
containment remediation. Independent re-review of exact implementation head `b5e3a44` returned
`APPROVE`: every requested acceptance condition is satisfied and no additional blocking
correctness, authority-fence, state-projection, privacy, or non-claim finding remains. This approval
restores WO-MAO-031 completion but does not by itself release a downstream Work Order or expand the
explicit non-claims in this report.

- role lifecycle contract/attack suite: `tests/multi-agent-codex-role-adapters.test.ts`
  - opaque happy path and a second Work Order/lane;
  - copied/JSON/cross-plan/cross-lane/self-review handle attacks;
  - reservation, order, reuse, provider, state, sanitizer, raw-output, verdict, cycle, and budget
    walls;
  - start-receipt substitution, exact replay, trusted observation-pending resume, retry exhaustion,
    enforced backoff, failed/success terminal sealing, partial-start cleanup, ambiguous cleanup
    reconciliation/exhaustion, CLI wall, and public-result privacy;
  - last-attempt and persistent spawn/send ambiguity, lookup-only containment, exact-child
    cancellation, and truthful terminal quarantine;
  - focused result: `1 file / 28 tests`, PASS.
- real coordinator/registry/bridge integration in
  `tests/multi-agent-codex-coordinator-adapter.test.ts`: compiles a real opaque plan, crosses every
  production WeakMap boundary, resumes from a trusted pending observation, observes all four
  semantic events under accepted authority fences, replays without extra effects, and rejects
  copied/cross-plan handles before side effects;
  - malformed post-effect spawn and send acknowledgements enter the coordinator's private ambiguous
    transaction state; normal retry, last-attempt containment, and persistent lookup failure are
    proven without repeating the host effect or canceling an unresolved potentially running child;
  - combined focused result: `2 files / 122 tests`, PASS.
- syntax, focused Vitest, lint, full suite, and `git diff --check` evidence are recorded by the
  integration coordinator after both implementation lanes are combined.

## Explicit non-claims

```text
ARBITRARY_MULTI_CYCLE_REMEDIATION_PROVEN: false
DURABLE_PERSISTENCE_CLAIMED: false
SERVICE_WORKER_CLAIMED: false
RUNTIME_ACTIVATION_ALLOWED: false
LOCAL_ISSUE_357_ALLOWED: false
ISSUE_358_RELEASED: false
GITHUB_MUTATION_CLAIMED: false
PRODUCTION_WRITE_PERFORMED: false
AUTHORITY_GRANTED: false
RAW_PROVIDER_OUTPUT_INCLUDED: false
OWNER_RELAY_REQUIRED: false
UNRESOLVED_HOST_EFFECT_REPORTED_CANCELLED: false
PERSISTENT_AMBIGUITY_COMPLETION_CLAIMED: false
```

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```

## Downstream gate

Independent approval of WO-MAO-031 is necessary but not sufficient for WO-MAO-034 readiness.
WO-MAO-032 must remain complete as the assessment binding; WO-MAO-033 must remain exactly
`DEFERRED / PROVIDER_UNAVAILABLE`; and the consumer-specific `WO-MAO-034<-WO-MAO-033` settlement
must be independently verified. That exact canonical DAG settlement, trust pin, and provenance are
now integrated, so WO-MAO-034 is `READY`, not complete. WO-MAO-033 remains deferred and Claude
remains disabled. William is not asked to operate, authenticate, diagnose, or relay any provider.
