# WilliamOS Agent Entrypoint

This file is the repository-wide agent entrypoint.

## Controlling product-execution doctrine

For product work, the controlling contract is [`PRODUCT_EXECUTION.md`](PRODUCT_EXECUTION.md).

The older multi-agent/orchestration/control-plane corpus is preserved but **QUARANTINED / NON-CANONICAL FOR PRODUCT DIRECTION**. In particular, do not treat these as the default architecture for new product work even where they still contain historical labels such as `ACTIVE`, `CONTROLLING`, or `TARGET OPERATING MODEL`:

- `docs/governance/multi-agent-operator-playbook.md`
- `docs/governance/sovereign-runtime-and-review-supersession.md`

See [`docs/governance/QUARANTINED-ORCHESTRATION.md`](docs/governance/QUARANTINED-ORCHESTRATION.md).

If older doctrine conflicts with `PRODUCT_EXECUTION.md` on product priority, lane scope, completion criteria, whether orchestration is required, or whether an adjacent infrastructure defect should interrupt a product lane, **`PRODUCT_EXECUTION.md` governs**.

Safety, security, legal constraints, and explicit owner decisions still govern. Quarantine is not permission to bypass real protections.

## Owner boundary

William is the owner, not the routine execution worker.

Agents own routine investigation, implementation, testing, browser verification, branches, commits, pushes, pull requests, review remediation, CI monitoring, cleanup, and recovery inside granted authority. Do not make William a shell/Git operator, credential courier, diagnostic courier, prompt courier, or routine approver.

Ask William only for a genuinely new material product/policy/authority decision that cannot be resolved inside existing authority.

## Product-first execution

The coordinator protects the fixed user-visible acceptance target.

A discovered adjacent defect does not automatically expand the mission. Before leaving the active product lane, determine whether the defect directly blocks the current user journey and whether a truthful bounded fixture/adapter can keep the product lane moving. If the product can continue, record the defect and continue the product.

Do not allow infrastructure, governance, orchestration, CI, agent architecture, or repository archaeology to consume a user-facing lane merely because those problems are real.

For UI/UX work, use the browser/product early and repeatedly. Tests and architecture do not substitute for a usable interface.

## Current W1 lane

Until the owner changes lanes, W1 is the WilliamOS UI/UX product lane:

`Open TerraFusion Space -> useful workspace -> browse project-bound files -> edit/save -> application pane behaves truthfully -> close/reopen -> same useful Space returns.`

TerraFusion is a workload used to exercise WilliamOS, not the W1 product-development lane. Do not drift into TerraFusion backend/runtime product work unless the owner explicitly changes lanes or the exact W1 browser step cannot continue and no truthful bounded fixture can unblock it.

## Multi-agent execution

Use coding agents as execution capacity, not paperwork generators.

For substantial work with independent lanes:

1. Keep one coordinator responsible for the fixed acceptance target.
2. Give builders non-overlapping bounded reservations.
3. Use separate reviewer/test contexts where useful.
4. Run independent product lanes in parallel rather than serializing them behind unrelated dependencies.
5. Integrate and continue until the actual user-facing acceptance target is satisfied or a genuinely unavoidable owner boundary is reached.

Agents may not expand scope or mint authority because they discovered an interesting dependency chain.

## Continuity / no archaeology loop

Previously verified facts remain valid until concrete new evidence contradicts them.

Do not restart broad archaeology, re-derive architecture, or rebuild governance context just because an agent/context changed. Resume from the last verified product state and investigate only the uncertainty blocking the current acceptance target.

## Runtime/provider availability

Optional providers must not become owner babysitting. If one provider is unavailable and another eligible capability exists, continue with the healthy capability.

Independent assurance is role separation, not vendor dependence.

Historical rejected adapters and safety findings remain rejected where still applicable; quarantine does not reactivate them.

## Instruction narrowing

Directory-local `AGENTS.md` files may narrow implementation details for their subtree. They may not:

- override `PRODUCT_EXECUTION.md` product priority/completion rules;
- redefine quarantined orchestration as the canonical product architecture;
- expand the active lane;
- create new authority;
- weaken real security/safety constraints.

## Core rule

> **Never let the control system become the product. Finish the user-visible thing.**
