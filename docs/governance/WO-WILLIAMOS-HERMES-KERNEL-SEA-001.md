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

## Scope — see the scoping document

**[`WO-WILLIAMOS-HERMES-KERNEL-SEA-001-scope.md`](WO-WILLIAMOS-HERMES-KERNEL-SEA-001-scope.md)**
(2026-08-17) carries the analysis. Headlines:

- **SEA does not exist** anywhere in this repo — doctrine only.
- **Disabling the `file` toolset buys nothing on its own**: `terminal` is a shell in `/workspace`, so
  `sed`/`python`/redirection still write. Toolsets are coarse, so dropping `file` also removes
  *reading*. That tension is the actual design problem.
- **Recommended: Option B, the out-of-loop adapter** §4 already sanctions — the kernel proposes
  structured edits, WilliamOS discards working-tree changes and applies only those. No image rebuild,
  no re-proving containment, host-side and unit-testable. Option A (in-kernel tool) means a new image,
  new digest pins, and plausibly re-running P2/P2b.
- ~~**Phase 0 is a probe, not code.**~~ **PHASE 0 RUN 2026-08-17 — PASS (n=1).**
  `williamos-qwen3-4b:64k` emitted a valid structured edit whose `oldText` matched byte-for-byte and
  occurred **exactly once**, and it did **not** write to the worktree when told not to. 1m 37s, 4 tool
  calls. Report: [`../reports/hermes-kernel-sea-phase0-probe-2026-08-17.md`](../reports/hermes-kernel-sea-phase0-probe-2026-08-17.md).
  The premise holds, so Option B is viable and this WO is "build SEA" rather than "fix the model".
  **But n=1 is not reliability** — repeat with multi-line `oldText`, a target string that appears more
  than once, multi-edit sets, and failure cases (the model must fail closed when the edit is
  impossible) before committing to Phase 1.
  Notable: the model's first tool call used a hallucinated filename (`Modelffile…`), got *File not
  found*, and self-corrected — the Pilot 0 failure mode, recoverable in-turn, and exactly what
  host-side `validate-oldText-exactly-once` catches deterministically.

## Original scope note

Introduce the SEA edit path for the resident lane and re-assert §4's acceptance criterion. Not a
blocker for pilot operation; **is** a precondition for any future claim that §4 is *satisfied* rather
than *deviated from*.

## Do not

Do not close this by rewording the deviation record. The deviation is accepted; the gap is real.
