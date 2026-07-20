# WO-OWNER-OUTCOME-004 — No-Idle Resolver Invariant

## Status

`PENDING_AFTER_WO_OWNER_OUTCOME_003`

## Invariant

The portfolio resolver must not return `NO_APPROVED_EXECUTABLE_PROGRAM` or route to `NO_ACTIVE_PROGRAM` when all of the following are true:

1. a recorded owner outcome remains incomplete;
2. bounded WilliamOS-native R0/R1 work remains useful;
3. dependencies are satisfied;
4. the work remains inside standing authority;
5. no typed safety wall exists.

When those conditions hold, the resolver must select or generate the next bounded Work Order chain and continue without routine owner contact.

## Negative Boundaries

The invariant does not authorize Property Workbench, TerraPilot, county/PACS, TerraFusion, production, secrets, spending, runtime activation, rejected issue `#357`, or destructive scope.
