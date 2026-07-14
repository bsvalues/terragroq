# WO-MAO-019 Provider Capability and Dispatch Contract

**Work Order:** `WO-MAO-019`

**Status:** `COMPLETE`

**Risk:** `R3`

**Depends on:** `WO-MAO-016`

## Outcome

WilliamOS now has a strict, provider-neutral, local contract for capability discovery, pre-dispatch
eligibility, provider status, cancellation, artifacts, and sanitized evidence. The contract is pure:
it performs no provider, network, runtime, credential, filesystem-write, or GitHub operation.

`scripts/multi-agent-operator/provider-contract.mjs` validates exact schemas and fails closed on
unknown or missing fields. A capability snapshot records provider and adapter identity, availability,
risk classes, provider requirements, actions, roles, repository coverage, concurrency, cancellation,
artifact/evidence support, and service compatibility. Every adapter must state
`authorityMintingAllowed=false`.

`evaluateProviderDispatch` validates the Work Order envelope and requires an exact match across:

- selected provider identity;
- risk class;
- every provider requirement and allowed action;
- requested team role;
- every repository;
- availability, capacity, supported cancellation/artifact/sanitized-evidence surfaces, and service
  compatibility.

Any gap returns `PROVIDER_DISPATCH_UNSUPPORTED`. A match returns
`PROVIDER_DISPATCH_ELIGIBLE` and `capabilityMatched=true`. Both outcomes retain
`dispatchAllowed=false`, `dispatchPerformed=false`, `requiresIndependentAuthorityMatch=true`, and
`authorityGranted=false`: eligibility is only a provider-contract validation result and cannot
dispatch work or create authority.

## Provider response boundary

The common response validator covers four exact artifacts:

- `PROVIDER_STATUS`;
- `PROVIDER_CANCELLATION`;
- `PROVIDER_ARTIFACT` with a content hash and safe relative POSIX path;
- `PROVIDER_EVIDENCE` with bounded sanitized attributes and no raw provider output.

All responses require `sanitized=true` and `authorityGranted=false`. Evidence rejects secret-,
credential-, session-, keyring-, token-, cookie-, authorization-, and raw-output-like attribute keys,
including canonical aliases such as `apiKey`, plus assignment-shaped secrets of any nonempty length
(quoted or unquoted and with common `:`/`=` delimiter spacing), bearer/basic material,
credential-shaped tokens, unsafe control characters, excessive nesting/items, and an asserted
raw-output flag. Ordinary security prose without an assignment is retained. The validator does not
treat a provider assertion as authority or lifecycle truth.

Provider responses also obey a semantic matrix: `FAILED`, `CANCELLED`, and `UNKNOWN` require a typed
reason; non-failure states require a null reason; cancellation is acknowledged if and only if the
provider state is `CANCELLED`; and artifact responses require `SUCCEEDED`. Contradictory response
assertions fail closed.

## Adversarial proof

`tests/multi-agent-provider-contract.test.ts` covers:

- missing requirements, actions, roles, repositories, and risk support;
- unavailable, zero-capacity, and non-service-compatible providers;
- capability and response attempts to mint authority;
- all four response interfaces;
- sensitive and nested-sensitive evidence keys;
- one-character through long residual secret assignments, delimiter variants, ordinary-prose
  non-regressions, and credential-shaped summary/attribute values;
- unsafe artifact traversal, raw-output inclusion, and unknown fields;
- failed-state reason, cancellation acknowledgement/state, and artifact/state contradictions;
- deterministic machine-readable CLI success and typed failure.

The CLI accepts only `capability`, `dispatch`, or `response` plus one readable JSON file. It emits
canonical JSON and performs no side effect.

## Boundary retained

This Work Order defines and validates a common adapter boundary. It does not claim that Codex,
Claude, or another provider has passed conformance; does not implement dispatch; does not activate the
rejected local runtime; and does not inspect credentials or provider output. Provider conformance and
adapters remain later Work Orders.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
