# WO-WILLIAMOS-HERMES-POLICY-PROVENANCE-001 — prove the lane ran the reviewed policy

**Status:** CLOSED 2026-08-17 (see "Done" below) · **Raised:** 2026-08-17 · **Source:** P3 independent review
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

## Done 2026-08-17 — content form, and the placement is the trick

`HERMES_FREE_AGENT_POLICY_PROVENANCE_WALL` in
`scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1`, owned mode only: the
supplied `-PolicyPath` must **byte-match** the reviewed
`config/execution-fabric/hermes-free-dev-agent-v2.policy.json`, resolved relative to the script.
Content, not path — the file may live anywhere so long as it is the reviewed one.

**The test-harness rework turned out to be unnecessary**, which is why this closed cheaply. The
behavioural tests drive *invalid* policies on purpose, to prove the workspace-root, evidence,
promotion and quarantine walls fire — so any content check placed at the top would preempt them, and
that is what sank the path attempt. But provenance does not need to be first. It only needs to run
**before anything executes**. Placed after those walls and before the first `docker` call:

- a synthetic policy still trips the wall under test, so all four behavioural tests pass untouched;
- a forged policy that satisfies every earlier wall — the actual threat, since it asserts its own
  evidence — is refused before any container, image inspect, or network call.

Only four tests execute the invoker at all; the rest are source assertions. That is what made the
ordering safe, and it was worth checking before redesigning the harness.

**Not behaviourally tested, and why:** reaching the provenance wall requires a workspace under the
real policy's `allowedWorkspaceRoots` (`C:\Users\bs\.williamos\...`), which does not exist off HERMES.
The provider test therefore pins the wall's **position** — after the evidence, workspace-root and
promotion walls, before `image inspect` — because the position *is* the design. A presence-only
assertion would pass even if the check were moved somewhere useless.

**Consequence, intended:** a deployed invoker with no repository beside it cannot run owned mode. The
orchestrator drives owned mode from a checkout, so this costs nothing real and removes the
"deployed copy plus hand-written policy" shape entirely.

## Do not

Do not retry the path-based form. Do not make tests write into a version-controlled directory to get
a control to pass. Do not move the provenance check to the top of the script "for clarity" — the
placement is load-bearing and the behavioural tests will tell you, loudly.
