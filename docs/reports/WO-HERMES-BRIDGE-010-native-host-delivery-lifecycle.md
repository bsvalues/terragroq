# WO-HERMES-BRIDGE-010 - Native Host Delivery Lifecycle

## Result

The Codex App Server task is now the bounded code and file-review engine. The native Hermes host owns validators, exact-path staging, commit, push, pull-request creation, exact-head review requests, bounded review remediation dispatch, eligible merge, merged-main verification, and owned cleanup.

## Live finding

The durable Codex task successfully created the Home operational-radar implementation and launched independent subagents, but every native command attempt failed before process start with `CreateProcessAsUserW error 5`. Repeated provider cooldowns preserved continuity but could not advance validation or publication.

## Correction

This change does not retry or reuse issue #357. It uses the already activated Hermes native process for allowlisted repository commands and leaves Codex responsible for implementation and remediation through the supported App Server file surface.

Validation runs in the owned worktree with a junction to the workspace's existing dependency installation. Only two build environment flags are allowed. Generated validation artifacts are removed only from the owned worktree before cleanup.

On Windows, allowlisted tools are resolved to native executables without a command shell. `npm` and `npx` run through the installed Node.js CLI entry points, preserving separated arguments and the command allowlist.

## Safety

TerraFusion, Property Workbench, TerraPilot, county/PACS systems, protected data, production mutation, secrets, paid overages, destructive Git, releases, tags, and foreign cleanup remain blocked. Owner-touch counters remain authoritative and must stay zero.
