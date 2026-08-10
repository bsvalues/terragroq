# WilliamOS Execution Fabric — Bounded Dispatch Proof 001

Status: `FAILED_CLOSED`

Work order: `WO-EF-DISPATCH-001`

Parent work order: `WO-EF-PLACEMENT-001` / GitHub issue #538

Authority: `issue-538-phase3-bounded-dispatch-001`

Target: `hermes-node`

Template: `hermes.local-llm-inference.v1`

## Genuine execution result

At `2026-08-10T16:21:02.842Z`, the resident HERMES runtime acquired the single-use claim for the exact reviewed scope. It acquired an exclusive runtime lease and attempted the fixed loopback Ollama request against `llama3.2:3b` using the pre-execution pinned placement receipt.

The model response did not contain the exact required marker. The runtime failed closed with `EXPECTED_MARKER_MISSING`, released the exclusive lease, and retained the one-use claim. It did not retry or substitute another model, node, endpoint, prompt, or authority.

## Safety evidence

- Scheduler activation: `false`
- Autonomous dispatch: `false`
- External provider access: prohibited by the reviewed scope
- Remote node access: prohibited by the reviewed scope
- Silent replacement: `false`
- Dispatch allowed after failure: `false`
- Runtime lease released: `true`
- Maximum attempts: `1` (consumed)

## Retained artifacts

- `docs/reports/bounded-dispatch/WO-EF-DISPATCH-001-receipt.json`
- `docs/reports/bounded-dispatch/WO-EF-DISPATCH-001-request.json`
- `docs/reports/bounded-dispatch/WO-EF-DISPATCH-001-claim.json`
- `docs/reports/bounded-dispatch/WO-EF-DISPATCH-001-result.json`

## Gate disposition

`HERMES_BOUNDED_DISPATCH_V0_2: PENDING_GENUINE_SUCCESS`

The attempt proves that the bounded runtime can admit an exact reviewed request, obtain a one-use claim and exclusive lease, invoke only the resident loopback adapter, and fail closed without retry or fallback. It does not prove successful bounded completion. A successor attempt requires a new independently reviewed authority scope; this consumed authority cannot be reused.
