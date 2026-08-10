# WilliamOS Execution Fabric bounded dispatch runtime 001

Issue: `#538`
Phase: `3 - bounded dispatch v0.2`
Status: `CONTAINED / HARDENED / EXECUTION_DISABLED`

## Result

The first consumable Phase 3 runtime boundary is implemented for exactly one class and node:

```text
TEMPLATE: hermes.local-llm-inference.v1
WORKLOAD_CLASS: LOCAL_LLM_INFERENCE
NODE: hermes-node
ADAPTER: resident-hermes-loopback-ollama-v1
MODEL_ALLOWLIST: llama3.2:3b
NETWORK: loopback-only
STORAGE: none
RISK: R1
MAXIMUM_ATTEMPTS: 1
```

The first activation was consumed by one real HERMES POST but rejected for incomplete durable
evidence. It is permanently `CONSUMED_REJECTED` and cannot be replayed. The runtime policy is now
disabled while the hardened durable ledger and a separately reviewed replacement scope are prepared.

## Trust and execution sequence

Before one invocation, the runtime requires all of the following:

1. exact in-process RFC 8785 pinned-evidence replay of a still-fresh Phase 1 placement receipt,
   bound to the reviewed reference-verifier digest without relying on a host Python launcher;
2. exact Agent Forge permission bytes for resident HERMES;
3. an exact reviewed, non-active authority-scope artifact retained in its reviewed commit;
4. a separate later active authority-registry entry whose complete bytes are on trusted `main`;
5. exact Work Order, input, limits, template, node, risk, and single-attempt scope bindings;
6. an exact request binding retained in the reviewed scope;
7. a pre-provisioned, scope-bound durable-ledger genesis;
8. an atomic resident-HERMES lease with monotonic fencing;
9. a durable request-intent transition before invocation;
10. a second freshness and authority check after acquisition and before invocation;
11. an atomically persisted completion or terminal uncertainty record before stdout.

The runtime then selects the adapter in code and calls the fixed loopback model surface with
redirects rejected. Caller
input cannot supply an executable, model-service address, ledger location, alternate node,
interpreter, registry, clock, retry, or replacement policy. A claimed request is consumed even if
execution fails, so recovery cannot silently duplicate work.

## Safety boundary

```text
SCHEDULER: OFF
AUTONOMOUS_DISPATCH: FALSE
ACTIVE_AUTHORITY_REGISTRY_ENTRIES: 0
LIVE_DISPATCH_001_PERFORMED: TRUE / UNCERTIFIABLE
EXTERNAL_PROVIDER_ACCESS: FALSE
ARBITRARY_SHELL: ABSENT
SILENT_REPLACEMENT: FALSE
AEGIS_ADAPTER: ABSENT
```

Agent Forge is the permission source. Brain Council has no authority role. GitHub retains reviewed
scope, activation, and result evidence; it does not schedule or select work.

## Validation

- Execution Fabric family, including durable state, fencing, replay, and placement: `305/305 PASS`;
- full repository suite with the required RFC 8785 Python path: `2,978 passed / 2 skipped / 2
  unrelated failures`; both failures reproduce in isolation in the existing Atlas PowerShell fixture
  because its child process does not exit;
- in-process pinned-verifier replay and tamper rejection: `PASS`;
- Node syntax checks: `PASS`;
- production build: `PASS` (existing Better Auth environment and missing optional ESLint-plugin
  warnings only);
- `git diff --check`: `PASS`.

## Consumed first attempt

`WO-EF-DISPATCH-001` produced one observed HERMES loopback POST at
`2026-08-10T16:21:26.702Z`, but no durable completion receipt survived. The retained claim and
transport observation are recorded under `docs/reports/bounded-dispatch/`. Success is not inferred
from HTTP 200, and replay is forbidden.

## Successor

The next automatic successor is a separate reviewed non-active scope for one fixed HERMES inference
request. After that scope merges, a future-dated activation must merge before its effective time.
Only then may the resident wrapper generate a fresh receipt, acquire the single-use claim, and
produce the first genuine bounded-dispatch result evidence.

```text
HERMES_BOUNDED_DISPATCH_V0_2: PENDING_SEPARATELY_REVIEWED_REPLACEMENT_PROOF
OWNER_ACTION_REQUIRED: FALSE
```
