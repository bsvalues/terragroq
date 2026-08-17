# WO-WILLIAMOS-HERMES-KERNEL-SEA-001 — route resident-lane edits through SEA

**Status:** OPEN · **Raised:** 2026-08-17 · **Source:** P3 independent review
(`review-2026-08-17-t1-indep-opus5`), condition C5 / deviation **D1**
**Deviation record:** [`hermes-kernel-v2-doctrine-deviations-2026-08-17.md`](hermes-kernel-v2-doctrine-deviations-2026-08-17.md)
**Doctrine:** [`WO-WILLIAMOS-HERMES-KERNEL-V1.md`](WO-WILLIAMOS-HERMES-KERNEL-V1.md) §4

## Why this exists

§4 requires the kernel's native file-edit toolset to be disabled and edits routed through SEA, with
acceptance: *"a worker edit lands only via SEA; an invalid edit rolls back with no partial write."*
v2 owned-worktree mode uses the native `file` toolset instead.

The review accepted that deviation for the pilot lane and **explicitly did not treat SEA as a
containment precondition** — §3 says in-process hooks are not the boundary, and `terminal` is in
`execution.allowedToolsets` regardless, so disabling `file` would not remove free-form editing.

**What is not compensated.** §4's criterion is about *reliability*, not containment: atomic apply,
verify, rollback, no partial write — motivated by small local models emitting literal diff markers or
hallucinated paths. WilliamOS re-deriving changed paths from git tells you *which* files moved; it
does not validate an edit, apply it atomically, or roll back a partial write. Today a botched edit
becomes a dirty worktree that fails validation and enters remediation.

## Scope

Introduce the SEA edit path for the resident lane and re-assert §4's acceptance criterion. Not a
blocker for pilot operation; **is** a precondition for any future claim that §4 is *satisfied* rather
than *deviated from*.

## Do not

Do not close this by rewording the deviation record. The deviation is accepted; the gap is real.
