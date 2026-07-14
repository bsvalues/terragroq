# WO-MAO-004 Executable Capability Inventory

## Result

`PASS / INVENTORY_PUBLISHED / EXECUTION_FAIL_CLOSED`

## Delivered

- One machine-readable inventory with the canonical `PROVEN`, `PILOT_AUTHORIZED`,
  `AVAILABLE_UNPROVEN`, `UNAVAILABLE`, and `REJECTED` vocabulary.
- An execution class distinct from surface status, so governance, kernels, providers, adapters, model
  capacity, and executable workers cannot be conflated.
- Exact current classifications for WilliamOS, the completed Codex decision model, the serial kernel,
  the rejected nested-Codex adapter, hosted Codex, Codex subagents, Claude Code, Brain Council, Agent
  Forge, Hermes, and Ollama.
- A deterministic dispatch evaluator that denies missing, non-executable, unauthorized, adapterless,
  grantless, or trust-gateless entries.
- Inventory validation for duplicate IDs, missing evidence, unsupported executable claims, and inactive
  entries represented as executable.

## WO-MAO-004 snapshot before WO-MAO-007 promotion

```text
EXECUTABLE_WORKER_COUNT=0
LOCAL_NESTED_CODEX_ADAPTER=REJECTED
HOSTED_CODEX_SESSION=AVAILABLE_UNPROVEN
CODEX_NATIVE_SUBAGENT_TEAM=AVAILABLE_UNPROVEN
CLAUDE_CODE_PROVIDER=UNAVAILABLE
HERMES_WORKER=UNAVAILABLE
BRAIN_COUNCIL=PROVEN_NON_EXECUTABLE
AGENT_FORGE=PROVEN_NON_EXECUTABLE
OLLAMA=PROVEN_MODEL_CAPACITY_ONLY
```

At the WO-MAO-004 boundary no provider or named agent was represented as active. WO-MAO-007 subsequently
marks only the supported hosted Codex session and native team roles
`PILOT_AUTHORIZED / WORKER_CANDIDATE / coordinationEligible=true`. WilliamOS registry dispatch still
denies them because no durable adapter exists. This snapshot remains evidence of the fail-closed
transition rather than the current inventory state.

## Evidence

- `components/operator/multi-agent-capability-registry.ts`
- `docs/governance/executable-capability-inventory.md`
- `tests/multi-agent-capability-registry.test.ts`

## Safety

- No runtime, adapter, provider, queue, portfolio, entrypoint, or worker-registry behavior changed.
- No provider was invoked, enabled, authenticated, retried, or diagnosed.
- No raw credential, auth cache, token, session, or provider output was inspected.
- Runtime activation remains disabled; issues #357 and #358 were not executed or modified by this Work
  Order.

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
