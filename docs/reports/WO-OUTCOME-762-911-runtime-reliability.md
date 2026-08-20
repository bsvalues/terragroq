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
INDEPENDENT_REVIEW_STATE: COMPLETE_FINDINGS_REMEDIATED
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
the following bounded behavior:

```text
MANAGED_AUTOSTART_ENDPOINT_SCOPE: LOOPBACK_ONLY
AUTO_START_ELIGIBILITY: INSTALLED_LOCAL_OLLAMA_ONLY
NON_LOCAL_AUTO_START: REFUSED
READINESS_DEADLINE_SECONDS: 30
READINESS_TIMEOUT_RESULT: EXPLICIT_FAILURE
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
| Bounded readiness | `scripts/setup_copilot.py`; `scripts/williamos_control_center.py` | Both startup paths stop waiting after 30 seconds and return an explicit failure instead of waiting indefinitely. |
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
2. Startup readiness has a deterministic 30-second ceiling and an observable failure result.
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
- The named Hermes work-contract test is a handoff regression gate; it does not prove live runtime
  reliability or issue closure.

## No-runtime-host-mutation ledger

```text
REPOSITORY_WRITE_LIMITED_TO_RESERVED_REPORT: true
READ_ONLY_REPOSITORY_COMMANDS_EXECUTED: rg
HOST_MUTATING_COMMAND_EXECUTED: false
VALIDATOR_EXECUTED_BY_CODEX: false
GIT_OR_GITHUB_OPERATION_PERFORMED: false
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

## Hermes host validation handoff

Codex did not run validators, Git, GitHub, interpreters, package managers, or runtime commands. Hermes
owns the following exact post-handoff validation and repository lifecycle:

```text
git diff --check: PENDING_HERMES_HOST
npx vitest run tests/hermes-work-contract.test.ts: PENDING_HERMES_HOST
commit: null
pr_url: null
merged: false
merge_commit: null
```

Those validators authorize no runtime, service, provider, production, release, or tag mutation. A
normal repository revert of this single report is the complete rollback; no host rollback is needed.

## Safety

- The change is confined to the exact reserved report path.
- No blocked scope was crossed and no owner touch occurred.
- The report records evidence without upgrading historical proof into current runtime truth.
- Independent file review completed and its truth-scope findings were remediated in this record.
