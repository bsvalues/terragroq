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

## Activation: it starts enforcing on the NEXT session

Claude Code reads `.claude/settings.json` when a session starts. A session that was already running
when this file landed **is not gated** — its hook registry was built before the file existed.

This was verified rather than assumed, and the assumption was wrong: a write to a non-reserved path
went straight through in the session that introduced the hook, while piping the identical event into
the script by hand refused it correctly. Testing the script proves the logic; it does not prove the
harness is invoking it. To confirm enforcement is live, attempt a write outside the reservation in a
fresh session and check it is refused.

## Establishing context

```bash
npm run work-context -- --work-order WO-EXAMPLE-001 --parent-outcome "the outcome this serves" --authority A2_IMPLEMENT --reserve lib/fabric --reserve tests --subsystem none-found --topology canonical-registry --remaining "what the parent still needs"
```

Blank premises are refused rather than accepted — a receipt obtainable by supplying blanks is a
rubber stamp. Editing the receipt by hand does not work: the facts are hashed into the token, so
widening `reservedPaths` invalidates it (verified).

Two exemptions exist and are deliberately narrow: paths outside the project root (scratch files are
not repository mutations), and the receipt file itself (otherwise context could never be established).

## Provenance: a receipt is worth what its issuer is worth

| mode | issued by | authority checked | claim recorded | what the hook trusts |
|---|---|---|---|---|
| `ledger` | the cockpit, via `POST /api/governance/work-context` | yes, against an owner-recorded grant | yes, as a governance event | facts resolved **from the ledger**; the local file is just an opaque token |
| `local` | `establish-work-context` on this machine | no | no | the claims in the local file |

The mode is written into the receipt and printed on every issue, so the weaker one is never mistaken
for the stronger one. Under `ledger`, editing the local file widens nothing — the reservation the hook
enforces comes back from the governance event, not from disk. Under `local`, premises are still
complete and staleness is still automatic, but nothing checked authority and nothing recorded the
claim, so it stops drift and scope creep rather than a determined forger.

If a receipt claims `ledger` and the ledger cannot be read, the hook **refuses** — an unreadable
ledger must not become an open gate, which is the same reading `requireWorkContext()` already takes.
It never silently falls back to local checking, because a cockpit outage would then quietly weaken the
gate.

### Turning on ledger provenance

The cockpit authenticates an agent as an **enrolled device** (`lib/device-auth`), which is also the
direction the topology settled on: the client initiates a device-authenticated session, and its
durable identity is the enrolled credential rather than an address. That needs two things:

1. `WILLIAMOS_COCKPIT_CA` pointing at the cockpit authority's certificate. There is deliberately no
   "skip TLS verification" switch — this client exists to prove an identity, and a transport that
   accepts any certificate lets anything on the path impersonate the cockpit and harvest that proof.
2. `~/.williamos/device-credential.json` — `{ credentialId, privateKeyPkcs8 }` for a credential the
   **owner enrols once**. Enrolment requires a session on the declared primary email by design: an
   agent that could enrol itself would not be gated by any of this.

Until both exist, issuance falls back to `local` with a warning on every run. Lanes that must not
proceed on the weaker mode can pass `--require-ledger`, which refuses instead of falling back.

## Stale is not the same as doctored

`verifyWorkContextReceipt` takes an optional third argument naming what the receipt was issued
against. When supplied, a mismatch is re-derived with those measured values: if the token comes back,
the lane's claims are intact and only measured truth moved (`FAILED_STALE_MAIN`, naming whether main
or doctrine drifted); if it still does not, the token was never issued for those claims
(`FAILED_RECEIPT_MISMATCH`). The two have different remedies — re-establish versus stop editing the
claim — and reporting both as "main has moved" pointed a doctored receipt at the wrong fix.

The ledger path omits the argument and keeps its original meaning: `requireWorkContext()` looks the
facts up by token, so anything that fails to match there is drift by construction.

The argument is lane-supplied in the hook path, which is safe. Live main and doctrine are substituted
over it before verification, so it can never widen what passes; it is read only after a mismatch has
been decided, and only to choose which refusal to report.
