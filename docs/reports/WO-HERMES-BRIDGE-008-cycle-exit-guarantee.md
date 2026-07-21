# WO-HERMES-BRIDGE-008 - Cycle Exit Guarantee

## Result

The one-shot Hermes CLI now flushes its terminal JSON record and exits with the command result code. This guarantees that a completed cycle returns control to the resident supervisor instead of retaining the supervisor's child process after a retryable provider result.

## Live finding

The activated supervisor reclaimed outcome `5` with fencing token `9` and recorded `RETRYABLE_PROVIDER_WALL` with preserved worktree changes and zero owner touches. The App Server child stopped, but the one-shot CLI process remained alive, preventing the supervisor from starting its next cycle.

## Boundary

The runtime was disabled with the owned-process kill switch before this remediation. No outcome content, feature worktree, credentials, blocked system, or foreign process was changed.
