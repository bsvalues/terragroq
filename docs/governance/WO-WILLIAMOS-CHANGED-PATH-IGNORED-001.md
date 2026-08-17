# WO-WILLIAMOS-CHANGED-PATH-IGNORED-001 — reservation checks are blind to ignored paths

**Status:** PARTIALLY CLOSED 2026-08-17 — reporting half done, walling decision still open ·
**Raised:** 2026-08-17 · **Source:** P3 independent review
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

## Done 2026-08-17 — the reporting half

`runTurn` in `scripts/hermes-bridge/hermes-kernel-client.mjs` now snapshots ignored paths
(`git status --porcelain=v1 -z --ignored=matching --untracked-files=all`) **before and after** the
turn, and records the difference on the turn as `ignoredPathsCreated`.

- Snapshotting both sides means pre-existing ignored content — the validation `node_modules` junction
  included — is never reported; only what the turn actually created.
- `repository-lifecycle.mjs` is **untouched**, so the Codex lane is unaffected. This is the placement
  the reviewer recommended.
- An unusable snapshot records `null` rather than an empty list, so "could not tell" never reads as
  "clean turn".
- **Reports, does not wall.** Walling today would fail runs that are legitimate under every control
  the lane actually enforces.

Tests: `tests/hermes-kernel-client.test.ts` covers the created-paths diff, the `null` case, and the
exact git argv of both probes.

## Still open

Whether an ignored-path write should be **fatal**, and if so under what contract. Evidence is now
being collected on every turn, so that decision can be made against real data instead of speculation.
The obvious candidates — a kernel writing `.env` or into `.codex/` — are not currently distinguished
from a build dropping files into `coverage/`.
