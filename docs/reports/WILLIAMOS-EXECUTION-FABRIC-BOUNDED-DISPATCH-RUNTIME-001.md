# WilliamOS Execution Fabric bounded dispatch runtime 001

Issue: `#538`
Phase: `3 - bounded dispatch v0.2`
Status: `IMPLEMENTED / FAIL_CLOSED / AUTHORITY_NOT_ADMITTED`

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

This implementation does not make that template active. The checked-in bounded-dispatch authority
registry is empty. Production preparation therefore returns `AUTHORITY_NOT_ADMITTED` and cannot
claim or invoke work.

## Trust and execution sequence

Before one invocation, the runtime requires all of the following:

1. exact in-process RFC 8785 pinned-evidence replay of a still-fresh Phase 1 placement receipt,
   bound to the reviewed reference-verifier digest without relying on a host Python launcher;
2. exact Agent Forge permission bytes for resident HERMES;
3. an exact reviewed, non-active authority-scope artifact retained in its reviewed commit;
4. a separate later active authority-registry entry whose complete bytes are on trusted `main`;
5. exact Work Order, input, limits, template, node, risk, and single-attempt scope bindings;
6. an atomic resident-HERMES claim of the request digest;
7. a second freshness and authority check after the claim and before invocation.

The runtime then selects the adapter in code and calls the fixed loopback model surface. Caller
input cannot supply an executable, model-service address, ledger location, alternate node,
interpreter, registry, clock, retry, or replacement policy. A claimed request is consumed even if
execution fails, so recovery cannot silently duplicate work.

## Safety boundary

```text
SCHEDULER: OFF
AUTONOMOUS_DISPATCH: FALSE
AUTHORITY_REGISTRY_ENTRIES: 0
LIVE_DISPATCH_PERFORMED: FALSE
EXTERNAL_PROVIDER_ACCESS: FALSE
ARBITRARY_SHELL: ABSENT
SILENT_REPLACEMENT: FALSE
AEGIS_ADAPTER: ABSENT
```

Agent Forge is the permission source. Brain Council has no authority role. GitHub retains reviewed
scope, activation, and result evidence; it does not schedule or select work.

## Validation

- bounded runtime, static dispatch-contract, and Phase 2 placement suites: `104/104 PASS`;
- Execution Fabric family excluding the host-blocked pinned-Python suite: `283/283 PASS`;
- legacy external-Python verifier suite: `15` tests blocked before test logic by the host's broken
  Python launcher; the bounded runtime no longer consumes that launcher;
- in-process pinned-verifier replay and tamper rejection: `PASS`;
- Node syntax checks: `PASS`;
- production build: `PASS` (existing Better Auth environment warnings only);
- `git diff --check`: `PASS`.

## Successor

The next automatic successor is a separate reviewed non-active scope for one fixed HERMES inference
request. After that scope merges, a future-dated activation must merge before its effective time.
Only then may the resident wrapper generate a fresh receipt, acquire the single-use claim, and
produce the first genuine bounded-dispatch result evidence.

```text
HERMES_BOUNDED_DISPATCH_V0_2: PENDING_GENUINE_SINGLE_SHOT_PROOF
OWNER_ACTION_REQUIRED: FALSE
```
