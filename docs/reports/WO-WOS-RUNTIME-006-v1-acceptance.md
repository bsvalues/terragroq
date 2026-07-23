# WO-WOS-RUNTIME-006 - WilliamOS V1 Runtime Acceptance

## Result

`PASS / WILLIAMOS_V1_RUNTIME_COMPLETE`

Controlling issue: [#448](https://github.com/bsvalues/terragroq/issues/448)

Baseline: `33142e8e05428da307a152918e19b5ada58cc62f`

Latest merged product outcome before this packet:
`ec96f020f2aa47c69bc6146439c81ccc9ba7ea62`

First complete exact-head campaign:
`da7756fd498b7a3da27039966b54fe52fdcf66ea`

Campaign result: `14/14 PASS`

The exact acceptance-packet revision and final merged-main revision are recorded by the external,
digest-verified campaign result and the controlling issue's closure evidence. They cannot be
self-embedded in the commit whose identity they describe.

## Dependency-ordered delivery

| Work Order | Delivery | Result |
| --- | --- | --- |
| `WO-WOS-RUNTIME-002A` | PR #449 | Durable Work Order, attempt, checkpoint, lease, failure-eval, and terminal-result projection |
| `WO-WOS-RUNTIME-002B` | PR #449 | Atomic claim/materialization, legal transitions, fencing, restart, contention, and stale-lease recovery |
| `WO-WOS-RUNTIME-003` | PR #449 | Versioned governed App Server worker contract, cancellation, timeout, authority, and boundary controls |
| `WO-WOS-RUNTIME-004` | PR #449 | Validation, evidence, trace, typed failure, bounded remediation, exact-head review, delivery, and cleanup |
| `WO-WOS-RUNTIME-005` | PR #450 | Persisted Runtime and Trace product truth, bounded query windows, and typed Eval projection |
| `GOAL-0004 / WO-HERMES-8-001` | PR #451 | Fresh ordinary-language product outcome delivered by the resident bridge with bounded recovery |
| `WO-WOS-RUNTIME-006` | This packet | AC-01 through AC-14 campaign, capability reconciliation, and final claim boundary |

## Acceptance policy

`UNIT_SIMULATED_NEVER_SUBSTITUTES_FOR_LIVE`

| Criterion | Proof class | Required proof |
| --- | --- | --- |
| AC-01 Happy path | `LIVE` | Outcome 8 persisted, dispatched, validated, reviewed, merged, verified, completed, and released |
| AC-02 Failure path | `EXECUTABLE_SCENARIO` | Typed validation failure remains observable and reaches bounded repair or precise escalation |
| AC-03 Restart | `EXECUTABLE_SCENARIO` | One fenced execution resumes without duplicate mutation or evidence loss |
| AC-04 Claim contention | `EXECUTABLE_SCENARIO` | Two contenders produce one active writer |
| AC-05 Stale lease | `EXECUTABLE_SCENARIO` | Abandoned fencing advances to one recovered writer |
| AC-06 Authority denial | `EXECUTABLE_SCENARIO` | Denied action stops before mutation |
| AC-07 Boundary enforcement | `EXECUTABLE_SCENARIO` | Out-of-reservation path fails closed before mutation |
| AC-08 Cancellation/timeout | `EXECUTABLE_SCENARIO` | Interruption preserves attributable evidence and truthful state |
| AC-09 Evidence integrity | `EXECUTABLE_SCENARIO` | Provenance survives restart and corruption is detected |
| AC-10 Cleanup recovery | `EXECUTABLE_SCENARIO` | Interrupted cleanup resumes and removes only owned content |
| AC-11 Product truth | `LIVE` | One persisted Work Order identity joins Runtime, Evidence, Trace, and Eval records |
| AC-12 V1 inventory | `VERIFIED_STATIC` | All 44 canonical capabilities have exact proof classification parity |
| AC-13 Live proof | `LIVE` | Application health and nonce-bound resident worker identity pass separately |
| AC-14 No relay | `LIVE` | All five owner-touch counters remain exactly zero |

Each retained artifact is constrained beneath the WilliamOS evidence root and binds:

- Issue #448;
- one acceptance criterion and required artifact kind;
- proof class and exact source revision;
- freshness where live or executable;
- scenario-specific identity and state invariants;
- a disk digest verified by the campaign.

The campaign rejects caller labels without typed artifact contents, parent-path or symlink escapes,
unrelated repositories, incomplete capability inventories, stale live evidence, reused supervisor
PIDs without process identity, nonzero owner counters, invalid fencing, and unreleased terminal work.

## Fresh outcome proof

William's existing ordinary-language outcome was persisted as `GOAL-0004` without asking him to
operate Git, GitHub, credentials, diagnostics, or the worker:

> Make the WilliamOS Runtime page show when persisted execution evidence reaches its bounded
> history window, so I can distinguish complete evidence from a truncated view.

The resident supervisor selected Outcome 8. Two bounded provider attempts failed before mutation;
their retryable failures remained recorded. The third attempt used the corrected read-only
repository-inspection contract, delegated source, test, and independent-assurance lanes, and returned
the file handoff to Hermes.

Hermes then ran host validation, created PR #451 at exact head
`6f4b8b7395a89286d74662fdc408abc5c16fdb91`, observed green CodeRabbit and Vercel checks, merged at
`ec96f020f2aa47c69bc6146439c81ccc9ba7ea62`, recovered one post-merge cleanup interruption, marked the
checkpoint `COMPLETE`, and released the lease. Owner-touch counters remained zero.

## Product truth

- `/runtime` reads bounded persisted Hermes execution state.
- `/trace` projects the same checkpoint, lease, and typed failure events.
- Eval remains the read-only failure-evaluation projection inside Trace.
- `/audit` leads with current, user-scoped persisted evidence and runtime truth; the static Evidence
  Spine is explicitly retained historical context.
- Work Orders, Runtime, Trace, Eval, and linked Evidence identities are captured from the persisted
  database and verified through one consistency digest.
- The Runtime verification-history panel now distinguishes a complete five-record view from a
  six-record sentinel proving older evidence may be omitted.

## Safety

No owner Git/GitHub operation, credential inspection, protected data, paid overage, production
mutation, destructive Git, arbitrary repository access, TerraFusion, Property Workbench, TerraPilot,
county/PACS access, or rejected issue #357 adapter reuse occurred.

The resident worker remains bounded to the native non-elevated Windows user, one approved
WilliamOS-native R0/R1 outcome at a time, the authorized repository, reserved paths, finite retries,
fenced leases, exact-head delivery, and the local kill switch.

## Remaining limitations

- `EXECUTABLE_SCENARIO` proves deterministic failure/recovery behavior but is not presented as a
  second live external incident.
- The resident worker is not an unrestricted scheduler, cross-repository operator, production
  deployment service, or authority source.
- Live artifact freshness is intentionally short; a later claim must rerun the campaign.
- The external campaign result and host artifacts remain authoritative for the exact final revision,
  current process identity, endpoint health, lease state, and owner counters.

Issue #448 may close only after this packet is merged, the campaign is rerun against exact merged
main, all leases remain released, and live application and worker proof remain current.
