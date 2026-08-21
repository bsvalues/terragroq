# WO-OUTCOME-762-911 — Runtime Reliability Remediation Record

`RESULT: READY_FOR_VALIDATION`

## Structured record

```text
RECORD_FORMAT: WILLIAMOS_RUNTIME_RELIABILITY_REMEDIATION_V1
RECORD_ID: WO-OUTCOME-762-911
DISPATCH_WORK_ORDER: WO-HERMES-OUTCOME-27
AUTHORITY_SOURCE: GOAL-0023
PARENT_OUTCOME: OUTCOME-762
TRACKED_ISSUE: 911
ISSUE_BINDING_SOURCE: HERMES_DISPATCH_PACKET
REPOSITORY: bsvalues/terragroq
BASE_COMMIT: 15d20969c0d90f09bf17225d641a16e749c21852
BRANCH: codex/hermes-goal-0023-27
RESERVED_PATH: docs/reports/WO-OUTCOME-762-911-runtime-reliability.md
RECORD_KIND: RELIABILITY_REMEDIATION_EVIDENCE
RECORD_STATE: COMPLETE
SOURCE_DECISION_ID: DEC-WILLIAMOS-V131-RUNTIME-HARDENING
SOURCE_DECISION_RECORDED_STATUS: active
SOURCE_DECISION_CREATED_AT: 2026-06-26
SOURCE_DECISION_REVIEW_AT: 2026-07-26
SOURCE_DECISION_FRESHNESS: HISTORICAL_NOT_REVALIDATED
HISTORICAL_RELEASE: v1.3.1
PRESERVED_BASELINE: v1.3.0
IMPLEMENTATION_MODE: REPOSITORY_EVIDENCE_RECONCILIATION_ONLY
RUNTIME_CHANGE_STATE: NOT_REQUESTED
HOST_RUNTIME_OBSERVATION_STATE: NOT_PERFORMED
HOST_RUNTIME_MUTATION_PERFORMED: false
RUNTIME_ACTIVATION_PERFORMED: false
RUNTIME_OR_EXTERNAL_PRODUCT_API_PROVIDER_CALL_PERFORMED: false
ISSUE_CLOSURE_CLAIMED: false
CURRENT_RUNTIME_HEALTH_CLAIMED: false
VALIDATION_STATE: PENDING_HERMES_HOST
INDEPENDENT_REVIEW_STATE: REMEDIATION_APPLIED_RECHECK_REQUIRED
PR_WORK_CONTEXT_CHECK: work context receipt (#831)
PR_CONTEXT_GATE_STATE: RECEIPT_ATTACHED_AND_VERIFIER_FIXED
PR_CONTEXT_GATE_LAST_OBSERVED_HEAD: 03c1621292015f874cf02621f1aed3a27c655f89
PR_CONTEXT_GATE_LAST_OBSERVED_RESULT: SUCCESS
CURRENT_REPORT_HEAD_RECHECK_REQUIRED: true
CHECK_CONCLUSIONS_RECEIVED: FAILURE, FAILURE, CANCELLED
DISTINCT_VALID_FINDINGS: 1
DUPLICATE_FAILURE_CONCLUSIONS_COLLAPSED: true
CANCELLED_RUN_DISPOSITION: NON_ACTIONABLE_CHECK_EXECUTION_STATE
CANCELLED_RUN_CAUSE_CLAIMED: false
RECEIPT_TOKEN_FABRICATED: false
WORK_CONTEXT_EXEMPTION_USED: false
REPORT_EMBEDDED_RECEIPT_WOULD_SATISFY_GATE: false
OWNER_TOUCH_COUNT: 0
BLOCKED_SCOPE_CROSSED: false
```

## Owner outcome

The dispatched outcome asks for a structured record of the reliability remediation associated with
issue `#911`, while limiting mutation to the reserved repository artifact. This report completes that
record by reconciling the existing WilliamOS v1.3.1 runtime-hardening decision, its implementation
anchors, and its retained historical proof. It does not operate, repair, start, stop, probe, or
reconfigure a runtime host.

## Repository-backed remediation

The source decision `DEC-WILLIAMOS-V131-RUNTIME-HARDENING` records v1.3.1 as the Ollama
startup/runtime reliability hardening baseline while preserving v1.3.0. The remediation is defined by
the following recorded behavior:

```text
MANAGED_AUTOSTART_ENDPOINT_SCOPE: LOOPBACK_ONLY
AUTO_START_ELIGIBILITY: INSTALLED_LOCAL_OLLAMA_ONLY
NON_LOCAL_AUTO_START: REFUSED
READINESS_POLLING_DEADLINE_SECONDS: 30
SETUP_TAGS_PROBE_CONFIGURED_IO_TIMEOUT_SECONDS: 5
CONTROL_CENTER_TAGS_PROBE_CONFIGURED_IO_TIMEOUT_SECONDS: 10
PROBE_TIMEOUT_SEMANTICS: BLOCKING_IO_NOT_TOTAL_DURATION
IN_FLIGHT_PROBE_TOTAL_DURATION_BOUND: NONE_ESTABLISHED
STRICT_READINESS_WALL_CLOCK_CEILING_ENFORCED: false
POST_DEADLINE_IN_FLIGHT_PROBE_CAN_SUCCEED: true
UNREADY_RESULT_AFTER_POLLING_LOOP: EXPLICIT_FAILURE
UNREADY_RESULT_REQUIRES_PROBE_RETURN: true
DEFAULT_RUNTIME: ollama
DEFAULT_CHAT_MODEL: qwen2.5:14b-instruct-q4_K_M
DEVELOPMENT_MODEL_OVERRIDE: WILLIAMOS_LLM_MODEL
AUTOMATIC_RUNTIME_SWITCHING: false
AUTOMATIC_CLOUD_FALLBACK: false
SELECTED_RUNTIME_FAILURE_VISIBILITY: EXPLICIT_OFFLINE_STATE
CONTROL_CENTER_WITHOUT_SELECTED_RUNTIME: STARTS_WITH_CONVERSATIONAL_ROUTING_UNAVAILABLE
V130_BASELINE_MOVEMENT: PROHIBITED
```

| Reliability behavior | Repository evidence | Recorded conclusion |
| --- | --- | --- |
| Structured, searchable hardening decision | `control-center/backend/decision_register.py`; `control-center/backend/tests/test_decision_register.py` | The v1.3.1 hardening record has an ID, status, decision, reason, scope, evidence, review date, and authority category. The seed register is read-only and does not itself enforce or mutate runtime state. |
| Local-only startup | `scripts/setup_copilot.py`; `scripts/williamos_control_center.py` | Startup is attempted only for an installed Ollama endpoint on `127.0.0.1` or `localhost`; a non-local host is refused. |
| Readiness polling and probe duration | `scripts/setup_copilot.py`; `scripts/williamos_control_center.py` | Both startup paths use a 30-second polling deadline after pre-window health work. The configured 5-second setup and 10-second Control Center values constrain blocking I/O inactivity, not total request duration. An endpoint that continues making I/O progress can keep an admitted probe in flight beyond the polling deadline with no finite total-duration bound established by these paths. If the probe returns without readiness, the paths return an explicit failure after the loop regains control. |
| Stable model selection | `control-center/backend/copilot/llm.py`; `control-center/backend/decision_register.py` | Ollama and `qwen2.5:14b-instruct-q4_K_M` remain defaults; a lighter model requires an explicit environment override. |
| No silent failover | `control-center/backend/copilot/llm.py`; `scripts/williamos_control_center.py` | Runtime evidence exposes `fallback: false`; an unavailable selected runtime is reported, and no fallback runtime is selected automatically. |
| Baseline preservation | `WilliamOS/95_ReleaseGovernance/reports/Release Notes - v1.3.1 - 2026-06-26.md`; `control-center/backend/decision_register.py` | The hardening is recorded as a patch baseline without moving the accepted v1.3.0 baseline. This lane did not inspect or change tags. |

## Historical proof retained, not rerun

The v1.3.1 release note records two cold-start exercises from 2026-06-26: `setup_copilot.py` brought
local Ollama online and restored the required models, and Control Center startup brought Ollama online
before `/api/copilot/health` reported the 14B model available. It also records a passing frontend
build, `158/158` backend tests, `28/28` runtime smoke, and a `9/9` production-readiness summary.

The linked generated reports independently retain:

| Evidence source | Source-reported result |
| --- | --- |
| `WilliamOS/105_RuntimeSmoke/reports/Runtime Smoke - 2026-06-26.md` | `28` core commands passed, `0` failed, `0` critical failures; copilot health was informational `ok`. |
| `WilliamOS/106_ProductionReadiness/reports/Production Readiness - 2026-06-26.md` | `10/10` checks passed. |

The release note's `9/9` summary and the generated readiness report's `10/10` detail are preserved as
source-specific historical statements. This record does not silently normalize the differing counts
or present either historical run as a current host check.

## Reliability acceptance contract

The remediation remains correctly represented only while all of these invariants hold:

1. Automatic startup is limited to an installed loopback Ollama endpoint.
2. Startup readiness uses a 30-second polling deadline for admitting polling work, not a completion
   deadline. The configured 5-second setup and 10-second Control Center values are blocking-I/O
   inactivity timeouts, not total probe-duration caps; continued response progress can keep an
   admitted probe in flight without an established finite wall-clock bound. If control returns, the
   final probe may still succeed or the path can expose failure. No end-to-end completion or
   deadline-to-failure ceiling is claimed.
3. Ollama and the 14B chat model remain the defaults unless an explicit runtime or model override is
   supplied.
4. Runtime failure remains visible and never causes an automatic provider, runtime, or cloud switch.
5. Runtime and model provenance remain present in health/evidence output with fallback reported as
   disabled.
6. v1.3.0 remains the preserved stable baseline; this record does not move, create, push, or release
   a tag.
7. Historical cold-start and gate evidence stays labelled with its original date and is never
   upgraded into current runtime health without a new, authorized observation.

## Truth boundary

- The Hermes dispatch packet binds this report to issue `#911`. The repository contains no separate
  substantive `#911` incident narrative, so this record does not invent an incident date, symptom,
  root cause, affected host, or issue-closure state.
- The source decision's stored review date is historical. This report reconciles evidence; it does
  not renew, supersede, or mint runtime or release authority.
- Static source inspection establishes the intended reliability contract, not the current condition
  of Ollama, its models, Control Center, a tag, or any machine.
- No historical command, count, health response, or cold-start result was re-executed in this lane.
- The existing "within 30 seconds" failure text describes the polling window. It is not evidence of
  a measured 30-second end-to-end wall-clock ceiling.
- The configured 5-second and 10-second probe timeouts constrain blocking I/O inactivity. They do not
  establish total request-duration bounds, because continued response progress can keep a probe in
  flight.
- The named Hermes work-contract test is an unrelated selected-Thread UI regression test; it does not
  validate this report, prove live runtime reliability, or establish issue closure.

## No-runtime-host-mutation ledger

```text
REPOSITORY_WRITE_LIMITED_TO_RESERVED_REPORT: true
READ_ONLY_REPOSITORY_COMMANDS_EXECUTED: rg
HOST_MUTATING_COMMAND_EXECUTED: false
VALIDATOR_EXECUTED_BY_CODEX: false
GIT_OR_GITHUB_OPERATION_PERFORMED_BY_CODEX: false
HOST_RUNTIME_PROCESS_STARTED_OR_STOPPED: false
SERVICE_OR_SCHEDULER_CHANGED: false
OLLAMA_PROBED_STARTED_STOPPED_OR_CONFIGURED: false
MODEL_PULLED_OR_SELECTED: false
RUNTIME_OR_PROVIDER_STATE_CHANGED: false
NETWORK_OR_PORT_STATE_CHANGED: false
ENVIRONMENT_OR_PACKAGE_CHANGED: false
PRODUCTION_DATA_OR_DEPLOYMENT_CHANGED: false
SECRET_CREDENTIAL_TOKEN_COOKIE_SESSION_OR_PASSWORD_INSPECTED: false
PAID_OVERAGE_OR_CREDIT_PURCHASED: false
DESTRUCTIVE_ACTION_PERFORMED: false
RELEASE_OR_TAG_CREATED_MOVED_PUSHED_OR_DELETED: false
PROPERTY_WORKBENCH_TERRAPILOT_TERRAFUSION_COUNTY_OR_PACS_TOUCHED: false
REJECTED_ISSUE_357_ADAPTER_USED: false
SCRIPTS_RUNTIME_OPERATOR_EXECUTION_PATH_USED: false
OBSIDIAN_CHANGED: false
OWNER_OPERATION_OR_CONTACT_REQUIRED: false
```

This ledger describes actions initiated by this bounded delivery lane. It is not a claim about
unobserved activity elsewhere on the host.

## Independent file review

A separate read-only assurance context checked the record against the dispatch, cited repository
sources, and safety boundary. Its first pass found two Important truth-scope issues: the pending review
label conflicted with the handoff result, and several non-effect labels were broad enough to include
the permitted repository write or native delivery context. This revision records review completion and
narrows those labels to runtime-host mutation, external product/provider calls, and runtime-operator
execution. No product, runtime, authority, or historical-evidence claim was widened.

Hermes exact-head review then identified two additional P2 acceptance defects. The unrelated
selected-Thread work-contract test is no longer represented as acceptance evidence for this report;
the handoff below defines report-specific validation. The readiness contract also records the
30-second value as a polling deadline and denies a strict 30-second wall-clock claim. Direct file
review confirmed both corrections remain inside the reserved report and preserve the historical
evidence verbatim.

A later pull-request check report contained two `FAILURE` conclusions and one `CANCELLED` conclusion
for the same required `work context receipt (#831)` check. Direct contract inspection reduced those
status entries to one actionable PR-admission defect and one non-actionable cancelled execution. The
remediation below does not invent a receipt, copy one from another head, or claim the gate is green.

The current exact-head review found two further P2 defects. First, the 5-second and 10-second I/O
timeout settings had been described as bounded additions to wall-clock completion even though
continued response progress can leave an admitted probe in flight without a total-duration limit. The
record now states the I/O-inactivity semantics and claims no finite probe or readiness-completion
bound. Second, the report validator checked only selected readiness fields and headings. The handoff
now adds a separate validator that requires every substantive reliability invariant as one exact
contiguous sequence, including loopback-only startup, stable runtime/model defaults, no automatic
switching or cloud fallback, visible failure, and v1.3.0 baseline preservation.

## PR work-context gate remediation

The required check reads a fenced `WORK_CONTEXT_RECEIPT` JSON block from the pull-request body. Receipt
issuance establishes the authority, subsystem, topology, collision, and remaining-parent premises; the
token binds the claims included by the issuer. CI re-derives that token and live-remeasures the doctrine,
the pull-request diff, and movement on `main`. CI cannot independently query the authority ledger, and
collision claims are issuance evidence rather than token-covered live state. It does not read this
report for the receipt. The Hermes PR creation path used a fixed prose body without the block, so adding
a token here would neither have admitted the PR nor been truthful.

```text
CHECK_NAME: work context receipt (#831)
CHECK_CONCLUSIONS_RECEIVED: FAILURE, FAILURE, CANCELLED
DETAILED_FAILURE_CODE_SUPPLIED_TO_THIS_LANE: false
DISTINCT_ACTIONABLE_DEFECTS: 1
ACTIONABLE_DEFECT: REQUIRED_RECEIPT_ABSENT_OR_UNPROVEN_IN_PR_BODY
DUPLICATE_FAILURE_CONCLUSIONS_COLLAPSED: true
WORKFLOW_CANCEL_IN_PROGRESS_CONFIGURED: true
CANCELLED_RUN_DISPOSITION: NON_ACTIONABLE_CHECK_EXECUTION_STATE
CANCELLED_RUN_CAUSE_CLAIMED: false
RECEIPT_CONSUMER: PULL_REQUEST_BODY
RECEIPT_TOKEN_FABRICATED: false
STALE_OR_FOREIGN_RECEIPT_REUSED: false
WORK_CONTEXT_EXEMPTION_USED: false
REPORT_EMBEDDED_RECEIPT_WOULD_SATISFY_GATE: false
OWNER_TOUCH_REQUIRED: false
RECOVERY_OWNER: HERMES_HOST
RECOVERY_STATE: COMPLETE_AT_HEAD_03C1621292015F874CF02621F1AED3A27C655F89
VERIFIER_FIX_MAIN_SHA: 50c826dabfe6f207f0f740f3b62fc6eeda28afe9
```

The two identical failure summaries are not treated as two independent product defects. The cancelled
summary is not promoted to another defect: it contains no failure diagnosis, and the workflow permits
an in-progress run to be cancelled when a newer event for the same pull request starts. Detailed run
logs were not supplied to this lane, so no narrower failure code or cancellation cause is claimed.

Hermes can recover the existing pull request without an empty commit or owner contact:

1. Re-establish the work context against current `main`, the current doctrine digest, and the exact
   changed-file set at the remediation head.
2. Issue a fresh receipt for `WO-HERMES-OUTCOME-27`, parent outcome `OUTCOME-762`, and the sole reserved
   path `docs/reports/WO-OUTCOME-762-911-runtime-reliability.md`, using the authority, subsystem,
   topology, collision, and remaining-parent-acceptance facts measured by the issuer. No value that is
   not measured may be copied or inferred from this report.
3. Add the issued token and its exact facts as a fenced `WORK_CONTEXT_RECEIPT` JSON block in the pull-
   request body. Do not use `WORK_CONTEXT_EXEMPT` as a substitute.
4. Edit the existing pull-request body so the workflow's `edited` trigger evaluates the fresh event
   payload; do not rely on replaying an earlier event payload.
5. Require `work context receipt (#831)` to pass for the exact remediation head before merge.

This is routine Hermes repository-lifecycle recovery inside the existing authority. It neither needs
an owner decision nor authorizes runtime, production, release, tag, credential, or blocked-scope work.
Direct post-edit file review confirmed that the structured and narrative fields agree: one actionable
gate defect is recorded, no receipt or exemption is fabricated, no cancellation cause is asserted,
and PR-body recovery passed at the recorded head after the Markdown-reservation verifier fix reached
`main`. The report remediation head still requires its own external receipt-check rerun.

## Hermes host validation handoff

Codex did not run validators, Git, GitHub, interpreters, package managers, or runtime commands. Hermes
owns the following exact post-remediation validation and repository lifecycle. Each
validator `*_ARG_*` value is one separated process argument. The structure expression requires report
identity, no-runtime-host-mutation posture, review state, PR work-context remediation, and every
substantive section in order. The independent reliability expression requires the complete invariant
block as an exact contiguous sequence, so removing, inserting, or changing a recorded invariant fails
that gate. Both commands must exit zero.

```text
git diff --check: PENDING_HERMES_HOST
REPORT_VALIDATOR_COMMAND: rg
REPORT_VALIDATOR_ARG_1: --quiet
REPORT_VALIDATOR_ARG_2: -U
REPORT_VALIDATOR_ARG_3: (?ms)^# WO-OUTCOME-762-911 — Runtime Reliability Remediation Record$.*^RECORD_FORMAT: WILLIAMOS_RUNTIME_RELIABILITY_REMEDIATION_V1$.*^RECORD_ID: WO-OUTCOME-762-911$.*^DISPATCH_WORK_ORDER: WO-HERMES-OUTCOME-27$.*^TRACKED_ISSUE: 911$.*^SOURCE_DECISION_ID: DEC-WILLIAMOS-V131-RUNTIME-HARDENING$.*^HISTORICAL_RELEASE: v1\.3\.1$.*^PRESERVED_BASELINE: v1\.3\.0$.*^HOST_RUNTIME_MUTATION_PERFORMED: false$.*^VALIDATION_STATE: PENDING_HERMES_HOST$.*^INDEPENDENT_REVIEW_STATE: REMEDIATION_APPLIED_RECHECK_REQUIRED$.*^PR_CONTEXT_GATE_STATE: RECEIPT_ATTACHED_AND_VERIFIER_FIXED$.*^DISTINCT_VALID_FINDINGS: 1$.*^CANCELLED_RUN_DISPOSITION: NON_ACTIONABLE_CHECK_EXECUTION_STATE$.*^CANCELLED_RUN_CAUSE_CLAIMED: false$.*^RECEIPT_TOKEN_FABRICATED: false$.*^WORK_CONTEXT_EXEMPTION_USED: false$.*^OWNER_TOUCH_COUNT: 0$.*^BLOCKED_SCOPE_CROSSED: false$.*^## Owner outcome$.*^## Repository-backed remediation$.*^## Historical proof retained, not rerun$.*^## Reliability acceptance contract$.*^## Truth boundary$.*^## No-runtime-host-mutation ledger$.*^## Independent file review$.*^## PR work-context gate remediation$.*^ACTIONABLE_DEFECT: REQUIRED_RECEIPT_ABSENT_OR_UNPROVEN_IN_PR_BODY$.*^RECOVERY_STATE: COMPLETE_AT_HEAD_03C1621292015F874CF02621F1AED3A27C655F89$.*^## Hermes host validation handoff$
REPORT_VALIDATOR_ARG_4: docs/reports/WO-OUTCOME-762-911-runtime-reliability.md
REPORT_VALIDATOR_STATE: PENDING_HERMES_HOST
RELIABILITY_INVARIANT_VALIDATOR_COMMAND: rg
RELIABILITY_INVARIANT_VALIDATOR_ARG_1: --quiet
RELIABILITY_INVARIANT_VALIDATOR_ARG_2: -U
RELIABILITY_INVARIANT_VALIDATOR_ARG_3: (?m)^MANAGED_AUTOSTART_ENDPOINT_SCOPE: LOOPBACK_ONLY$\n^AUTO_START_ELIGIBILITY: INSTALLED_LOCAL_OLLAMA_ONLY$\n^NON_LOCAL_AUTO_START: REFUSED$\n^READINESS_POLLING_DEADLINE_SECONDS: 30$\n^SETUP_TAGS_PROBE_CONFIGURED_IO_TIMEOUT_SECONDS: 5$\n^CONTROL_CENTER_TAGS_PROBE_CONFIGURED_IO_TIMEOUT_SECONDS: 10$\n^PROBE_TIMEOUT_SEMANTICS: BLOCKING_IO_NOT_TOTAL_DURATION$\n^IN_FLIGHT_PROBE_TOTAL_DURATION_BOUND: NONE_ESTABLISHED$\n^STRICT_READINESS_WALL_CLOCK_CEILING_ENFORCED: false$\n^POST_DEADLINE_IN_FLIGHT_PROBE_CAN_SUCCEED: true$\n^UNREADY_RESULT_AFTER_POLLING_LOOP: EXPLICIT_FAILURE$\n^UNREADY_RESULT_REQUIRES_PROBE_RETURN: true$\n^DEFAULT_RUNTIME: ollama$\n^DEFAULT_CHAT_MODEL: qwen2\.5:14b-instruct-q4_K_M$\n^DEVELOPMENT_MODEL_OVERRIDE: WILLIAMOS_LLM_MODEL$\n^AUTOMATIC_RUNTIME_SWITCHING: false$\n^AUTOMATIC_CLOUD_FALLBACK: false$\n^SELECTED_RUNTIME_FAILURE_VISIBILITY: EXPLICIT_OFFLINE_STATE$\n^CONTROL_CENTER_WITHOUT_SELECTED_RUNTIME: STARTS_WITH_CONVERSATIONAL_ROUTING_UNAVAILABLE$\n^V130_BASELINE_MOVEMENT: PROHIBITED$
RELIABILITY_INVARIANT_VALIDATOR_ARG_4: docs/reports/WO-OUTCOME-762-911-runtime-reliability.md
RELIABILITY_INVARIANT_VALIDATOR_STATE: PENDING_HERMES_HOST
VALIDATION_AGGREGATION: ALL_COMMANDS_MUST_EXIT_ZERO
work context receipt (#831): LAST_OBSERVED_SUCCESS_RECHECK_CURRENT_HEAD
commit: null
pr_url: null
merged: false
merge_commit: null
```

`tests/hermes-work-contract.test.ts` exercises the selected-Thread latest-evidence UI contract and is
not acceptance evidence for this report. The report-specific validators and `git diff --check`
authorize no runtime, service, provider, production, release, or tag mutation. A normal repository
revert of this single report is the complete rollback; no host rollback is needed.

## Safety

- The change is confined to the exact reserved report path.
- No blocked scope was crossed and no owner touch occurred.
- The report records evidence without upgrading historical proof into current runtime truth.
- Independent file review findings have been remediated in this record; the remediation head still
  requires external independent re-review before merge.
- The earlier exact-head findings were remediated without leaving the reserved report path.
- The repeated #831 results are classified without fabricating a receipt or exemption; PR-body
  recovery passed at the recorded head and the remediation head requires the normal CI recheck.
- The latest two P2 findings were remediated by removing the false probe-duration bound and requiring
  the full contiguous reliability invariant block in host validation.
