# WO-WILLIAMOS-HERMES-KERNEL-SEA-001 — scope

**Date:** 2026-08-17 · **Status:** scoping only, nothing built
**Doctrine:** [`WO-WILLIAMOS-HERMES-KERNEL-V1.md`](WO-WILLIAMOS-HERMES-KERNEL-V1.md) §4
**Deviation being closed:** D1 in [`hermes-kernel-v2-doctrine-deviations-2026-08-17.md`](hermes-kernel-v2-doctrine-deviations-2026-08-17.md)

## What §4 actually demands

> *"disable the native file-edit toolset and route edits through SEA (model emits structured JSON →
> deterministic validate `old_text`-exactly-once → apply atomically → verify → bounded repair →
> fail-closed rollback). SEA is exposed as the sanctioned edit tool / an out-of-loop adapter.
> **Acceptance: a worker edit lands only via SEA; an invalid edit rolls back with no partial write.**"*

Note the motivation is **reliability**, not containment — Pilot 0 found small local models emit
literal diff markers, raw tool-call JSON as text, and hallucinated paths. Containment is §5's job and
is already satisfied. This is why the P3 reviewer ruled SEA **not** a promotion precondition.

## Current state (verified, not assumed)

| Fact | Source |
|---|---|
| SEA **does not exist** in this repo — doctrine only, no implementation | repo-wide search; the only `SEA` hits are this WO, the review docs, and substring matches on "**sea**m" |
| Kernel runs with `--toolsets file,terminal`, hardcoded | `runtime-hermes-agent/run_agent.py` |
| Same pair declared in config | `runtime-hermes-agent/config.yaml` → `toolsets: [file, terminal]` |
| Toolsets are **coarse**: `disabled_toolsets` names whole toolsets (`browser`, `code_execution`, `skills`, …). No read/write split is exposed | `config.yaml` |
| `terminal` is a local shell at `/workspace`, 300s timeout | `config.yaml` |
| Memory, skills, plugins, code_execution, delegation, web all already disabled | `config.yaml` |
| `run_agent.py` and `config.yaml` are **digest-pinned** — changing either needs a reviewed policy change in the same commit | `containment.deployedArtifactSha256` + provider test |
| Image is pinned by ID and was explicitly **not** rebuilt in S2 | S2 spec §8 "out of scope" |

## The trap that kills the naive plan

**Disabling the `file` toolset does not stop the model editing files.** `terminal` is a shell in the
worktree; `sed`, `python`, and `>` redirection all write. So "disable native file-edit" as literally
written buys nothing on its own — the reviewer made this same point when ruling SEA out as a
containment gate.

To make *"a worker edit lands only via SEA"* true you must remove **both** `file` and `terminal`
write paths. But the toolsets are coarse: dropping `file` also removes **reading**, and dropping
`terminal` removes the model's ability to inspect anything. A model that can neither read nor run
commands cannot propose a competent edit.

**This is the crux of the WO, and it is a design problem, not a coding one.**

## Option A — in-kernel SEA tool

Register SEA as a custom tool inside the kernel; disable `file` and `terminal`.

- Needs a tool the kernel can dispatch. Plugins are disabled and skills are a review-gated
  code-execution surface that WO §2 says is never auto-adopted — so this almost certainly means
  **changing the runner or the image**.
- Consequences: new image, new pinned image ID, new artifact digests, and **re-proving containment**
  — plausibly re-running P2 and P2b, since `OWNED_WORKTREE_CONFINEMENT_PROVEN` and
  `KERNEL_SESSION_CONTINUITY_PROVEN` are pinned to a specific build.
- Also needs a read path for the model, so some read-only file capability must exist or be built.

**Cost: high. Touches the one thing S2 deliberately never touched.**

## Option B — out-of-loop adapter (recommended)

§4 explicitly sanctions *"an out-of-loop adapter"*. The kernel **proposes**; WilliamOS **applies**.

1. Extend the turn output contract with an `edits: [{path, oldText, newText}]` array (the existing
   `HERMES_TURN_OUTPUT_SCHEMA` is already validated twice — client and orchestrator).
2. The prompt epilogue instructs: propose edits as JSON, do not write files.
3. After the turn, WilliamOS **discards** the worktree's working-tree changes and applies only the
   structured edits, with validate-`oldText`-exactly-once → atomic apply → verify → rollback.

Discarding is what makes the acceptance criterion literally true: *by construction* only SEA edits
land, even though the kernel still holds `file` and `terminal` for reading and inspection.

- **No image rebuild. No new containment evidence. No re-proving P2/P2b.**
- All host-side, in `hermes-kernel-client.mjs` / the orchestrator — deterministic and unit-testable
  without HERMES hardware, which matters given how much of this lane can only be proven on the host.
- Bonus: reservations become **exact**. Today `assertChangedPathsAllowed` re-derives paths from git
  and cannot see ignored paths (`WO-WILLIAMOS-CHANGED-PATH-IGNORED-001`); an explicit edit list is
  checkable before anything is written.

**Cost: moderate, and entirely inside code this project already owns.**

## Recommendation

**Option B**, in three phases, with a probe first.

> **PHASE 0 RESULT 2026-08-17: PASS (n=1).** The premise holds — the model emitted a valid structured
> edit, `oldText` byte-exact and occurring exactly once, and did not write when told not to. See
> [`../reports/hermes-kernel-sea-phase0-probe-2026-08-17.md`](../reports/hermes-kernel-sea-phase0-probe-2026-08-17.md).
> Option B is therefore viable. **n=1 is not reliability**: repeat with multi-line `oldText`, a string
> occurring more than once, multi-edit sets, and failure cases before Phase 1.

- **Phase 0 — probe (do this before committing to anything).** Can `williamos-qwen3-4b:64k` reliably
  emit a valid structured edit for a real reserved-path change? SEA's entire premise is that a small
  model that fails at free-form editing succeeds at structured JSON. **That is an assumption, not a
  finding.** Pilot 0 proved the failure; nobody has proven the success. One HERMES probe answers it.
  If the model cannot do this reliably, Option B collapses and A is no better — the WO would then be
  "improve the model or the prompt", not "build SEA".
- **Phase 1 — apply path.** Schema extension, validate/apply/verify/rollback, discard-then-apply,
  reservation check against the explicit edit list. Unit-testable with a fake invoker.
- **Phase 2 — enforcement.** Make the discard unconditional and prove no kernel-made write survives;
  record any discarded write as evidence (it is a signal the model ignored the contract).

## Acceptance, mapped to §4

| §4 requirement | How Option B satisfies it |
|---|---|
| model emits structured JSON | new `edits` array in the turn schema, validated twice |
| validate `oldText` exactly once | host-side, before any write |
| apply atomically | write to temp + rename per file, all-or-nothing across the edit set |
| verify | re-read and compare after apply |
| bounded repair | existing remediation loop, unchanged |
| fail-closed rollback | restore worktree from git on any failure |
| **an edit lands only via SEA** | discard working-tree changes before applying |
| **invalid edit → no partial write** | validate the whole set before applying any of it |

## Explicitly out of scope

Image or runner rebuild; CAPG changes; the read-only-file-toolset question (Option A's problem);
touching the Codex lane; anything that would invalidate `OWNED_WORKTREE_CONFINEMENT_PROVEN` or
`KERNEL_SESSION_CONTINUITY_PROVEN`.

## Risks and unknowns — stated, not papered over

1. **The core premise is unproven** (Phase 0 above). This is the single biggest risk and the reason
   to probe before building.
2. **I did not inspect the kernel's own source.** It lives on HERMES at
   `D:\HermesServices\williamos-hermes-agent\source{,-lf}`, not in this repo. Whether the CLI supports
   a read-only file toolset or custom tool registration without an image change is **unknown** — it
   would decide Option A's true cost, and I am not going to guess at it.
3. **Discarding kernel writes may degrade the model.** If it edits, then sees its edits vanish on the
   next turn of a resumed session, behaviour could get worse. Phase 0 should watch for this.
4. **Prompt budget.** Edits carry `oldText`/`newText` inline; large edits could approach
   `promptMaxChars` (60 000) on the return path. Needs a size bound and a typed wall.
5. **Multi-file atomicity across a crash** is best-effort: temp+rename per file is atomic per file,
   not across the set. Rollback covers the process-alive case; a mid-apply crash needs the existing
   git restore to catch it.
