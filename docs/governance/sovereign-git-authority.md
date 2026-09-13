# Sovereign Git Authority — local lab is the integration authority

**Status: CONTROLLING (owner decision, 2026-09-11).** This document sets the repository lifecycle
boundary for the estate: WilliamOS, TerraFusion, and every lab repository.

## The standing rule

> **HERMES lab is the authoritative development, review, integration, and deployment environment.
> WilliamOS is its owner-facing operating surface. Local Git is authoritative. GitHub is a
> downstream mirror and optional collaboration surface. No hosted reviewer, CI provider, or GitHub
> control may be required for TerraFusion to progress from authorized work to running product.**

GitHub's proper position in the architecture:

```text
                 WILLIAMOS            owner-visible control plane
                     │
          intent / outcome / approval
                     ▼
                   HERMES            execution + authority plane
      ┌──────────────┼───────────────┐
      ▼              ▼               ▼
   DAEDALUS        ATLAS           AEGIS
 GPU / AI work   data/storage    CPU workers
      └──────────────┴───────────────┘
                     ▼
             LOCAL GIT AUTHORITY     ← lab bare repo on atlas (the `lab` remote)
                     │
          review → seal → merge      ← all executed by lab machinery
                     ▼
            deploy/test/observe      ← the door on HERMES, the fabric workers
                     ▼
             GitHub MIRROR           ← backup + public collaboration; NOT a gate
```

If GitHub is down, rate-limited, changes its review API, removes a bot, or the internet disappears,
**development continues**. A failed mirror sync records:

```text
PRODUCT STATE: COMPLETE
MIRROR STATE: OUT OF SYNC
```

It never turns a completed product change into an incomplete one.

## Why the seal was already 90% of this — and what this document changes

The estate's own CI verifier states the doctrine exactly: *"GitHub verifies WilliamOS delivery; it
does not mint work authority and rejects client-authored receipts."* The signature is Ed25519 from a
key the lab holds; the patch is re-measured from git objects; the review verdict is signed by the
lab's sovereign reviewer. But as long as the merge button sat behind GitHub branch protection, the
verifier was the de facto gate — a hosted service deciding whether the lab's own signed authority
takes effect. That dependency is now removed: the integration point is `lab/main`, and the same
pure verification code runs locally before it advances.

## The lifecycle (canonical order)

1. **Assignment** — work proceeds under an existing admission chain (outcome → work order → grant)
   minted by the Environment on HERMES. A candidate branch is built in a lane worktree.
2. **Local evidence (operative)** — the deterministic suite and the production build are run **on
   the lab machine** against the exact candidate head. GitHub's check runs, when they happen, are
   recorded as a corroborating mirror signal, never required.
3. **Independent review** — the Tier 1 sovereign reviewer (a separated lab agent context, signed
   with the reviewer key; `lib/governance/sovereign-review.mjs`) returns a verdict bound to the
   exact head. `EXTERNAL_REVIEW_UNAVAILABLE ≠ REVIEW_NOT_DONE` still holds: the lab reviewer is the
   completion, hosted reviewers are optional additions.
4. **Seal** — the Environment issues the delivery seal over the exact head (adoption PREVIEW →
   AUTHORIZE → ISSUE), unchanged. The seal remains the authority artifact of record.
   **Seal authoring rule (mandatory):** the recorded `baseSha` MUST be the lab main **tip at the
   moment the lane is cut** — i.e. the candidate's actual fork point. The lab integration authority
   hard-refuses a declared base that is not the natural merge-base against current lab main
   (`INTEGRATION_BASE_NOT_MERGE_BASE`), because a stale or laterally-chosen base lets a path whose
   content equals the base slip past the revert guard and silently prefer the candidate's lineage
   over main's newer work. The remedy is always to **re-cut the lane on current lab main and re-seal
   (with re-review)** — never to weaken the check. Branch from the tip, not from an old PR branch
   tip or a stale mirror commit.
5. **Merge = `scripts/execution-fabric/integrate-lab-main.mjs`** — the lab integration authority:
   re-verifies the seal signature, the receipt, the re-measured sealed patch, and the attestation
   **using the production verifier modules** (the local authority can never be laxer than the gate
   it replaces), then squash-integrates the candidate into **`lab/main`** (bare repo on atlas,
   `ssh://bs@192.168.88.8/srv/git/williamos.git`, fabric key). Only then does it *attempt* the
   mirror sync — a PR merge via the governed path where available, otherwise a `mirror/<sha>`
   branch — and records `PRODUCT STATE` / `MIRROR STATE` honestly in
   `~/.williamos/integrations.json`. Mirror failure never reopens the product transition.
   Tool guarantees as of the follow-up hardening pass: the local full-suite record is **parsed**
   (vitest JSON), success-checked (tests must have EXECUTED and passed — `failed===0` on an
   all-skipped record is not success), counter-consistent, suite-identified (each named suite must
   resolve to a real file CONTAINED in the integration worktree — existence alone is not binding)
   and **head-bound** to the
   candidate (`LOCAL_TESTS_*` typed refusals; rehearsal-only mode stays advisory), and the recorded
   evidence carries the record's own path and head so the digest is locatable; the governed mirror
   merge is **bound to the sealed head** — strict decimal PR, `origin` bound by full URL form
   (github.com host AND `bsvalues/terragroq`, not a path suffix),
   and `--match-head-commit` so a head that moves between read and merge is refused — and `IN_SYNC`
   is recorded only after the mirror tree is fetched and proven tree-equal to the lab main tree this
   run produced (`MIRROR_PR_INVALID` / `MIRROR_REMOTE_MISMATCH` / `MIRROR_HEAD_MISMATCH` /
   `MIRROR_TREE_MISMATCH` / `MIRROR_VERIFY_FAILED_AFTER_MERGE`, the last distinguishing a merge that
   happened from a merge that failed); a candidate sharing no ancestor with lab main refuses typed
   (`INTEGRATION_BASE_UNRELATED`), while a merge-base probe that cannot answer refuses
   `INTEGRATION_BASE_PROBE_FAILED` instead of claiming unrelated history.
   The sealed-content guard carries ONE declared relaxation: when main deletes a sealed path whose
   candidate blob still exists **somewhere** in the merged tree (the rename/modify resolution),
   integration proceeds; the allowance is content-equality based, deliberately not rename-aware, is
   withheld for the empty blob, and is pinned in both directions by tests.
6. **Deploy / observe / FINALIZE** — the merged lab main deploys to the HERMES door, runtime
   verification as usual, then the seal chain is FINALIZE'd (slot release).
7. **Reconciliation (mirror → lab)** — for anything that landed on GitHub main outside this
   lifecycle, the path is: fetch `origin/main`, integrate onto `lab/main` **sealed or owner-
   approved**, then re-push the mirror. GitHub main is never fast-forwarded into lab main silently.

## What is NOT changed

- No hosted service is forbidden. CodeRabbit/Sourcery/GitHub Actions may contribute additional
  information; they own no availability and no transition.
- The seal is not abolished. It is what makes the local merge auditable by anything that reads the
  history later — including the mirror.
- `enforce_admins=false` on GitHub main is retained deliberately: it is the compatibility surface
  for mirror reconciliation, not the authority path.
- Safety doctrine is unchanged: no protected-data access, no owner bypass, no weakening of any
  gate to make a transition pass. This document removes a *dependency*, not a *control*: every
  control the mirror-side gate exercised (signature, patch digest, exact head, review binding) is
  now exercised locally, by the same code, with the same keys.

## Terminology

- **lab main** — `lab/main` on atlas: the authoritative branch.
- **mirror main** — `origin/main` on GitHub: a replica and collaboration surface.
- **integration** — advancing lab main under a verified seal. The word "merge" in older documents
  refers to this act wherever it previously assumed a GitHub PR button.
