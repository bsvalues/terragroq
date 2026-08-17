# WO-WILLIAMOS-CHANGED-PATH-IGNORED-001 — reservation checks are blind to ignored paths

**Status:** OPEN · **Raised:** 2026-08-17 · **Source:** P3 independent review
(`review-2026-08-17-t1-indep-opus5`), finding Q1.1, and its closure-verification refinement
**Review record:** [`../reports/hermes-kernel-p3-independent-review-2026-08-17.md`](../reports/hermes-kernel-p3-independent-review-2026-08-17.md)

## The gap

`inspectWorkingTreePaths` / `inspectChangedPaths` in `scripts/hermes-bridge/repository-lifecycle.mjs`
run `git status --porcelain=v1 -z --untracked-files=all` **without `--ignored`**. Writes to ignored
paths — `.env`, `build/`, `coverage/`, `.venv/`, `.codex/` — are therefore never enumerated and never
checked against the contract's reservations.

**Containment still holds:** those writes stay inside the owned worktree, and the reviewer found no
path from an ignored write to influencing host-side validation (vitest loads no dotenv; its only
setup file is `tests/setup/webstorage.ts`). What does **not** hold is the *reservation* claim. The S2
spec has been corrected accordingly: it is "every tracked or untracked changed path", not "every
changed path".

## Why the obvious fix is wrong

Adding `--ignored` to those functions is **not** the fix. They are shared with the Codex lane, and
ignored files include build output and the validation `node_modules` junction that
`ensureValidationDependencies` creates — so the change would trip reservation checks for both lanes on
every run.

## The shape that is likely right

Put it in the **kernel client**, not the shared function. `assertNoReparsePoints`
(`scripts/hermes-bridge/hermes-kernel-client.mjs`) already walks the entire worktree after every turn.
Having that same sweep record ignored-path creations **for the resident lane only** closes the
reporting half without touching the Codex lane at all.

Decide separately whether an ignored-path write should be reported, or should wall.
