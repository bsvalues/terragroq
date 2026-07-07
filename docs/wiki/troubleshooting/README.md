# Troubleshooting Index

This index supports operator-safe diagnosis.

## Validation Failure

Capture the failing command and output. Fix only inside scope. If the fix requires blocked scope, stop.

## Build Failure

Classify whether the failure is source-caused or environment/tooling-caused. In this repo, stale local `.next` artifacts can be removed only after verifying the path is inside the workspace.

## PR Behind Main

Fetch latest `origin/main`, rebase or merge only if safe, rerun validation, and avoid unrelated changes.

## Unresolved Review Threads

Resolve only scoped issues. Stop if review requires product or authority decisions outside the packet.

## Production Health Failure

Do not deploy or mutate production. Record the failing endpoint and stop if production action is required.

## Readiness Failure

Classify dependency, auth, environment, and route readiness. Do not change secrets, env, DB, or cloud settings without authority.

## Scope Violation

Stop. Return the stop-condition format and list actions not taken.
