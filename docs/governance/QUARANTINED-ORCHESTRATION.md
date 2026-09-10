# Quarantined Orchestration Register

**Status:** QUARANTINED / NON-CANONICAL FOR PRODUCT DIRECTION

The WilliamOS multi-agent/orchestration/control-plane corpus is preserved for historical evidence, debugging, and selective component reuse. It is not the default architecture for current product work.

This includes, at minimum, the design direction embodied by:

- `docs/governance/multi-agent-operator-playbook.md`
- `docs/governance/sovereign-runtime-and-review-supersession.md`
- orchestration/queue/authority state-machine programs built primarily to realize those documents
- HERMES resident-runtime work that exists to operate that control-plane model

Documents inside this corpus may still contain labels such as `ACTIVE`, `CONTROLLING`, `TARGET OPERATING MODEL`, or similar. Those historical labels do **not** override the current root `PRODUCT_EXECUTION.md` contract for product execution.

## What quarantine means

Quarantine does **not** mean delete.

Preserve:
- code and migrations already relied on by running surfaces;
- historical evidence and incident records;
- useful, independently valuable components;
- security controls that protect real current risks.

Do not:
- extend the orchestration stack merely to make it internally complete;
- require new product features to adopt its abstractions;
- assume a queue, Work Order, grant, receipt, runtime loop, or governance artifact is necessary because an earlier program made it necessary;
- spend the active product lane repairing this corpus unless a specific current user-visible acceptance step cannot proceed without the repair.

## Reuse test

Before reusing a quarantined component, answer:

1. What current user-visible product need does it satisfy?
2. Is it simpler/safer to reuse than to provide a thin direct adapter?
3. Does reuse create new control-plane prerequisites that can hold the product hostage?

If #1 has no concrete answer, do not reuse it.
If #3 is yes, prefer the simpler product path unless the owner explicitly chooses otherwise.

## Current positive direction

WilliamOS is a human-facing operating environment first: Spaces, files, editors, running applications, conversations/agents, visible execution, continuity, and useful product interaction.

Governance and orchestration support those experiences only where necessary for safety and reliability.

They do not define the experience.

See root `PRODUCT_EXECUTION.md` for the controlling execution contract.