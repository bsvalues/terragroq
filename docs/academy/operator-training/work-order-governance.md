# Work Order Governance

Work Orders are the unit of controlled change in WilliamOS.

## `/goal`

`/goal` defines intent. It states the purpose, success state, allowed work, blocked work, authority boundaries, evidence requirements, and first loop.

It does not execute by itself.

## `/loop`

`/loop` governs progress. It lists the authorized batch, Work Orders, execution order, validation, and stop conditions.

Codex operates the loop. The Owner is not the courier.

## Work Order Boundaries

A Work Order must define:

- Goal.
- Deliverables.
- Allowed scope.
- Blocked scope.
- Validation.
- Return format.
- Next recommended Work Order.

## Completion Reports

Completion reports must record:

- Result.
- Work Order or batch.
- Files changed.
- Validation.
- Production verification if scoped.
- Safety posture.
- Next recommended work.

## Stop Conditions

Stop if work requires authority outside the packet, destructive action, secrets, DB/schema change, env/package change, cloud/Vercel change, runtime control, autonomy, or validation failure that cannot be fixed in scope.
