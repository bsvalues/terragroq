# 13 — Stage Placement Acceptance

## Goal

Prove WilliamOS can place different stages of one owner outcome on different eligible fabric resources without creating a second workflow engine or exposing infrastructure choices to the owner.

## Scenario

Use one non-sensitive development/research outcome whose stages include at least:

1. retrieval/context gathering;
2. reasoning;
3. repository implementation or bounded transformation;
4. validation;
5. review;
6. evidence persistence.

Expected placement may differ by current measured capability; acceptance does not hard-code node names where evidence recommends otherwise. However the test must exercise at least two resident nodes.

## Required invariants

- one Project/Thread remains canonical;
- existing HERMES/Work Order/AEGIS lifecycle remains the only scheduler/authority path;
- every stage has explicit input/output artifact contracts;
- data classification/egress applies at every transfer;
- placement decisions account for transfer/startup cost when material;
- no bulk dataset/workspace copy occurs solely because another node is faster;
- cache loss does not lose canonical work;
- owner never chooses nodes/models/runtimes for ordinary execution;
- cross-node failure yields typed recovery/re-placement.

## Mandatory chaos cases

### OMEN disappearance

If an eligible opportunistic stage is placed on OMEN, disconnect/close OMEN during bounded preemptible work. WilliamOS must re-place or restart that stage without treating OMEN as a resident-system failure or losing Thread context.

### Link degradation

Artificially make one material cross-node link unavailable/degraded. Placement must either remain local, select another eligible stage placement, or enter typed WAITING; it must not silently stream data across an unmeasured alternative.

### Cache loss

Delete/discard a derived cache used by a stage. Reconstruct from canonical source/context and continue with performance degradation only.

## Evidence

Inspect/Technical must show after completion:

- stage graph;
- each PlacementDecision;
- node/model/runtime where applicable;
- transfer volumes and relevant link evidence;
- fallback/re-placement events;
- final artifacts/tests/review;
- owner-touch count.

## PASS

`WHOLE_FABRIC_STAGE_PLACEMENT: PASS` requires successful completion with zero routine infrastructure owner actions and no parallel scheduling mechanism.
