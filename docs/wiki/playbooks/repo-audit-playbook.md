# Repo Audit Playbook

Use this playbook before governed repo work.

## Checklist

1. Confirm branch and `origin/main`.
2. Confirm worktree status.
3. Identify changed files.
4. Identify unrelated files.
5. Confirm packet base vs current base.
6. Confirm scoped paths.
7. Run focused tests.
8. Run full tests.
9. Run build.
10. Check PR status if opened.
11. Run production health/readiness checks if scoped.
12. Record safety posture.

## Safety

Do not stage unrelated files. Do not clean unrelated work. Do not infer authority from passing tests.
