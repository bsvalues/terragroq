# WilliamOS Experience V2 — Phase 0 evidence artifact

Document: `WILLIAMOS-EXPERIENCE-V2-PHASE0-EVIDENCE-001`

Companion to
[`williamos-experience-v2-phase0-collision-map.md`](williamos-experience-v2-phase0-collision-map.md)
and its
[charter](williamos-experience-v2-implementation-charter.md).

## Why this file exists

The round-1 independent adversarial review of the collision map raised a finding that no code change
could answer: the map's most consequential rulings — the #921 freeze scope, the PR #927 reservation,
the node reachability state — rested on evidence a repository-only reviewer could not reproduce. The
map cited a session-local cache. That is not a defensible support for a gate ruling.

This artifact persists the sanitized, load-bearing evidence in the repository so a later reviewer,
agent or session can re-derive the rulings without asking anyone for anything.

Nothing here is an owner ask. Nothing here contains a credential, a host key, an internal address
beyond what the repository already tracks, or a private path.

## Evidence classes

| Class | Meaning |
| --- | --- |
| `REPOSITORY_VERIFIED` | Reproducible from tracked files at a cited path and line. |
| `EXTERNAL_RECORD` | GitHub issue/PR state. Reproducible with `gh`; not from the repository alone. Quoted verbatim below where it is load-bearing. |
| `SESSION_OBSERVED / NOT_REPOSITORY_VERIFIED` | Observed by an executing session on one host at a stated time. Never the sole support for a gate ruling. |

## 1. Authority citations — verbatim, `EXTERNAL_RECORD`

Reproduce with `gh issue view <n>` / `gh pr view <n>`.

### #921 — `CODEX_HERMES_FRONTEND_AUDIT` (OPEN)

Title: *verify or take over the Environment lane*. Parent: #762.

The clause the collision map's §3 ruling turns on, verbatim from the issue body, under **Takeover
authority → On takeover**:

> - freeze further Claude mutations in the Environment path;
> - preserve reusable backend/API/data work;
> - create a genuinely separate replacement frontend root rather than incrementally transforming the
>   legacy Workbench;
> - use the six-job simulations as acceptance, not the existing component tree as architecture;
> - first prove Job 1 end-to-end from the rendered UI, then Job 4 with two genuinely isolated running
>   implementations/sandboxes;
> - build → abuse → independent review → only then owner final acceptance.

The permitted outputs, verbatim:

> - `ENVIRONMENT_ARCHITECTURE_VERIFIED` — current implementation is genuinely on the new architecture;
>   list remaining bounded defects and evidence.
> - `ENVIRONMENT_FRONTEND_TAKEOVER` — current implementation is structurally wrong; Codex owns
>   replacement implementation from this point.
> - `BLOCKED_<ACTUAL_BOUNDARY>` — only for a genuine non-owner-remediable boundary.

**Recorded outcome:** `ENVIRONMENT_FRONTEND_TAKEOVER`, posted 2026-08-20T19:13:58Z, reaffirmed
19:57:29Z.

**What the freeze does and does not reach.** It freezes *Claude mutations* in the *Environment path*
and explicitly preserves *reusable backend/API/data work*. It is not a global architectural hold, and
the collision map's revision 1 reading of it as a blanket Gate 2/3/5 freeze was wrong. See §3 of the
map.

### #985 — `EXPERIENCE_V2_SYSTEM_OBJECT_GRAPH` (OPEN)

Load-bearing for Gate 1. Verbatim:

> ## Existing API disposition
>
> Preserve `/api/fabric/nodes` live-probe/failure-reason doctrine, but do not freeze its string-valued
> GPU/memory/disk/service summaries as the subresource model. Move toward typed structured
> observations.

> ## Identity
>
> Use durable canonical identity from current truth where possible; human names such as HERMES/P40 are
> aliases. Replacement hardware must not inherit history only because it occupies the same slot/name.

> ## Actions
>
> Expose canonical deterministic actions beside objects, but route every mutation through existing
> authority/execution/fencing. Object projection never grants authority.

First proof, verbatim: `SYSTEM -> HERMES -> P40`, requiring among other things "one safe governed
action with verified post-state/evidence".

Acceptance, verbatim:

> PASS only if clients do not parse presentation strings to discover resources, offline objects remain
> visible truthfully, identity survives normal restart but not physical replacement, UI is not a source
> of truth, and direct actions reuse canonical authority/fencing.

### #974 — `IF-00O` observability/headroom reconciliation (OPEN)

Supplies the classification vocabulary the map uses in §5.1 and §6.6, verbatim:

> - `REUSE_AS_IS`
> - `EXTEND_EXISTING_PROBE`
> - `DERIVED_FROM_EXISTING`
> - `SPECIALIST_RUNTIME_METRIC`
> - `GENUINELY_MISSING`

And the six evidence classes: `IDENTITY`, `TOPOLOGY`, `HEALTH`, `HEADROOM`, `BENCHMARK`, `ECONOMICS`.

The constraint the map's §7.4 encodes, verbatim from **Acceptance**:

> - canonical Execution Fabric probes/registry remain the inventory/health source;
> - dynamic headroom has short freshness semantics;
> - total capacity cannot masquerade as reservable capacity;

And the rule that governs `UNKNOWN`, verbatim from **Cost boundary**:

> Unknown monetary cost must remain UNKNOWN rather than becoming zero.

#974 also states plainly why a second observer is forbidden:

> Therefore Intelligence Fabric must extend this evidence path, not create another hardware-monitoring
> database.

### #987 — `EXPERIENCE_V2_BUILD_SEQUENCE` (OPEN)

Verbatim, from **Findings**:

> - Existing `workbenchActionRegistry` is the predecessor for one Object + Action Registry, but it is
>   currently navigation-only.
> - Existing governance/event/evidence/receipt/timeline sources are the predecessor for temporal
>   history/causality; do not create a new generic event authority.
> - No credible canonical Experience V2 preference store was found; treat personalization storage as
>   genuinely missing and keep it explicit/reversible/compartment-aware.

The build order, verbatim: `0` reconciliation freeze · `1` canonical object projection (#985) ·
`2` unified Object + Action Registry · `3` WorkingWorld adapter · `4` re-entry + semantic projections ·
`5` Experience V2 desktop composition · `6` temporal causality · `7` visual/material · `8` native HUD ·
`9` tablet/phone · `10` canonical personalization · `11` operating modes · `12` automatic placement.

Two of those findings independently corroborate map conclusions the round-1 review contested:
the preference-store gap (map §5.8, review row 22 refuted) and the single event authority
(map §5.5, review row 23 refuted at P0).

Note what #987 does **not** say: it names `workbenchActionRegistry` as the sole command-registry
predecessor and does not mention `lib/intent/router.ts`. The map's §5.3 records the second half.

### PR #927 — `codex/environment-frontend-takeover-921` (OPEN)

State: OPEN, `mergeable: CONFLICTING` as of 2026-08-24. **54 files.** The Gate-relevant reservations,
reproducible with `gh pr view 927 --json files`:

```
app/env/page.tsx
app/environment/page.tsx
app/api/env/line/route.ts
app/api/environment/{line,view,world,runtime,compare,preview-identity,http}/…
components/desk/desk.tsx
components/environment/environment.tsx
components/environment-root/{environment-root,environment-sign-in,environment-surface}.tsx
lib/environment/{working-world,world-service,world-projection,api-contract,runtime-contract,
                 runtime-ingress,endpoint-liveness,endpoint-policy,frameable,server,
                 postgres-work-intake,postgres-world-repository}.ts
lib/db/schema.ts · lib/session.ts · lib/device-auth/service.ts
migrations/0013-environment-world.sql · drizzle/0000_williamos_init.sql
```

Not present in that list, and therefore not reserved by this lane:
`lib/intent/workbench-action-registry.ts`, `lib/intent/router.ts`, and every path under
`lib/system/`, `app/api/fabric/`, `lib/fabric/`, `scripts/execution-fabric/`,
`config/execution-fabric/`. Verified against the complete 54-entry listing, not a truncated one.

**One overlap worth recording, and it is not a collision.** PR #927 modifies
`scripts/runtime-operator/operational-kernel.mjs` — the module PR #989's doctrine test exercises
through `runOperationalKernelCycle`. Different files, shared contract, so it was checked directly:

```sh
git diff origin/main...origin/codex/environment-frontend-takeover-921 \
  -- scripts/runtime-operator/operational-kernel.mjs \
  | grep -E '^[+-]' | grep -iE 'isOwnerWall|ownerDecisionRequired|FAILED_TERMINAL|RATE_LIMIT'
```

#927's changes are additive: a null-safe sort, extra `validate` arguments, a `publishEnvironmentWorld`
step, and a new `WAITING_ENVIRONMENT` state. It does **not** touch `isOwnerWall`, the default failure
branch, or the rate-limit parsing — the three behaviours #989's test pins. The two PRs are compatible.

More than compatible, in fact: #927's new `WAITING_ENVIRONMENT` carries
`ownerDecisionRequired: false` and a `retryAfter`, which is the owner-directed execution doctrine
applied independently by another lane before that doctrine was written down. That is corroboration,
not coincidence, and it is the strongest available evidence that #989 encodes a rule the system was
already reaching for.

### `origin/wb/primary-experience-replacement` — `REPOSITORY_VERIFIED`

`8c0c9bfe`, 2026-08-22 20:50 -0700, branched from `a7efbe59` (= `origin/main~1`). Unmerged, no PR, one
commit behind main. 89 files, +3660 / −10660, thirteen commits. Every commit carries
`Co-Authored-By: Claude Opus 5`, dated two days after the #921 takeover verdict. Its `GOAL.md` is
stale June "Second Brain" content and is not this lane's authority record.

Collision evidence, not an active reservation. See map §3.

## 2. Gate 1 reservation measurement — `REPOSITORY_VERIFIED`

Reproduce with:

```sh
git fetch origin
for b in $(gh pr list --state open --limit 50 --json headRefName -q '.[].headRefName'); do
  echo "== $b"
  git diff --name-only "origin/main...origin/$b" \
    | grep -E '^(lib/system/|app/api/fabric/|lib/fabric/|scripts/execution-fabric/|config/execution-fabric/)'
done
```

Result, 2026-08-24, across all nine open PR lanes: **no output**. No open lane touches any Gate 1
source path.

A full sweep of all 404 remote refs found three branches that do touch those paths. All are
historical:

| Branch | PR | Distance from `main` |
| --- | --- | --- |
| `codex/issue-762-device-cockpit` | #766 MERGED | 372 ahead / 4 behind, last commit 2026-08-14 |
| `codex/issue-762-system-intent` | #765 CLOSED | 372 ahead / 1 behind, last commit 2026-08-13 |
| `codex/william-os-execution-fabric-v0` | #532 MERGED | 669 ahead / 14 behind, last commit 2026-08-09 |

None is an active reservation.

## 3. Test baseline — `SESSION_OBSERVED` local, `EXTERNAL_RECORD` in CI

The acceptance gate is the deterministic CI profile, not an ad-hoc full-suite run. Reproduce with:

```sh
node ./node_modules/vitest/vitest.mjs run --config vitest.ci.config.ts
```

| Run | Result |
| --- | --- |
| Local, 2026-08-24 10:53, `9dd61c67` + working-tree docs only | **418 files passed, 4 skipped (422); 5509 tests passed, 46 skipped (5555); 0 failed.** Exit 0. Duration 255s. |
| CI on PR #988 | `vitest (deterministic suite)` SUCCESS; `production build (next build)` SUCCESS |

Revision 1 of the collision map recorded five "pre-existing failures" and concluded a green suite was
unobtainable on this host. That conclusion is withdrawn. Its run used the base config rather than the
CI profile:

- `tests/execution-fabric-hermes-embedding-bakeoff.test.ts` and `tests/lab-dev-preflight.test.ts` are
  excluded from the deterministic profile by design, each with a recorded reason
  (`vitest.ci.config.ts:12-19`);
- `tests/hermes-bridge-supervisor.test.ts` and `tests/execution-fabric-pinned-placement.test.ts`
  failed at the base config's 5000 ms default. The CI profile raises `testTimeout`/`hookTimeout` to
  60000 ms specifically because those tests spawn real Node subprocesses
  (`vitest.ci.config.ts:32-36`);
- `tests/multi-agent-eligible-set-scheduler.test.ts` is lease-timing sensitive under parallel load and
  passes under the CI profile.

## 4. Node reachability — `SESSION_OBSERVED / NOT_REPOSITORY_VERIFIED`

Recorded for its timestamp only, and superseded as an *explanation* by the owner's account that the
P40 is being physically installed.

| Observation | Value | Time |
| --- | --- | --- |
| Tailnet state for HERMES | `offline, last seen 2026-08-23 18:42` | 2026-08-24 |
| LAN `192.168.88.9` ports 22 / 3000 / 5985 / 50080 / 50443 | closed | 2026-08-24 |
| LAN `192.168.88.9` ICMP | answers | 2026-08-24 |
| `~/.williamos/fabric/nodes.json` on OMEN | absent (not permission-denied) | 2026-08-24 |

Which surface: HERMES's SSH, application and WinRM surfaces. This does **not** contradict
`AGENTS.md:68`, which describes the design status of the resident HERMES-to-AEGIS execution backend,
not this node's current reachability.

Typed disposition: `WAITING_EXTERNAL_ENVIRONMENT / condition=HERMES_REACHABLE /
continuation=automatic / ownerDecisionRequired=false`. It blocks Gate 1b only, and must not park
unrelated eligible work. See map §9.

## 5. Round-1 independent adversarial review — `SESSION_OBSERVED`, summarized

Sourced internally through bounded Codex lanes per the sovereign-runtime-and-review supersession. Not
an owner courier task; the owner neither relayed the request nor the result.

**Verdict: `MAP_DEFECTIVE`.**

Lane health: several lanes died before dispatch with `code-mode host exited during handshake` and one
with the Windows process-initialization failure `0xC0000142`. Those lanes returned
`BLOCKED_TOOL_UNAVAILABLE` and correctly declined to issue a verdict on evidence they had not read.
Surviving lanes reached the repository through the GitHub read surface and cited exact lines on
`9dd61c67`. Four collision candidates reached the coordinator flagged **unverified** and were verified
locally by the delivering lane before adjudication.

Finding counts from the lanes that completed: 8/7/1, 6/4/4 and 5/1/0 across P0/P1/P2, deduplicated to
**21 accepted and 3 refuted** in the map's §10 register.

Remediation lesson, recorded because it generalizes: every accepted P0 arose from the same root cause
— revision 1 described what code *was for* rather than what it *does*, and inherited its own earlier
descriptions. The corrective discipline is in the map's §1 evidence classes and in the requirement
that every ownership claim cite a line.

Re-review of revision 2 is tracked as `CONT-EXPV2-P0-REVIEW-2` (map §9). Round 2 runs fewer parallel
lanes, because the round-1 handshake failures correlated with lane count.
