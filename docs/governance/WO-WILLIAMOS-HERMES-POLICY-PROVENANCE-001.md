# WO-WILLIAMOS-HERMES-POLICY-PROVENANCE-001 — prove the lane ran the reviewed policy

**Status:** OPEN · **Raised:** 2026-08-17 · **Source:** P3 independent review
(`review-2026-08-17-t1-indep-opus5`), structural half of condition C7 and finding Q4
**Review record:** [`../reports/hermes-kernel-p3-independent-review-2026-08-17.md`](../reports/hermes-kernel-p3-independent-review-2026-08-17.md)

## The gap

Every wall in the owned-worktree lane — promotion, evidence, workspace roots, toolsets, image id,
deployed-artifact digests — is asserted against **the policy the invoker was handed**. The invoker
accepts any `-PolicyPath`, and the v2 policy is not byte-sealed, so a hand-written copy can assert its
own controls as proven. This is not hypothetical: the P2 bootstrap used exactly such a copy, outside
version control, carrying `OWNED_WORKTREE_CONFINEMENT_PROVEN: "…PROVISIONAL"`, to open the lane in
order to prove the very control it asserted. That was disclosed at the time, and the artifact has
since been removed and verified absent — but the *shape* that allowed it remains.

The repo already digest-seals other authority-bearing files
(`tests/execution-fabric-aegis-standing-authority.test.ts` pins `resident_runner_sha256` and four
siblings), so this is inconsistent with the project's own standard.

## Attempted and reverted 2026-08-17 — read before retrying

A `HERMES_FREE_AGENT_POLICY_PATH_WALL` requiring `-PolicyPath` in owned mode to resolve inside the
repository's `config/execution-fabric/` **works in production** (the kernel client already passes
exactly that path) but broke four behavioural invoker tests, which deliberately supply **synthetic
policies from temp directories** to prove the workspace-root, evidence, promotion and quarantine walls
fire. The only routes to green were weakening the wall, or having tests write policies into a
version-controlled directory — and a dirty working tree breaks the suites that assert on real git
state, which cost 16 spurious failures the same day. It was reverted.

## The shape that is likely right

**Content, not path.** Require the supplied policy to byte-match a reviewed copy — the technique C6
just proved works for deployed artifacts, where the pinned digests are additionally asserted against
the LF-normalised repo content so a reviewer checks *content*, not opaque hex.

This is as much a **test-harness change** as a control change: the behavioural invoker tests need to
drive the real policy with injected evidence rather than hand-written files. Budget for that.

## Do not

Do not retry the path-based form. Do not make tests write into a version-controlled directory to get
a control to pass.
