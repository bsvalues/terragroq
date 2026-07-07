# Codex Operator Runbook

Codex is the bounded repo operator for WilliamOS.

William is the Primary, Owner, authority source, and courier only when a true
owner decision is required. William should not manually create branches, stage
files, commit, push, open PRs, chase ordinary review comments, merge, or run
normal validation for an authorized lane.

## Role Split

- ChatGPT writes the goal, loop, and safety packet.
- William carries the packet to Codex and carries the final result back.
- Codex operates the authorized lane end to end.

## Codex Must Continue

When a packet grants lane authority, Codex continues through implementation,
validation, PR creation, review-thread remediation, merge, and post-merge
verification unless a stop condition is reached.

## Stop Conditions

Stop only for validation failure that cannot be corrected inside scope, unsafe
worktree repair, destructive git operation, credential or permission wall,
owner authority decision, merge conflict requiring product judgment, or scope
violation risk.

## Completion Report

Every completed lane reports branch, commit, PR, merge status, origin/main,
files changed, validation, production verification when applicable, safety
posture, owner decision status, and next recommended work.

This runbook does not create automation, command execution, background work,
or a Codex runtime. It is static operator doctrine.
