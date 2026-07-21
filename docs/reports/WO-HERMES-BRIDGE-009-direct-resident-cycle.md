# WO-HERMES-BRIDGE-009 - Direct Resident Cycle

## Result

The resident Hermes supervisor now invokes the one-shot Node CLI directly. A nested PowerShell process no longer sits between the resident supervisor and a cycle.

## Live finding

After PR #433 made the Node CLI exit deterministically, the nested `run-cycle.ps1` host remained alive after its Node child had stopped. That prevented the supervisor from reaching its next interval even though the durable provider retry was recorded correctly.

## Boundary

The owned-process kill switch disabled Hermes and stopped the resident process tree before remediation. Outcome `5`, its durable retry state, and its owned feature worktree remain preserved. No owner touch, blocked system, secret, foreign process, or rejected issue #357 adapter was involved.
