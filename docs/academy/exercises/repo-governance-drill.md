# Repo Governance Drill

This drill teaches repo-safe work.

## Drill Steps

1. Inspect the current branch and `origin/main`.
2. Check worktree status.
3. Identify unrelated untracked or dirty files.
4. Read the packet scope.
5. Change only scoped files.
6. Run focused validation.
7. Run full validation.
8. Open a PR if changes are made.
9. Merge only when checks are green and the packet authorizes merge.
10. Return the completion report.

## Fail Conditions

- Staging unrelated files.
- Treating stale base text as current truth without reconciliation.
- Skipping validation.
- Expanding into blocked scope.
- Using the Owner as courier between listed Work Orders.
