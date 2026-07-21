# WO-HERMES-BRIDGE-005 - Interactive Host Remediation

## Result

The live bridge proved that Task Scheduler could host Codex App Server file edits but could not
provide the interactive Windows token required by Codex native command execution. Every validator
and Git operation failed before process start with `CreateProcessAsUserW` error 5. The bridge was
disabled, the owned Home feature worktree was preserved, and no owner operation was requested.

## Correction

- Replace repeated Task Scheduler execution with one hidden, single-instance PowerShell supervisor
  launched in William's interactive, non-elevated Windows session.
- Install a per-user Startup shortcut so the same bounded supervisor returns at the next owner
  logon without storing credentials or requiring an open Codex task.
- Preserve the existing activation file, durable fencing leases, checkpoints, owner-touch counters,
  repository allowlist, reservation checks, and immediate kill script.
- Record and verify the exact supervisor PID, host, nonce, workspace, and script path before shutdown.
- Reconcile an empty `turn/completed` payload through durable `thread/read` history so progress
  commentary cannot be mistaken for the schema-bound final result.

## Proof Boundary

The replacement continues to use `codex app-server --stdio`. It does not call `codex exec`, does not
use `scripts/runtime-operator`, and does not retry or wrap rejected issue #357. TerraFusion, Property
Workbench, TerraPilot, county/PACS systems, protected data, paid overages, destructive actions,
secrets inspection, and unrelated production mutation remain blocked.

The remediation is not certified by this report alone. It passes only after the preserved ordinary-
language Home outcome resumes under the interactive supervisor and completes tests, review,
remediation, merge, and merged-main verification with all owner-touch counters at zero.
