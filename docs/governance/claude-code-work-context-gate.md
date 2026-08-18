# Claude Code's work-context gate

Claude Code's attachment point for the shared `WORK_CONTEXT_RECEIPT` contract (#831, landed #834).

## Why it is a hook and not an instruction

Codex and AEGIS receive work as packets, so their gate sits at the packet/invoker chokepoint. Claude
Code has no packet — it edits files directly — so the equivalent chokepoint is where tools are
granted. A rule written in a prompt is a rule the model can rationalise past under time pressure,
which is the exact failure the receipt design names: *prose loses to convenience every time*. A
`PreToolUse` hook is executed by the harness before the tool runs and is not something the model can
decline.

## What it does

`.claude/settings.json` registers `scripts/governance/work-context-hook.mjs` on
`Edit|MultiEdit|Write|NotebookEdit|Bash|PowerShell`. On each call it:

1. Classifies the call. Reads are never gated. File-mutating tools are gated; shell commands are
   gated only when they publish, rewrite history, or destroy (`git commit/push/merge/rebase`,
   `git reset --hard`, `gh pr create/merge`, `gh release create`, `npm publish`, `rm -rf`,
   `Remove-Item`). Gating every shell command would relocate the work to whatever is not gated.
2. Loads `.williamos/work-context.json` (gitignored, per-lane).
3. Verifies it with **`lib/governance/work-context-receipt.ts` itself** — the same function the HTTP
   path calls, imported through a small alias loader, not a copy. A second validator would be the
   second source of truth the contract exists to prevent.
4. Re-measures current `origin/main` and the doctrine digest, so a receipt cannot outlive its premise.
5. Checks the target file lies inside the lane's `reservedPaths`.

Failure exits 2 with the failed premise on stderr, which is what makes Claude Code block the call.

## Establishing context

```bash
npm run work-context -- --work-order WO-EXAMPLE-001 --parent-outcome "the outcome this serves" --authority A2_IMPLEMENT --reserve lib/fabric --reserve tests --subsystem none-found --topology canonical-registry --remaining "what the parent still needs"
```

Blank premises are refused rather than accepted — a receipt obtainable by supplying blanks is a
rubber stamp. Editing the receipt by hand does not work: the facts are hashed into the token, so
widening `reservedPaths` invalidates it (verified).

Two exemptions exist and are deliberately narrow: paths outside the project root (scratch files are
not repository mutations), and the receipt file itself (otherwise context could never be established).

## What this slice proves, and what it does not

**Proves:** a complete, currently-valid premise exists before any mutation, and the mutation is inside
the declared reservation.

**Does not prove:** that the receipt was issued by the ledger. Issuance is recorded server-side by
`POST /api/governance/work-context`, and `requireWorkContext()` checks that ledger; this hook
re-derives from the local claim. So it stops drift, staleness and scope creep — not a determined
forger. Closing that gap is the next increment.

**Known wording wart:** a tampered receipt reports `FAILED_STALE_MAIN` ("main, the work order, or
doctrine has moved"), because any mismatch lands in that branch of the shared validator. The refusal
is correct; the sentence is misleading. Left alone here rather than edited, since the validator is
#834's surface.
