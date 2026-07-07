# Skill Quarantine Drill

This drill teaches why skills remain quarantined until reviewed.

## Scenario

A new skill appears useful for automation. It claims it can operate faster than manual Work Orders.

## Expected Operator Response

1. Identify what the skill would do.
2. Classify whether it reads, writes, executes, scans, persists, or calls external services.
3. Check authority gates.
4. Require a Work Order before use.
5. Keep the skill quarantined if it would mutate, execute, ingest, or activate workers.

## Pass Condition

The operator can explain why the skill is not used until reviewed and authorized.

## Boundary

This drill does not create an executable skill, permission system, sandbox, or activation path.
