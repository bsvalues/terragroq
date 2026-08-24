# WilliamOS Experience V2 — Phase 0 Reconciliation and Collision Map

Document: `WILLIAMOS-EXPERIENCE-V2-PHASE0-COLLISION-MAP-001`

Gate: `#987` Gate 0 — reconciliation freeze. Charter:
[`williamos-experience-v2-implementation-charter.md`](williamos-experience-v2-implementation-charter.md).
Evidence artifact:
[`williamos-experience-v2-phase0-review-evidence.md`](williamos-experience-v2-phase0-review-evidence.md).

Status: **`PHASE_0_NOT_PASSED — FOUR INDEPENDENT REVIEW ROUNDS, FOUR `MAP_DEFECTIVE` VERDICTS`**

**Revision 4.** Four rounds of independent adversarial review have now run against this map. All
four returned `MAP_DEFECTIVE`:

| Round | Target | Verdict | P0 | P1 | P2 |
| --- | --- | --- | --- | --- | --- |
| 1 | revision 1 | `MAP_DEFECTIVE` | 8 | 7 | 1 (deduplicated to 21 accepted, 3 refuted) |
| 2 | revision 2 | `MAP_DEFECTIVE` | 19 | 9 | 3 |
| 3 (self-check) | revision 3's own remediation | 4 defects introduced or left | 3 | 1 | 0 |
| 3 (independent) | revision 3 | `MAP_DEFECTIVE` | 7 | 4 | 0 |
| 4 (independent, **bidirectional**) | revision 4 at frozen `ac2c9566` | `MAP_DEFECTIVE` | 8 | 7 | 1 |
| 4 (delivering lane, concurrent) | revision 4 | 4 further defects | 2 | 1 | 1 |

An earlier version of this header said "Revision 3", "twice" and "two rounds" while the table beneath
it listed three and the document already contained §13 and §14. Round 4 finding 10 caught it. The
header is now regenerated from the registers rather than edited by hand.

Revision 2 fixed all 21 of round 1's accepted findings and round 2 then found **more defects than
round 1 had**, several of them inside revision 2's own corrections. That is the finding that matters,
and it is bigger than any individual row in §10 or §11.

**Round 4 is the first round to attack in BOTH directions**, and that is where its most important
results came from. Three rounds of pressure had run one way: the map's own claims were hardened while
the reviewers' findings were never re-opened. Round 4 re-verified roughly fifty accepted findings and
**overturned two of them** — §13 row 38's "four selector implementations" (there are at least five,
and the row asserting four had itself stated no sweep) and §11 row 15's "a new resolver would be a
fourth owner" (no cross-registry resolver exists at all). §12 row 35 had shown one accepted finding
was false; round 4 shows it was not the only one.

It then happened a third time, twice over. Applying round 2's findings introduced two contradictions
between the corrected rules and the acceptance criteria that test them, silently dropped one accepted
P0 by deleting the false claim instead of answering it, and accepted a round-2 P0 that was itself
false and carried it into a bounded packet. Those four are §12, found by re-reading revision 3 against
its own registers. Round 3 then ran independently against the same revision and returned
`MAP_DEFECTIVE` with **7 P0 and 4 P1** — §13 — including defects inside the §12 corrections themselves.

Round 3 is the first round to attack a revision that had already **adopted** the method rule below,
and the rule did not prevent the same three patterns from recurring. That is the strongest evidence in
this document, and it is evidence against the sufficiency of the rule, not for it.

### Why this map is not being declared PASS

The defect is in the **method**, not only the contents. Every accepted P0 across both rounds falls
into one of three patterns, and patching individual claims does not touch any of them:

1. **Positive claims taken from names and comments instead of behaviour.** `governanceEvent` was
   called hash-chained because a file header says "tamper-evident" — the schema has no chain
   (§5.5). Baseline was called audited because `auditFabricAction` is called — both calls swallow
   failure (§5.6). Probing was called brokered-only because the broker exists — `probeLocal` bypasses
   it (§5.1).
2. **Blanket negatives whose search scope was never stated.** "No second memory system, event
   authority, or command registry was found on `main`" was asserted after searching only the
   TypeScript surface, while `main` also holds 103 tracked files under `control-center/` and a Python
   command registry with its own execution gate (§6.7).
3. **Requirements paraphrased rather than read.** Revision 1 called the first journey read-only and
   picked a mutating action; revision 2 called it read-only and picked a read-only action. The
   charter says "one safe governed **mutation**" (`charter:273`). Neither revision opened the line
   (§5.6).

A Phase 0 map exists so that later phases inherit correct ownership. Declaring `PASS` on a document
whose ownership claims have failed adversarial review twice would hand Gates 1 through 6 exactly the
corrupted inheritance the charter says a collision map must prevent. So this revision records the
corrections, records the method failure, and does **not** claim the gate.

### The rule this map now binds itself to

Every ownership claim from here must carry, inline:

- **behaviour, not nomenclature** — cite the line that *does* the thing, and for anything described as
  durable, audited, chained or guaranteed, cite what happens when it fails;
- **stated search scope for every negative** — a "no second owner" claim names the surfaces searched
  (TypeScript, Python, PowerShell, shell, config) or it is not a finding;
- **the controlling requirement quoted, not paraphrased**, wherever a choice is justified by one.

§2 records the earlier retraction of a `COMPLETE` claim made while evidence was inaccessible. This is
the same failure one level up: a `PASS` claimed while the evidence had been read but not believed.

## 1. Session and repository truth

| Check | Result |
| --- | --- |
| Session authority | `PASS` — cwd `C:\Users\bsval\terragroq`, session started here (`SESSION_OBSERVED`) |
| Repository | `PASS` — `git@github.com:bsvalues/terragroq.git`, toplevel `C:/Users/bsval/terragroq` |
| Branch / worktree | `wb/experience-v2-phase0-collision-map`, branched from `main` |
| `origin/main` | `9dd61c67` — `feat(hermes): dispatch actually reroutes to the claude lane` (2026-08-22 08:44 -0700) |
| `AGENTS.md` | Read in full |
| `CLAUDE.md` | Read in full |
| Controlling doctrine | `multi-agent-operator-playbook.md` + `sovereign-runtime-and-review-supersession.md` read |
| Spec branch | `origin/feat/williamos-intelligence-fabric-package` @ `666a3d3c` (2026-08-23 18:44 -0700) |
| Controlling issue bodies | `PASS` — all 25 read in full (§2). `EXTERNAL_RECORD`; authority citations persisted to the evidence artifact |
| Test baseline | `PASS` — the deterministic CI profile is the gate, and it is green (§8) |
| Independent review | `PASS (round 1 complete)` — verdict `MAP_DEFECTIVE`, remediated here; §10 |
| `#831` work context | Established for `WO-987-GATE0-COLLISION-MAP`; provenance `local`, since OMEN has no enrolled cockpit device credential — the same condition the #921 lane recorded |

### Evidence classes used in this document

Every load-bearing claim carries one of these labels, because revision 1 mixed them and a reviewer
could not tell which claims it could reproduce:

- `REPOSITORY_VERIFIED` — reproducible from tracked files at a cited path and line. Default; an
  unlabelled `file:line` claim is this class.
- `EXTERNAL_RECORD` — GitHub issue/PR state. Reproducible with `gh`, not from the repository alone.
  Authority citations are persisted to the evidence artifact.
- `SESSION_OBSERVED / NOT_REPOSITORY_VERIFIED` — observed by the executing session on this host at a
  stated time. Not reproducible by a repository-only reviewer, and never the sole support for a gate
  ruling.

### Verified specification location

The Experience V2 / Intelligence Fabric package is **not on `origin/main`**. `git diff --name-status
origin/main...origin/feat/williamos-intelligence-fabric-package` reports 41 files, all `A` (added),
5508 insertions, 0 deletions, entirely under `docs/governance/williamos-intelligence-fabric/`.

Consequence: `origin/main` is implementation truth; the spec branch is specification. A Phase 1 PR
based on `main` cannot cite an on-main path for its controlling contract. The charter and this map are
therefore written into `docs/governance/` on the `main` lineage so implementation children have an
on-main citation target.

## 2. Actor-capability history — what was blocked, and how it was closed

Phase 0 ran in three sessions. The first could not perform several already-authorized reads and could
not run tests, branch, or commit. It nevertheless reported Phase 0 `COMPLETE`. That was wrong on the
charter's own terms: a phase cannot be `PASS` while mandatory evidence is inaccessible. The true
status of the first session was:

```
PHASE_0_INCOMPLETE_ACTOR_CAPABILITY_BLOCKED
```

Every one of those blockers was an **actor-capability** condition — a property of the executing
session, not a governance decision and not a repository defect. Per #957's machine-tested doctrine
(`tests/runtime-operator-execution-path-not-owner-gate.test.ts`) and the owner-directed execution
doctrine (`tests/session-surface-limits-not-owner-gate.test.ts`), such conditions are internal routing
work. None of them became owner work; none was resolved by the owner.

| Capability | First session | Resolution | Route |
| --- | --- | --- | --- |
| Issue bodies #762, #921, #964–#987 | Denied — `gh` unreachable | **CLOSED.** All 25 bodies read in full, plus the #921 comment thread | Evidence captured out-of-band, then read; authority citations persisted to the evidence artifact |
| `node` / `npm` / `npx` | "Denied" | **CLOSED.** The Volta shims on `PATH` fail without `VOLTA_HOME`; the resolved image at `~/AppData/Local/Volta/tools/image/node/24.19.0` runs correctly | Rerouted to the direct interpreter path — an actor-capability workaround, internal |
| Test suite | Denied | **CLOSED.** The deterministic CI profile runs green (§8.1) | Same |
| Branch / commit / push / PR | Denied | **CLOSED.** This map and the charter are delivered through the governed branch/PR lifecycle | Agent-owned per AGENTS.md |
| `~/.williamos/fabric/nodes.json` | Recorded as "read denied" | **CORRECTED.** The path is not permission-blocked; it does not exist on this host (`SESSION_OBSERVED`). OMEN is the cockpit, not the transport-registry holder | Registry truth re-sourced and *disambiguated* — §4.1 |
| Independent adversarial review | Not attempted | **CLOSED (round 1).** Bounded Codex lanes ran; verdict `MAP_DEFECTIVE`; remediated in this revision (§10) | Internal delivery stage, not an owner courier task |
| Live HERMES probe | Not attempted | **`BLOCKED_DEPENDENCY`**, reason `WAITING_EXTERNAL_ENVIRONMENT`. See §9 `CONT-EXPV2-P0-RUNTIME-PROOF` | Typed with automatic continuation; not an owner task |

The first session's "reads outside the repository are denied" row was itself a misdiagnosis: the
registry file is absent, not forbidden. A capability report that guesses at a cause produces exactly
this kind of inherited error — the same failure class the round-1 review found throughout revision 1
of this map, where descriptions of code were trusted in place of the code.

### Mandatory reads actually performed

| Record | Read |
| --- | --- |
| #762 parent outcome | full body |
| #921 Environment takeover | full body **and** all comments, including the recorded verdict |
| #957 actor-capability doctrine | full body, commit `aa383e2d`, and its test |
| #964, #965 | Intelligence Fabric parent + development package |
| #968–#976 | topology, placement, evaluation, context/inference, model/runtime, accelerator, observability, elastic compute, model supply chain |
| #977 | owner-experience invisibility contract |
| #978 | Experience V2 freeze |
| #979, #980, #981 | compartments, cache/data gravity, attention/re-entry |
| #982 | frontend cutover |
| #983–#987 | HUD, visual system, object graph, operating modes, build sequence |
| `AGENTS.md`, playbook, supersession, charter | full |
| Spec branch doc 27 | read at `origin/feat/williamos-intelligence-fabric-package` |

## 3. RESERVATION COLLISION — the Environment frontend lane is under a recorded takeover

The first Phase 0 session could not reach GitHub and therefore left the status of
`origin/wb/primary-experience-replacement` undetermined, proposing that a coordinator or the owner
decide whether it was active or abandoned. **That escalation is withdrawn.** The question was already
answered in the record, and reading it required no owner and no new authority.

### The recorded verdict (`EXTERNAL_RECORD`)

#921 required exactly one of three outputs. The recorded outcome, posted 2026-08-20T19:13:58Z and
reaffirmed at 19:57:29Z, is:

```
ENVIRONMENT_FRONTEND_TAKEOVER
```

Codex owns the Environment frontend replacement lane from that point. The takeover lane is
`codex/environment-frontend-takeover-921`, delivered as **PR #927**, still open — green on code,
deliberately unmerged, held at `activation: HOLD_UNPROVEN_AUTHORITY_AND_RUNTIME` because the live
migration, runtime credential and public preview route have not been proven. #921 is open at
activation and six-job proof, not at code review.

### The exact freeze scope, quoted rather than paraphrased

Revision 1 converted this verdict into a blanket architectural hold over Gates 2, 3 and 5. The review
attacked that, and the attack is correct. #921's takeover clause says, verbatim:

> freeze further Claude mutations in the Environment path;
> preserve reusable backend/API/data work;

That is a **path-scoped freeze on one provider's mutations**, not a global architectural hold, and it
explicitly preserves backend/API/data work. Revision 1's `BLOCKED_AUDIT_FREEZE` over all three gates
overstated the record.

### What `origin/wb/primary-experience-replacement` actually is

`8c0c9bfe` (2026-08-22 20:50 -0700), branched from `a7efbe59` (= `origin/main~1`), **unmerged**, no
PR, one behind main. 89 files, +3660 / −10660. Thirteen commits of directed single-day work: phases
1–3 plus buckets A/B "legacy strangulation", ending mid-flight ("…and a gap I created").

Every commit carries `Co-Authored-By: Claude Opus 5`. **It is a Claude-lane branch**, authored
2026-08-22 — two days *after* the takeover verdict froze Claude's frontend lane. It is therefore not
the authoritative Environment lane and not a Codex reservation. It is **collision evidence**: frozen
Claude work whose direction is superseded by #927. It is not itself an active reservation, and this
map does not treat it as one.

Its `GOAL.md` is stale June "Second Brain" content and is not this lane's authority record; the
controlling records are #921 and #982.

It holds these exact seams:

| File | Δ | Charter gate that needs it |
| --- | --- | --- |
| `lib/intent/workbench-action-registry.ts` | +160 | **Gate 2** — Unified Object + Action Registry |
| `lib/environment/working-world.ts` | +159 | **Gate 3** — WorkingWorld adapter |
| `components/desk/desk.tsx` | +293 | **Gate 5** — desktop composition |
| `components/workbench/workbench-shell.tsx` | 1574 changed | Gate 5 |
| `app/api/environment/line/route.ts` | +303 | Gates 2/5 |
| new: `lib/environment/summon.ts`, `world-execution.ts`, `decision-intent.ts` | — | Gates 2/3/5 |

### What PR #927 actually reserves, measured

`gh pr view 927 --json files` — **54 files** (`EXTERNAL_RECORD`, reproducible; an earlier pass in this
revision said 39 because the listing had been truncated at 40 — the conclusion below was re-derived
from the complete list). The Gate-relevant ones:

| Path | Gate |
| --- | --- |
| `lib/environment/working-world.ts` | **Gate 3** |
| `components/desk/desk.tsx` | **Gate 5** |
| `components/environment/environment.tsx`, `app/env/page.tsx` | Gate 5 — the §5.2 lineage collapse |
| `app/environment/page.tsx`, `app/api/environment/{line,view,world,runtime,compare}/…` | Gates 3/5 |
| `lib/environment/{world-service,world-projection,api-contract,…}.ts` | Gates 3/5 |

`lib/intent/workbench-action-registry.ts` is **not** in that list, and neither is `lib/intent/router.ts`.
Gate 2's registry seam is therefore not held by the takeover lane.

### Ruling (canonical lifecycle vocabulary)

The playbook's typed non-success states are enumerated at
`docs/governance/multi-agent-operator-playbook.md:178-193`, and lines 196-198 say plainly that stable
reason codes "are separate from lifecycle states" and "may not be substituted for lifecycle-state
names." Revision 1's `BLOCKED_AUDIT_FREEZE` was a reason code wearing a state's name. Corrected:

```
GATE 3, GATE 5: BLOCKED_RESERVATION
  reason code:      ENVIRONMENT_FRONTEND_TAKEOVER_921
  held by:          PR #927 on codex/environment-frontend-takeover-921 -- measured file reservation
                    over lib/environment/working-world.ts and components/desk/desk.tsx
  release:          #927 merges or is superseded, or #921 records a later verdict
  collision note:   origin/wb/primary-experience-replacement holds the same files as FROZEN CLAUDE
                    WORK. It is collision evidence, not a valid competing reservation, and must not
                    be extended.

GATE 2: BLOCKED_DEPENDENCY
  reason code:      GATE1_PREREQUISITE + RESERVATION_NOT_YET_TAKEN
  disposition:      EXTEND (a classification of the work, not a lifecycle state)
  basis:            #921's freeze is path-scoped to the Environment path; the Gate 2 registry seam
                    (lib/intent/workbench-action-registry.ts, lib/intent/router.ts) is outside it and
                    outside PR #927's measured file set.
  entry condition:  Gate 1 accepted (both halves, S7.6) AND a fresh bounded reservation is taken on
                    the registry seam per AGENTS.md fan-out rules.
  do not:           open a Gate 2 PR before that reservation exists. Two lanes converging one command
                    registry is the "second command registry" stop condition through the back door.
```

This is an **inter-agent sequencing fact read out of the existing record** — not an owner decision,
not a new authority, and not an owner ask. No owner action releases it.

`CLAUDE.md`'s reservation rule independently forbids claiming another builder's file, contract, branch
or worktree reservation, and it binds Gates 3 and 5 here on its own.

### Gate 1 freeze-scope and collision determination, re-measured

Revision 1 checked three path prefixes across six branches and declared Gate 1 uncontested. The
review found that proof incomplete: Gate 1 mutates `scripts/execution-fabric/` too, and the
measurement omitted it. Accepted. Re-measured across the **complete** Gate 1 path set and **every**
open-PR lane (`EXTERNAL_RECORD` for the lane list, `REPOSITORY_VERIFIED` for the diffs).

Path set measured: `lib/system/` · `app/api/fabric/` · `lib/fabric/` · `scripts/execution-fabric/` ·
`config/execution-fabric/` · `tests/`.

| Open PR lane | Gate 1 path touches |
| --- | --- |
| `wb/owner-directed-execution-doctrine` (#989) | `tests/session-surface-limits-not-owner-gate.test.ts` only |
| `wb/experience-v2-phase0-collision-map` (#988) | none |
| `feat/williamos-intelligence-fabric-package` (#965) | none |
| `wb/operator-identity-isolation` (#963) | one unrelated test file |
| `wb/start-work-honest-refusal` (#950) | none |
| `codex/hermes-goal-0024-28` (#949) | none |
| `codex/environment-frontend-takeover-921` (#927) | twelve unrelated test files |
| `codex/outcome-762-live-integration` (#915) | none |
| `claude/aeh-program-implementation` (#750) | AI-EvalOps harness test files only |

**No open lane touches any Gate 1 source path.** A full sweep of all 404 remote refs found three
branches that do touch them — `codex/issue-762-device-cockpit` (PR #766 MERGED, 372 commits behind),
`codex/issue-762-system-intent` (PR #765 CLOSED, 372 behind), `codex/william-os-execution-fabric-v0`
(PR #532 MERGED, 669 behind). All three are historical; none is an active reservation.

Freeze scope: Gate 1 is entirely `lib/`, API, `scripts/execution-fabric/`, `config/execution-fabric/`
and `tests/`. It touches no Environment route, no component, and no frontend composition, so #921's
path-scoped freeze does not reach it. #985's own disposition confirms it: #985 directs work at
`/api/fabric/nodes` — "preserve the live-probe / failure-reason doctrine, but do not freeze its
string-valued GPU/memory/disk/service summaries as the subresource model."

```
GATE 1: BLOCKED_DEPENDENCY
  reason code:      PREDECESSOR_MAP_DEFECTIVE (round 2, S11)
  note:             the bounded packet #990 exists and the reservation is uncontested, so the
                    packet dependency is met. What blocks Gate 1 now is that its own scope in S7.2
                    was written on defective premises -- most sharply the withdrawn registry-join
                    (S4.1) and the missing vram_source/version-wall scope. #990 must be amended
                    before its first commit.
  freeze scope:     clear -- outside #921's Environment-path freeze
  reservation:      uncontested -- measured above across the complete path set
  bounded packet:   #990 EXPERIENCE_V2_GATE1_SYSTEM_OBJECT_PROJECTION, opened under #987/#985 with
                    WO-985-GATE1-SYSTEM-OBJECT-PROJECTION (schemaVersion 2), the S7.2 reservation set,
                    the S7.5 invariants as acceptance, and the S7.6 1a/1b split.
                    charter:464-470 makes that packet the required predecessor of implementation, and
                    AGENTS.md:9-10 requires the active authority-matched Work Order. A documentation
                    PR is not that packet; #990 is.
  history:          revision 2 opened at FREEZE_SCOPE_CLEAR / NOT_YET_DEPENDENCY_CLEARED -- itself
                    a non-canonical status, corrected here -- and cleared the packet dependency by
                    opening #990. Round 2 then invalidated the scope that packet carries.
                    CONT-EXPV2-GATE1-PACKET is CLEARED; CONT-EXPV2-GATE1-RESCOPE replaces it (S9).
```

## 4. ARCHITECTURAL COLLISION — competing System representations

Two surfaces on `main` both claim to represent the machine room, from different truth sources, with no
shared object identity.

**A. `app/(shell)/system/page.tsx`** (226 lines) — "the truthful, read-only primary."
Sources: `getAuthReadiness` (one live ATLAS database probe), `buildRuntimeStatus` (configuration),
`getOperatorState` (queue/knowledge counts), and `lib/system/system-truth.ts` for node role truth.
It never probes a node. Composition is card sections.

**B. `app/(shell)/fabric/page.tsx` → `components/fabric/node-board.tsx` → `GET /api/fabric/nodes`.**
Sources: the runtime transport registry plus a live probe per node, on request. This is where real
machine state reaches the product. Composition is a `md:grid-cols-2` card grid.

Neither knows about the other. `/system` shows `HERMES: inferred (configured role)` while `/fabric`
can simultaneously hold a live measured probe of the same machine. That is precisely the
"stale/inferred state presented beside live state with no shared identity" failure the charter forbids.

Concrete defect in the shared type:

```ts
// lib/system/system-truth.ts:1
export type SystemName = "ATLAS" | "HERMES" | "AEGIS"
```

**OMEN is absent from the System truth model** while being an owner-directed node in the Execution
Fabric seed and named in the charter as a first-class machine identity. `/system` structurally cannot
represent OMEN. `ConfiguredSystemRole` (`system-truth.ts:3`) compounds it by deriving roles as
`Exclude<SystemName, "ATLAS">` — a two-entry closed set, not a registry read.

**Ruling.** `SUPERSEDE_COMPOSITION_ONLY` for both card compositions; their *truth semantics* are
`REUSE`. The canonical SystemObject projection (Gate 1) becomes the single source both surfaces
consume. Fixing `SystemName` is in Gate 1 scope because Gate 1 must address every owner-directed node.

### 4.1 TWO node registries, not one — the correction the review forced

Revision 1 said node truth was "re-derived from `config/execution-fabric/registry.seed.json`" because
`~/.williamos/fabric/nodes.json` was absent on this host, and then treated the two as the same
registry. **They are different registries with different shapes, different owners and different
guarantees, and conflating them would have corrupted Gate 1's identity model.** Accepted P0 finding.

| | **Transport registry** | **Execution Fabric inventory** |
| --- | --- | --- |
| Location | `~/.williamos/fabric/nodes.json` (runtime, per host) | `config/execution-fabric/registry.seed.json` (tracked) → `.artifacts/execution-fabric/registry.snapshot.json` |
| Shape | name-keyed map: `{ transport, host, user, os, role, enrolled }` (`route.ts:30-37`) | `schema_version: "0.2"` document with a `nodes` **array** (`registry.seed.json:1-9`) |
| `os` | a bare string, used only to pick a shell dialect (`route.ts:117`) | an object `{family, version}` validated against `$defs.os` |
| Identity | the map key; no machine pin | `identity.machine_id_sha256` + source, pinned and enforced (`assemble-registry-core.mjs:473-483`) |
| Owns | **connection configuration only**: transport, host, user, enrolment. **Not reachability** — the record has no such field (`route.ts:30-37`), and revision 2 assigned it one. See the `OBSERVED REACHABILITY` rule below, which this row previously contradicted (round 4 finding 3) | identity, hardware inventory, owner-directed role, authority allow/deny, evidence freshness, capability health |
| Readers | `route.ts:106-118`, `lib/fabric/registry.mjs:50-52`, `lib/fabric/broker.mjs`, `run-baseline.mjs:232-234` | `assemble-registry.mjs` → `assemble-registry-core.mjs`, placement/admission scripts |
| Writers | `updateNodeFields` — fingerprinted optimistic-concurrency merge (`registry.mjs:62-66`) | reviewed seed edits + probe evidence overlay |
| Digest pinning | none | `assemble-registry.mjs:15-16,42-43` hard-pins seed and schema SHA-256 |

`scripts/execution-fabric/README.md:29-44` states the intended division directly: "Node probes
describe machine identity and inventory. Capability snapshots describe independent service readiness.
Neither source grants execution authority," and the assembler "overlays live discovered
hardware/runtime facts onto the declared role/authority seed."

**Classification: `COLLISION / ADAPT`.** Not `REUSE`. Gate 1 must join them explicitly rather than
letting `SystemObject` trust whichever it read first.

#### The join and precedence rules Gate 1 must implement

Round 2 of the review rewrote these rules, because revision 2 wrote them from what the transport
registry *ought* to contain rather than from `route.ts:30-37`, which is the whole of it:
`{ transport, host, user, os, role, enrolled }`. No machine-identity pin, no reachability field, no
timestamp. Three of the four rules depended on fields that do not exist.

```
IDENTITY, HARDWARE, OWNER-DIRECTED ROLE, AUTHORITY, EVIDENCE FRESHNESS
    -> Execution Fabric inventory. Authoritative. A machine identity not pinned in the seed is NOT
       promoted (README:42-44; assemble-registry-core.mjs:473-483).

CONNECTION CONFIGURATION AND ENROLMENT (transport, host, user, os-dialect, enrolled)
    -> transport registry. Authoritative for HOW to attempt a connection, and nothing more.

OBSERVED REACHABILITY AND FAILURE REASON
    -> neither registry. Measured per request by the brokered probe (route.ts:113-127). The transport
       registry has no reachability field; revision 2 assigned it one.

JOIN -- NO cross-registry resolver exists. What exists is duplicated ALIAS and AUTHORITY data,
       which is a different thing, and round 4 finding 2 caught this section conflating them.
    -> What genuinely exists, three times over, all INSIDE the inventory side:
       hostname-to-node-id aliases hardcoded in both canonical probes (probe-windows.ps1:10-12,
       OMEN -> omen, HERMES -> hermes-node; probe-linux.sh:51, atlas -> atlas, aegis -> aegis);
       the assembler's own hardcoded roster (assemble-registry-core.mjs:655-660); and the
       assembler's canonical authority allow/deny catalogue per node (:32+), enforced against the
       seed at :699-704. So the seed is NOT the sole owner of identity, roster or authority.
    -> But NONE of those reads the transport registry's shape at route.ts:30-37, and none joins the
       two registries. The only readers of nodes.json are broker.mjs and run-baseline.mjs:232-234,
       both for transport resolution alone. S5.1 says so in its own table: the relationship between
       the two registries is COLLISION / ADAPT, "no join today".
    -> The withdrawn conclusion. This section previously said "the resolver ALREADY EXISTS, so Gate 1
       must not write a second one", and S11 row 15 accepted "a new one is a FOURTH owner" on that
       basis. It does not follow: a consolidation module that derives the aliases from one contract
       REPLACES three copies rather than adding a fourth, and joining transport to inventory is work
       nothing on main does at all. Gate 1 owns both jobs, and S15 row 48 records the correction.

    -> A transport record cannot be joined by machine pin before probing, because it carries no pin.
       Ordering: transport data selects a PROVISIONAL ENDPOINT; the canonical probe then observes the
       host identity; only a match against the reviewed seed pin promotes it to a canonical node.

CONFLICT
    -> the transport registry's `role` is an operational label and MUST NOT override the seed's
       owner-directed `role`. Where they disagree, project both and mark the transport side
       CONFLICTING -- not `stale`. Staleness is a temporal claim and that record has no timestamp to
       support one.

ABSENCE
    -> inventory-only node: projects, with transport UNKNOWN.
    -> transport-only record: an UNVERIFIED ENDPOINT CANDIDATE. It does NOT project as a canonical
       SystemObject, because promotion requires an observed identity matching a reviewed pin.
       Revision 2's symmetric rule would have promoted any line in a local JSON file to a node.
    -> Never fabricate the missing half; never silently drop the record.
```

### 4.2 Accelerator truth on `main` — what the record actually says

**Finding A — the tracked seed records no P40 on HERMES.** The only on-`main` declared accelerator
inventory for `hermes-node` (`registry.seed.json:66`) is:

| `id` | model | `vram_bytes` | `uuid` | `pci_bus_id` |
| --- | --- | --- | --- | --- |
| `gpu0` | GeForce RTX 3050 | 6442450944 | `null` | `null` |
| `gpu1` | Quadro K2200 | 4294967296 | `null` | `null` |

The charter's first System proof, #985's first proof, and #983's HUD proof are all
`SYSTEM -> HERMES -> P40`. **No canonical on-`main` record evidences a P40 on HERMES.**

Precision the review required: this is *the only on-main declared seed record located*, not "the only
record that exists." The repository cannot prove the absence of a runtime snapshot or external record.
And the record is explicitly declared rather than observed —
`"probe": "declared-seed; live probe required"`, `"confidence": "declared"`, `"ttl_seconds": 0`,
`generated_at` 2026-08-09 (`registry.seed.json:57`). It is a **declared seed awaiting live probe**,
not current registry truth.

That absence is now understood and is **correct system behavior, not a defect**: the owner is
physically installing the P40 as this map is written. WilliamOS is rightly refusing to attest hardware
it has not observed. §7.6 turns HERMES's return into an automatic discovery test rather than a
declaration.

This is the identity discipline #985 demands ("replacement hardware must not inherit history only
because it occupies the same slot/name") and #974 demands (`IDENTITY` evidence separate from
`HEADROOM`). Gate 1's projection must be able to represent an accelerator whose identity is `UNKNOWN`
pending probe, rather than asserting a P40 that no evidence supports.

**Finding B — the `/api/fabric/nodes` route observes GPUs weakly, on both dialects.**

```ts
// route.ts:50  Linux  -- name and total only, semicolon-joined; driver in a separate field at :51
//   nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | paste -sd';'
// route.ts:64  Windows (brokered) and route.ts:86 probeLocal() -- name only, no memory field at all:
//   "gpu=" + ((Get-CimInstance Win32_VideoController).Name -join ";")
```

Through this route a Windows node's accelerators yield a display name and nothing else — no VRAM
total, no VRAM used, no utilization, no temperature, no UUID, no PCI bus id. The "parse the GPU
string" problem on the Linux path is real; on the Windows path there is not even a number to parse.

Two corrections revision 1 got wrong here:

- **Which path measures HERMES is a runtime fact, not an identity fact.** Revision 1 said "HERMES
  serves the application, so it is measured by `probeLocal()`." The route selects local versus
  brokered purely from the transport registry's `transport` field (`route.ts:117`). Node identity
  never enters that choice; the `os` field only picks the dialect. Whether HERMES is the local node is
  a property of the deployment's `nodes.json`, which this repository does not contain.
- **`Win32_VideoController.Name` is a driver display string and is not a durable identity**, on any
  path. That part stands.

Until a live probe lands, every HERMES accelerator field except the name is `UNKNOWN`, and #974's rule
applies: unknown stays `UNKNOWN` and must not be rendered as zero or as live.

## 5. Collision map — classification by primitive

Legend: `REUSE` = reuse as is · `EXTEND` = extend existing · `SUPERSEDE` = supersede composition only ·
`ADAPT` = adapt at boundary · `COLLISION` = two owners that must be reconciled · `MISSING` = genuinely
missing.

### 5.1 System / fabric truth

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| **Node identity + hardware + authority inventory** | `config/execution-fabric/registry.seed.json` → `assemble-registry.mjs` → snapshot | `REUSE` — canonical | Machine-identity pinned; unpinned nodes stay declared and unschedulable (`README:42-44`). |
| **Node transport registry** | `~/.williamos/fabric/nodes.json` via `lib/fabric/registry.mjs` | `REUSE` for transport | Fingerprinted optimistic-concurrency merge, `RegistryConflict`, `RegistryFieldLoss`. Correct as a transport registry. |
| **The relationship between those two** | — | `COLLISION / ADAPT` | **§4.1.** Different shapes, different owners, no join today. Gate 1 owns the resolver and the precedence rules. Revision 1 called this one registry; it is two. |
| Node command transport + audit | `lib/fabric/broker.mjs`, `lib/fabric/audit.mjs` | `REUSE`, **with the audit guarantee stated correctly** | Unknown node → `BrokerDenied`; host keys pinned (`run-baseline.mjs:243-251`). `brokeredExec` **already supports local execution** (`broker.mjs:96-104`). But "every outcome including refusals audited" was **false**, and round 3 was right to attack it: `auditFabricAction` returns early when the ledger root is absent — `if (!(await hasLedger(fabricRoot))) return` (`audit.mjs:33`) — so **a missing ledger directory silently disables auditing entirely and reports success**. On top of that the denial path (`broker.mjs:91`) and the execution-error path (`:111`) are both `.catch(() => {})`'d. Only the two success paths (`:102,107`) await without a catch. Accurate statement: **successful execution is fail-loud only when the ledger root already exists; refusals, errors, and every path under an absent ledger are best-effort.** |
| Live node probe | `app/api/fabric/nodes/route.ts` | `ADAPT` | Keep: probe-on-request, unreachable-with-reason, per-platform dialect, `cache-control: no-store`. Wrong for V2: emits `Record<string,string>`; weak GPU query; **and a raw local transport, next row**. |
| **`probeLocal()` raw transport** | `app/api/fabric/nodes/route.ts:76-92` | `SUPERSEDE` — **named, was hidden** | Runs `execFile("powershell", …)` directly at `:90`, bypassing the broker: no `BrokerDenied` check, no audit entry. `broker.mjs:96-104` already does local PowerShell *with* audit. Revision 1 claimed "all Gate 1 probing goes through `brokeredExec`" and "preserve brokered-only execution" — both false while this exists. Gate 1 removes it. |
| System truth classes | `lib/system/system-truth.ts` | `EXTEND` | Keep `live/persisted/inferred/unknown` + configured-role-is-not-liveness. Must add `stale`, add `OMEN`, and derive configured roles from the Fabric inventory rather than `Exclude<SystemName,"ATLAS">`. |
| Baseline capability gate | `lib/fabric/baseline.ts`, `/api/fabric/baseline` | `REUSE` **as a mutating all-node acceptance gate** | Reclassified — see §5.6. Not the first journey's safe action. |
| `/system` page | `app/(shell)/system/page.tsx` | `SUPERSEDE` | Truth semantics reused; card composition superseded. |
| `/fabric` node board | `components/fabric/node-board.tsx` | `SUPERSEDE` | Same. |
| **Canonical structured accelerator observation** | `scripts/execution-fabric/probe-windows.ps1:86-127`, `probe-linux.sh:146-162` → `assemble-registry-core.mjs` | `EXTEND_EXISTING_PROBE` (#974 vocabulary) | Both probes run the identical query `uuid,name,pci.bus_id,memory.total,driver_version,temperature.gpu,utilization.gpu` and emit structured per-device records. #974 is explicit: extend this evidence path, do not create another hardware-monitoring database. |
| **Specialist VRAM-used / headroom producers** | `pinned-evidence-registry.mjs:146-152,177-179`; `collect-resident-hermes-embedding-evidence.ps1:58-64`; `lab-control/hermes/lab-health.ps1:26-27` | `SPECIALIST_RUNTIME_METRIC` (#974 vocabulary) | **Revision 1 missed these entirely** and concluded headroom was "unobtainable fabric-wide." False — §6.6. They are legitimately specialist: bounded-dispatch admission evidence and operator health display, each with its own contract. Gate 1 does not absorb them; it must not contradict them. |
| Accelerator reservation / fencing | — | `MISSING` (quantitative only) | `reservation` in the codebase means Work-Order path/contract reservation, not accelerator residency. Do not conflate. **#973 forbids an independent GPU lock authority**: the fencing tokens, holder digests and stale-lock recovery in `scripts/multi-agent-operator/reservation-ledger.mjs` are the required substrate, and only quantitative VRAM/KV capacity is genuinely missing. Out of Gate 1 scope either way. |

### 5.2 Environment / Workbench composition

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| `WorkingWorldSnapshot` meaning/chrome separation | `lib/environment/working-world.ts` | `EXTEND` — **`BLOCKED_RESERVATION` (§3)** | The `CHROME_KEY_PATTERN` tripwire and `WORLD_UNKNOWN_KEY` refusal are exactly the discipline Gate 3 needs. Reserved by PR #927's measured file set. |
| Working-world persistence | `workingWorld` table (`lib/db/schema.ts:369`), `migrations/0012-working-world.sql` | `REUSE` | Meaning, not pixels, already durable. |
| **`/env` → `Environment` → `/api/env/line`** | `app/env/page.tsx:4,13`, `components/environment/environment.tsx:36,75` | `SUPERSEDE` — **superseded predecessor, still on main** | #919 (`ddcfa607`, 2026-08-20 10:46). Slice one: worldId / intent / turns / surfaces over `/api/env/line`. |
| **`/environment` → `Desk` → `/api/environment/line` + `/view`** | `app/environment/page.tsx:4,24`, `components/desk/desk.tsx:33,71,201` | `SUPERSEDE` — **`BLOCKED_RESERVATION` (§3)** | #922 (`2d83948f`, 2026-08-20 12:15), 89 minutes later: "the replacement root — greenfield beside the legacy." Near-identical state shape to `Environment`, different route root. This is the #921-authoritative lineage; PR #927 continues it. |
| Workbench shell | `components/workbench/workbench-shell.tsx` (781 lines) | `SUPERSEDE` | Primitives (restoration, Inspector concept, Execution panel, status strip) are `EXTEND`; the four-mode navigation ontology is `SUPERSEDE`. |
| Thread durable conversation + projections | `lib/workbench/thread-conversation.ts`, `thread-projection.ts`, `thread-registry.ts`, `load-threads.ts` | `REUSE` | Chronology stays authoritative. Semantic map is a projection above it, never a replacement. |
| Project / project resource | `lib/projects/*`, `project`/`projectResource` tables | `REUSE` | Project ≠ repository; do not infer from path. |
| Shell navigation | `components/shell/nav-items.ts`, `sidebar-nav.tsx`, `mobile-nav.tsx` | `SUPERSEDE` | Page taxonomy → semantic world navigation, keeping useful shortcuts. |

**Three compositions, not two.** Revision 1 counted `(shell)` Workbench versus `/environment` Desk and
missed `/env` + `Environment` entirely. #982 asks to "reconcile Workbench and Environment without a
third shell" — and a third greenfield root already shipped. PR #927 touches **both**
`app/env/page.tsx` and `app/environment/page.tsx`, so the takeover lane is already collapsing the
pair; the resolution is its to make, and this map records the seam rather than racing it.

### 5.3 Command / action — two halves, not one registry

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| **Navigation-target catalogue** | `lib/intent/workbench-action-registry.ts` (81 lines) | `EXTEND` | 4 static `mode` descriptors (`:12-17`) + capabilities derived from `supportingCapabilities` (`:44-51`), each `{id, kind: "mode"\|"capability", label, href, keywords, navigationAliases}`. `matchWorkbenchNavigationTarget` refuses ambiguity by returning `null` unless exactly one phrase matches — the disambiguation invariant the charter demands, and it must survive generalization. No object kind, no action kind, no authority field, no context ranking. |
| **Intent → action-kind / destination catalogue** | `lib/intent/router.ts` | `EXTEND` — **competing half, previously misclassified** | Revision 1 called this merely "a consumer of the registry." It is not. `router.ts:31-53` owns `SIGNALS`, its own regex classification catalogue for answer/research/council/outcome/execution; `router.ts:55-61` owns `DESTINATIONS`, mapping each to an `{href, action}` pair; `router.ts:14-17` owns the action-kind union `respond \| research \| council_review \| start_outcome \| request_execution \| navigate`. It consumes `matchWorkbenchNavigationTarget` for the navigation case only (`:65`). **Two static catalogues, two owners, one concept.** |

| **Command catalogue with its own execution authority** | `scripts/williamos_commands.py`, `control-center/backend/command_center.py`, `control-center/backend/copilot/tools.py` | `COLLISION / ADAPT` — **third catalogue, found in round 2** | Revision 2 said "two halves". Wrong, and wrong in the most consequential direction: this one *gates execution*. `command_center.py:140` classifies every registered command with `allowed`, `runnable`, `confirmation_required`, `safety_tier` and `execution_path: "safety.py -> command_runner.py"`, and `copilot/tools.py:52-55` publishes "OpenAI/Ollama function schemas for **every registered command**" — the whole catalogue, callable by a model. 103 tracked files under `control-center/`, last moved 2026-07-14 (`ed289371`, #363). |

**Gate 2 must converge these three into one Object + Action Registry**, and the third is the one that
matters most: the charter's rule is that a registry **never grants authority**, and this catalogue
carries a safety tier and a confirmation gate in front of a real execution path. Revision 2's "two
halves" was not merely an undercount — it missed the only catalogue on `main` that already decides
whether something may run.

Disposition is a Gate 2 decision and this map does not pre-empt it: retire, migrate, bridge, or
explicitly fence `control-center/`. What it may not be is unmentioned.
 #987's finding — "existing
`workbenchActionRegistry` is the predecessor for one Object + Action Registry, but it is currently
navigation-only" — names only one of the two halves. This map records the second. Note also that
`router.ts:23` hardcodes `executionAuthorized: false` and `authority.granted: false`: "the registry
never grants authority" is already shipped behavior, and must survive the merge.

### 5.4 Epistemic / memory / decisions

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Memory facts + authority lifecycle | `memoryFact` (`schema.ts:111`) | `EXTEND` | `authority` (`unreviewed→working→reviewed→canon→deprecated/superseded/archived`), `supersededById`, `stale`, `pinned`, `embedding vector(1024)`. Strong substrate, and the canonical one. |
| **Second memory database** | `control-center/backend/copilot/memory.py` | `COLLISION / ADAPT` — **found in round 2** | Revision 2 asserted "**No second memory database.**" That was false. This is a live SQLite store owning `sessions`, `messages`, `facts` and `fact_events` (`memory.py:24-52`), constructed at import time (`control-center/backend/app.py:54`) and served through `/api/memory/facts`, `/api/memory/review`, `/api/memory/export` (`app.py:426,448,453`). Worse than a duplicate store: `memory.py:54-63` defines `_FACT_AUTHORITY_STATES` as `intake, unreviewed, working, reviewed, canon, deprecated, superseded, archived` — **the canonical `memoryFact.authority` lifecycle, re-declared in a second system, plus one extra state**. Two owners of the same authority vocabulary is precisely the seam Gate 4 would have inherited. |
| Context compartment / world scoping | — | `MISSING` | `memoryFact` has `userId` + `tags[]` and no governed compartment column. `documentChunk` likewise scopes by user. Doc 21's gap statement is confirmed in the schema. Gate 4 concern. |
| Decision register | `decision` (`schema.ts:133`) | `EXTEND` | `status`, `authority` (binding/advisory/informational), `scope`, `evidence[]`, `locked`, `supersedesId`/`supersededById`. Maps onto `DECIDED`/`SUPERSEDED`. |
| Doctrine | `doctrine` (`schema.ts:159`) | `REUSE` | `allowed[]`/`forbidden[]`/`requiresApproval[]` — the policy-diff substrate Gate 11 will need. |
| **Claim lifecycle: confidence, freshness, evidence, expiry** | `truthClaim` (`schema.ts:1106-1122`) | `EXTEND` — **not missing** | Revision 1 classified epistemic state as wholly `MISSING`. Refuted by the schema: `truthClaim` already owns `truthType` (`STATIC \| SESSION \| VOLATILE \| EVIDENCE \| LOCK \| UNKNOWN \| STALE \| ASSUMED`), `confidence`, `freshness` (`fresh\|aging\|stale`), `evidenceId`, `verificationRequiredBefore[]`, `status`, and an `expiresAt` column that **shipped behaviour does not own**: writes cannot set it and reads recompute freshness from truth type and capture time (`app/actions/truth.ts:34-35,50,68`). It is an inert column, not an expiry owner -- §11 row 29, which pointed here without the correction ever landing until round 3 caught it. `agentClaim` (`:1126-1142`) owns `SELF_REPORTED \| EVIDENCE_BACKED \| UNSUPPORTED \| CONFLICTING \| REQUIRES_VERIFICATION`. |
| Brain Council reasoning packet | `components/brain-council/brain-council-reasoning.ts:24-40` | **noncanonical projection predecessor** | Already shapes question / evidence / unknowns / hypotheses / ranking / confidence, with `safety.readOnly: true`. Its content is a static literal (`:42-`), so it is a UI-side predecessor, not an authority. Do not promote it; do not ignore it when naming the vocabulary. |
| Unified epistemic lifecycle `QUESTION`/`HYPOTHESIS`/`OBSERVED`/`LIKELY`/`PROVEN`/`DISPROVEN` | — | `MISSING` — **narrowed** | What is genuinely absent is the *unified state machine over one subject*, and the transitions between those states. It must reconcile **onto** `truthClaim`/`agentClaim`/`decision`/`doctrine` authority, never beside it. `parkedIdea` (`schema.ts:1188`) is a partial predecessor for `IDEA`/`PARKED`. |

### 5.5 Temporal / evidence / authority

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| **Governance append log** | `governanceEvent` (`schema.ts:839`) via `lib/governance/events.ts` | `REUSE`, **with its guarantees stated correctly** | Closed event-type set (`events.ts:11-34`) and never updated in place — both true. But revision 2 called it "hash-chained" and "tamper-evident", and it is neither. `beforeHash`/`afterHash` (`events.ts:64-65`) are independent hashes of the *before* and *after payloads*; there is no prior-event hash, no sequence, no head pointer (`schema.ts:839-853`), so nothing detects a deleted or reordered event. And `appendGovernanceEvent` **swallows its own write failures** into a `console.log` (`events.ts:56-71`), by explicit design — "governance logging must never itself become a failure that blocks the operator" (`:52-54`). It is a best-effort append log with per-event payload hashes. |
| **Signed owner-authority status chain** | `scripts/multi-agent-operator/authority-events.mjs` | `REUSE` — **a distinct authority record, found in round 2** | A separate signed, linked chain governing dispatch and revocation, consumed by `scripts/multi-agent-operator/codex-coordinator-adapter.mjs`. It is not the same thing as `governanceEvent`, and revision 2 conflated the two by giving `governanceEvent` this one's properties. Gate 6's `CAUSE` sources must include it. |
| **Register narrative feed** | `eventLog` (`schema.ts:1210`) via `lib/registers/events.ts` | `REUSE` — **not a competing authority** | Open `type: string` with `logEvent`/`getRecentEvents` (`registers/events.ts:14-31`). No hash chain, no closed type set. It is a display feed, not an authority. Recorded here because a reviewer flagged the pair as a possible second event authority; it is not, but Gate 6 must not confuse them. |
| Evidence records | `evidenceRecord` (`schema.ts:809`) | `REUSE` | |
| Authority grants | `authorityGrant` (`schema.ts:859`) | `REUSE` | Approval ≠ authority; explicit unexpired unrevoked grant required. |
| Queue receipts | `outcomeQueueAcquisitionReceipt`, `outcomeQueueMutationReceipt`, `goalOutcomeIntakeReceipt` | `REUSE` | |
| Conflicts, locks | `conflictRecord`, `lockRecord` | `REUSE` | |
| `NOW`/`TREND`/`HISTORY`/`CAUSE` projection | — | `MISSING` | Gate 6. Projection only, over **`governanceEvent` + `evidenceRecord` + receipts + the signed authority chain** — not the narrative feed, and not a new authority. #987: "do not create a new generic event authority." Gate 6 must also decide what to do about the two swallowed-write paths above: a projection built on a log that may silently be missing entries will present absence as evidence of absence. |

### 5.6 Governed mutation — and the corrected "one safe action"

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Execute guard | `lib/governance/execute-guard.ts` | `REUSE` | Locked the execute loop to a non-mutating surface. |
| Fixed mutating-operation catalogue | `lib/resource/mutation.ts` | `REUSE` — **model for Gate 2** | `MUTATING_OPERATIONS = ["relocate-source","restore-database"]`. Chosen by name, never caller text; source/destination from the resource record, never a request; refuses unsafe paths rather than escaping them; nothing deletes. The exact shape an object action registry must adopt. |
| **`POST /api/fabric/baseline`** | `app/api/fabric/baseline/route.ts`, `lib/fabric/run-baseline.mjs` | `REUSE` **as a mutating, all-node acceptance gate** | **Revision 1 called this read-only, selected-node and brokered. All three were false.** |
| Read-only resource probe | `lib/resource/probe.ts` | `REUSE` | Fixed catalogue `PROBE_KINDS = ["exists-size"]` (`:23`); read-only by construction. |
| **`POST /api/resource/verify`** | `app/api/resource/verify/route.ts` | `REUSE` — **the corrected first-journey action** | See below. |

#### What `POST /api/fabric/baseline` actually does

| Revision 1 claim | Verdict | Evidence |
| --- | --- | --- |
| "on a selected node" | **FALSE** | The route takes no body and calls `runAllBaselines(registry)` (`baseline/route.ts:18,23`), which loops every node in the registry (`run-baseline.mjs:382-386`). |
| "read-only" | **FALSE** | It starts a hidden process or `docker run`s a container (`run-baseline.mjs:330-338`), writes a file on the node and hashes it there (`:341-348`), then force-stops the process / `docker rm -f`s the container and deletes the files (`:361-369`). |
| "already governed through the broker" | **FALSE** | `sh()` calls `exec("powershell", …)` or `exec("ssh", sshArgs(…))` directly (`run-baseline.mjs:309-318`). It never calls `brokeredExec`, so it never gets the `BrokerDenied` unknown-node refusal. Host keys *are* pinned, via `sshArgs` (`:243-251`). |
| "already audited" | **BEST-EFFORT ONLY** | Every step calls `auditFabricAction` on success and on failure (`run-baseline.mjs:270,298,304`) — but **both calls are `.catch(() => {})`'d**, deliberately: "Auditing must not be able to fail the step it is describing, so a ledger error is swallowed here" (`:294-297`). A fleet-wide start / transfer / force-stop / delete can therefore complete with **no durable audit record**, and nothing reports that it did. Revision 2 first recorded this row as a flat `TRUE`; round 2 of the independent review attacked it and was right. |
| "reason-preserving on failure" | **TRUE** | Each step carries a named `meaning` for what its failure implies (`lib/fabric/baseline.ts:28-35`). |

Baseline is a genuine and valuable capability gate. It is a **multi-step mutation across the whole
fabric**, and pulling it forward as "the one safe governed action" would have taught Gate 2 that a
fleet-wide start / transfer / force-stop cycle is what a safe object action looks like. Its
authorization is a session check and nothing more (`baseline/route.ts:13-14`) — no authority grant, no
fencing.

#### The replacement revision 2 nominated - withdrawn

Revision 2 nominated **`POST /api/resource/verify`** as "the corrected first-journey action". Round 2
of the review dismantled that, on four independent grounds, the first of which is fatal alone:

1. **The charter asks for a mutation, and this is a read.** `charter:273` - "The first implementation
   journey needs only **one safe governed mutation**"; `charter:488-489` - "Owner performs one safe
   governed **adjustment**. WilliamOS verifies actual post-state." Revision 1 picked a mutating action
   and mis-described it as read-only; revision 2 picked a read-only action and mis-described the
   requirement as read-only. Same root cause, opposite direction: neither revision read the line.
2. **It cannot reach HERMES.** The only probe command is POSIX shell -
   `if [ -e ... ]; then du -sb ...; else echo MISSING; fi` (`probe.ts:144-150`) - while `brokeredExec`
   sends local and Windows nodes through PowerShell (`broker.mjs:102,107`). HERMES is a Windows node,
   so the first proof `SYSTEM -> HERMES -> P40` is structurally out of reach, and the dialect failure
   would surface as *node unreachable* rather than as a dialect mismatch.
3. **It selects a `project_resource`, not a SystemObject.** A different object graph entirely.
4. **It is not user-scoped.** `verify/route.ts:31-32` checks only that a session exists; the lookups at
   `:46-54` and `:56-60` filter on `identity` alone, with no `userId` predicate. Any authenticated user
   can name any identity - including another user's record - and cause a brokered probe against the
   node that record names. Revision 2 held this route up as the exemplar of governed action.

Its genuinely good properties survive as a **read-only predecessor**, and Gate 2 should keep them:
fixed probe catalogue chosen by KIND and never by caller text (`probe.ts:14,22-24`), target derived
from the record with unsafe paths refused rather than escaped (`:87-101`), brokered with audit
(`verify/route.ts:83-84`), skips reported rather than dropped (`:125-140`).

What it does satisfy, and what it only appears to:

| #985's requirement | What the route actually does |
| --- | --- |
| selected object | The request carries `identity` and nothing else (`verify/route.ts:34-41`). |
| deterministic action | Probe chosen from a fixed catalogue by KIND, never by caller text (`probe.ts:14,23`). |
| read-only | `PROBE_KINDS = ["exists-size"]`; "adding one that writes would defeat the point of the seam" (`probe.ts:22-24`). |
| governed execution | Dispatched through `brokeredExec` with `action: "resource-verify"` (`verify/route.ts:83-84`) — audited, unknown node denied. |
| target not inferred | Node comes from the record's identity prefix; unsafe or relative paths are refused, not escaped (`probe.ts:87-101`). |
| observed post-state | `readObservation` returns `exists`, `observedBytes`, `recordedBytes`, `agrees` (`probe.ts:35-44`, `verify/route.ts:87`). |
| evidence | *Attempts* a governance event (`verify/route.ts:1,117`) - but `appendGovernanceEvent` swallows insertion failures (`events.ts:56-71`), so evidence is attempted, never guaranteed. |
| honest partiality | What could not be probed is reported with a reason, not silently dropped (`probe.ts:125-140`). |

One property is worth carrying forward to whatever Gate 2 builds, and the previous version of this
paragraph stated it wrongly in both halves. It said the broker was "the only place on `main` where
audit is fail-loud" and that "a brokered command that cannot reach the ledger fails rather than
completing unrecorded". §13 row 36 had already established otherwise for §5.1, and the correction
never reached here — the same one-section-not-the-other failure as §13 rows 43 and 45.

**What the code does.** `broker.mjs:55` is `export const auditBrokerAction = auditFabricAction`: a
straight alias, so §5.1's finding and this paragraph are about one function. `audit.mjs:34` opens
with `if (!(await hasLedger(fabricRoot))) return`. **When the ledger root is absent the call returns
silently and the brokered command completes unrecorded** — the exact outcome the withdrawn sentence
denied. `AUDIT_UNAVAILABLE` (`audit.mjs:47`) is thrown only when the root exists and the append
itself fails. On the two success paths (`broker.mjs:102,107`) that throw is not caught, so it
propagates; the denial and error paths swallow it (`:91,111`).

**And it is narrower still than §5.1's correction says.** `hasLedger` memoises per `fabricRoot` in a
module-level `Map` (`audit.mjs:24-31`), so absence is cached for the process lifetime: "the ledger
root already exists" means "existed at the first check in this process", and a ledger created
afterwards is never noticed.

Accurate statement: **a brokered command fails loudly on an unwritable ledger only when the ledger
root was present at the first check in that process; under an absent root the whole audit path is
silent.** "The only place on `main`" is withdrawn as an unscoped negative with no search behind it —
pattern B, asserted in a section rewritten after the rule against unscoped negatives was adopted.
Baseline is worse, not better: it swallows on the **success** path (`run-baseline.mjs:298`). Any
action Gate 2 builds needs an audit that fails loudly on an absent ledger, which neither has.

That is a property of `brokeredExec`, though, not of `resource/verify` — and it does not rescue the
nomination. The route's own evidence write, one layer up, is best-effort (`events.ts:56-71`).

#### So which action proves the first journey? None on `main` today.

That is the honest answer, and saying it is more useful than nominating a third wrong candidate. Every
existing option fails a named property:

| Candidate | Fails |
| --- | --- |
| `POST /api/fabric/baseline` | all-node, not selected; unbrokered raw transport; best-effort audit |
| `POST /api/resource/verify` | not a mutation; POSIX-only, so it cannot reach HERMES; wrong object graph; not user-scoped |
| `relocate` / `restore` (`lib/resource/mutation.ts`) | correctly shaped, but they move a multi-hundred-gigabyte source or restore a database - far past "safest", and the charter forbids inventing an unsafe action for the demo |

#### Correction (round 3): the charter says CHOOSE, and this section reversed it

`charter:273-274` reads, in full:

> The first implementation journey needs only **one** safe governed mutation. **Choose the safest
> existing canonical action** that proves the architecture. Do not invent an unsafe action to satisfy
> the demo.

Revision 3 quoted the first sentence and concluded from it that Gate 2 must **build** the action. The
second sentence says the opposite: *choose the safest existing canonical action*. "Do not invent an
unsafe action" is not permission to invent a safe one.

This is the **third consecutive revision to get this one requirement wrong**, and the third by the same
mechanism: revision 1 read it as read-only and picked a mutating action; revision 2 read it as
read-only and picked a read-only action; revision 3 read half the line. The map bound itself in its
status section to quoting controlling requirements rather than paraphrasing them, then paraphrased
this one by truncation — which is harder to see than a paraphrase, because every word quoted was
accurate.

**So the disposition is reopened, not settled.** Two outcomes are legitimate and this map does not get
to skip between them:

1. an existing canonical action qualifies and Gate 2 adopts it — the charter's instruction, and it
   requires a *scoped* search for candidates rather than the three this section happened to consider;
2. no existing action qualifies, and that is a **charter amendment**, obtained explicitly, not assumed
   by a map. `CONT-EXPV2-FIRST-ACTION` is retyped accordingly (§9).

What the three candidates below do establish is that `baseline`, `resource/verify` and
`relocate`/`restore` each fail a named property. That is evidence toward (2); it is not a search, and
it is not an amendment.

**If an existing action is adopted, its shape is already
settled by `lib/resource/mutation.ts`: chosen from a fixed catalogue by name and never from caller
text, target derived from the record and never from the request, unsafe input refused rather than
escaped, nothing deletes. What Gate 2 must add, taken directly from the failures above: a SystemObject
subject, dialect-aware execution through the broker, session-user scoping on every lookup, durable
evidence rather than best-effort, and verified post-state.

Recorded as `CONT-EXPV2-FIRST-ACTION` (§9).

### 5.7 Native shell

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Cockpit / Tauri shell | `cockpit/src-tauri/` (with `capabilities/`, `permissions/`, `tests/`), `cockpit/ui/` | `REUSE` (constrained) | Already has an explicit capability/permission boundary. Doctrine: `docs/governance/omen-cockpit-boundary.md`. Gate 8 only; holds no authority. |

### 5.8 Personalization

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Owner preference store | — | `MISSING` | No preference table in `lib/db/schema.ts`. `memoryFact.kind` includes `"preference"` (`schema.ts:115`), but that is a memory fact, not an inspectable preference record with `owner-set`/`suggested`/`learned-confirmed` provenance. Independently confirmed by #987: "No credible canonical Experience V2 preference store was found." Gate 10. Keep narrow. |

## 6. Duplication findings to resolve, not to add to

1. **Two System representations** — §4. Must converge on the Gate 1 projection.
2. **Two node registries with no join** — §4.1. The Gate 1 resolver, not a third registry.
3. **Three frontend compositions**: `(shell)` Workbench, `/env` + `Environment` (#919), `/environment`
   + `Desk` (#922). #982 asks for reconciliation "without a third shell"; three roots already exist.
   PR #927 touches both greenfield roots and owns that collapse (§3, §5.2).
4. **`SystemName` omits OMEN** — §4. Concrete, small, in Gate 1 scope.
5. **Two command/action catalogues** — `workbench-action-registry.ts` and `lib/intent/router.ts`
   (§5.3). Gate 2 converges them.
6. **GPU observation is spread across eight producer rows — nine executable query sites — not two.** Revision 1 counted two and
   concluded headroom was fabric-wide unobtainable. The full enumeration on `main`:

   | Call site | Query | Class (#974) |
   | --- | --- | --- |
   | `probe-windows.ps1:90` | `uuid,name,pci.bus_id,memory.total,driver_version,temperature.gpu,utilization.gpu` | canonical — `EXTEND_EXISTING_PROBE` |
   | `probe-linux.sh:148` | identical query | canonical — `EXTEND_EXISTING_PROBE` |
   | `probe-windows.ps1:109-126` | `Win32_VideoController` fallback; `AdapterRAM` → `vram_bytes` + warning | canonical fallback — needs projection semantics (§7.4) |
   | `route.ts:50-51` | `name,memory.total` + `driver_version` separately | **duplicate observer — Gate 1 removes it** |
   | `route.ts:64`, `route.ts:86` | `Win32_VideoController.Name` only | **duplicate observer — Gate 1 removes it** |
   | `collect-resident-hermes-embedding-evidence.ps1:58` | `memory.total,memory.free` | `SPECIALIST_RUNTIME_METRIC` — bounded-dispatch admission |
   | `lab-control/hermes/lab-health.ps1:26` | `name,temperature.gpu,memory.used,memory.total,utilization.gpu` | `SPECIALIST_RUNTIME_METRIC` — operator health display |
   | `lab-control/LabControl.psm1:403` | `name` only | `SPECIALIST_RUNTIME_METRIC` — display |

   **Used VRAM and headroom are already produced and validated on this fabric** — stated as capability,
   not as an observation this map witnessed: `pinned-evidence-registry.mjs:148` *requires*
   `vram_total_mb`, `vram_free_mb` and `vram_used_mb` per GPU, and `:159,162,179` enforce a
   `gpu_vram_headroom_mb` minimum before an inference capability may read `READY`. That validation
   checks numeric shape and a free-VRAM threshold; it does **not** check used/free/total consistency,
   and the repository cannot show that any particular snapshot was ever collected. Revision 2 wrote
   "already observed", which claimed a session fact from a code fact.

   And the pinned-evidence path is more than a metric consumer: `recommend-pinned-placement.mjs:108`
   with `pinned-evidence-registry.mjs:443,511` derives a **competing node inventory** whose GPU array
   is keyed by index with null UUID and PCI data. It must be classified as a placement-only
   projection, forbidden from owning or overwriting canonical identity, and required to bind
   observations by durable GPU identity or leave them UNKNOWN. What is missing is narrow and exact: **`memory.used` is absent from the node-probe query
   and from the canonical registry GPU schema**, so headroom cannot reach the System Object Graph
   *through the canonical inventory path*. That is the gap Gate 1 closes.
7. **The blanket negative revision 2 asserted here was false, and the reason is worth naming.**
   Revision 2 said "no second scheduler, memory system, event authority, node inventory, or command
   registry was found on `main`." It had searched only the TypeScript/Next surface, while calling
   `main` implementation truth. `main` also contains 103 tracked files under `control-center/` and a
   Python command registry, and round 2 of the review found both. Corrected:

   | Concept | Canonical owner | Second owner on `main` |
   | --- | --- | --- |
   | memory + fact authority lifecycle | `memoryFact` (`schema.ts:111`) | `control-center/backend/copilot/memory.py:24-63` — §5.4 |
   | command catalogue + execution gate | `workbench-action-registry.ts`, `lib/intent/router.ts` | `scripts/williamos_commands.py` via `command_center.py:140`, `copilot/tools.py:52` — §5.3 |
   | event authority | `governanceEvent` | `scripts/multi-agent-operator/authority-events.mjs` (signed chain — a *distinct* record, not a duplicate) — §5.5 |
   | node identity / role / authority | `registry.seed.json` | `assemble-registry-core.mjs:32+` `canonicalAuthority`, enforced at `:699-704`; roster at `:655-660`; hostname→node-id maps in `probe-windows.ps1:10-12` and `probe-linux.sh:51` — §4.1 |
   | Work Order admission vs outcome dispatch | `scheduleEligibleSet` (`eligible-set-scheduler.mjs:1635`) | `acquireNextEligibleOutcome` (`outcome-queue-source.mjs:4360`) + `createHermesOutcomeQueueRuntime` (`outcome-queue-runtime.mjs:1283`) — **not a second owner; a boundary that was never drawn.** See below |

   **This row has now been wrong twice, in opposite directions, and the second time was mine.**

   Round 2 accepted "no second scheduler" as a P0. Revision 3 deleted the claim without replacing it,
   leaving §11 row 6 pointing here at nothing — a negative deleted is not a negative answered (§12 row
   34). The replacement I then wrote said "two executable selectors exist… not a second owner, a
   boundary." Round 3 attacked that and both halves failed.

   **This row has now been wrong three times, and each correction was wrong the same way.** Revision
   2 said "no second scheduler" with no search behind it. Revision 3 replaced it with "two executable
   selectors", also with no search stated. Round 3 found four and this row asserted **four** — again
   without stating the sweep. Round 4 found a fifth. A count keeps being asserted because a count
   reads as a finding; what was missing every time is the search that would justify one.

   **The sweep, stated — with what it actually returned, not with what survived it.**

   ```
   git grep -nE 'function (select|acquire|schedule)[A-Za-z]*(Eligible|Next|Outcome|WorkOrder)' \
     -- '*.mjs' '*.ts' ':!node_modules'
   ```

   Eight hits outside `tests/`. Stating a sweep and then presenting only the survivors would be the
   same defect one level down, so all eight are classified here:

   | Hit | Classification |
   | --- | --- |
   | `eligible-set-scheduler.mjs:1635` `scheduleEligibleSet` | selector implementation |
   | `outcome-queue-source.mjs:4360` `acquireNextEligibleOutcome` | selector implementation |
   | `outcome-source.mjs:1276` `selectNextOutcome` | selector implementation |
   | `lib/outcome-queue/engine.ts:277,431` `selectNextOutcome` / `acquireOutcome` | selector implementation (one pure engine, two entry points) |
   | `operational-kernel.mjs:122` `selectEligibleWorkOrder` | selector implementation — **the one round 4 found and this row had missed** |
   | `outcome-queue-runtime.mjs:1355` `selectOutcome` | **not** a distinct implementation: a nested function inside `createHermesOutcomeQueueRuntime`, delegating to the queue-source acquisition above |
   | `scheduler-model-check.mjs:478` `schedulerModelWorkOrder` | **not** a selector: a model-checking fixture builder |

   **And the sweep is not the sole provenance of the table below.** `createHermesOutcomeQueueRuntime`
   (`outcome-queue-runtime.mjs:1283`) does not match that pattern and came from round 3. The table is
   therefore the union of this grep and prior findings, which is precisely why no count is asserted:
   a sweep phrased differently will return a different set, and two phrasings have now each missed
   something the other caught.

   | Implementation | Object | Substrate |
   | --- | --- | --- |
   | `scheduleEligibleSet` (`eligible-set-scheduler.mjs:1635`, 2295 lines) | Work Order lanes from a DAG | file-backed reservation ledger + lane lease store + evidence ledger, under a pinned trust bundle (`:1640-1644,1653`) |
   | `acquireNextEligibleOutcome` (`outcome-queue-source.mjs:4360`) + `createHermesOutcomeQueueRuntime` (`outcome-queue-runtime.mjs:1283`) | outcome-queue items | Postgres |
   | `selectNextOutcome` (`scripts/hermes-bridge/outcome-source.mjs:1276`) | goals/outcomes — the legacy selector, still the orchestrator default | — |
   | `selectNextOutcome` / `acquireOutcome` (`lib/outcome-queue/engine.ts:277,431`) | outcomes — used by the operator projection | TypeScript |
   | `selectEligibleWorkOrder` (`scripts/runtime-operator/operational-kernel.mjs:122-142`), called at `:235` and `:304` | READY Work Orders, filtered by completion, authority-registry match and dependency closure | the native runtime-operator authority registry, walled to `bsvalues/terragroq` at `:123` |

   **The fifth was found by round 4, not by the sweep that produced the fourth.** That is the finding
   worth keeping: this row is where an unstated-sweep negative was supposed to be repaired, and the
   repair repeated the defect. **No count is asserted here.** What is established is that at least
   five distinct selector implementations exist across four substrates, that the sweep above is the
   first one this document has written down, and that it is demonstrably incomplete — it does not
   return `createHermesOutcomeQueueRuntime`, which round 3 found by other means.

   **And `scheduleEligibleSet` is not "plan-time admission".** It acquires reservations and leases
   through `acquirePhaseTwoClaim`, each with a fencing token, and drives the lifecycle
   `PLANNED → AUTHORITY_MATCHED → DEPENDENCY_CLEARED → RESERVED → LEASED → PROVIDER_DISPATCHED`
   (`:1785`) via `acquirePhaseTwoClaim` (`:1265-1305`, called at `:1792`), and records
   `RESERVATION_ACQUIRED` and `LIFECYCLE_PROVIDER_DISPATCHED` at **`:1805-1806`** — the previous
   version of this sentence cited `:1792` for those two records, which is the `acquirePhaseTwoClaim`
   call (round 4 finding 16, found independently by the delivering lane). It
   reserves, leases, fences, dispatches, releases and reaps — the same verbs as the queue side. The
   "admission vs acquisition" distinction I drew does not exist in the code.

   So the shared surface is not "exactly one concept". They overlap on **dependency eligibility,
   authority and policy admission, risk/capability gating, fencing, leasing, and dispatch** — the
   whole lifecycle, implemented more than once over more than one object graph and substrate.

   **Correct classification, and it is deliberately weaker than either previous attempt:** these are
   *distinct overlapping scheduler authorities with an unproven handoff*. No call boundary between
   them has been evidenced in this map. "Not a second owner" is **not established**, and neither is
   "a second owner" — what is established is that at least five implementations of one concern exist
   and nobody has written down how they compose. Enumerating and classifying each as supported runtime,
   fallback, projection/pure engine, or Work-Order scheduler is real work with a real owner, recorded
   as `CONT-EXPV2-SELECTOR-INVENTORY` (§9). It is not something a paragraph in a collision map
   disposes of, which is what both previous versions of this row tried to do.

   A negative claim is only as wide as the search behind it. Any future "no second owner" statement in
   this program must state the surfaces it searched, or it is not a finding.

## 7. Gate 1 — the smallest valid Phase 1 slice, rescoped

**Bounded child:** canonical `SystemObject` projection over existing fabric truth, read-only.

Status: **`BLOCKED_DEPENDENCY`**, reason `PREDECESSOR_MAP_DEFECTIVE` — the state §7.6 gives Gate 1a,
which this section introduces. The previous version said `DEPENDENCY_CLEARED` here and let §7.6
contradict it two pages later (round 4 finding 7).

Two axes, because collapsing them is how the contradiction arose:

- **Packet axis: cleared.** The reservation is uncontested and the bounded child packet exists —
  **#990** `EXPERIENCE_V2_GATE1_SYSTEM_OBJECT_PROJECTION`, carrying
  `WO-985-GATE1-SYSTEM-OBJECT-PROJECTION` with this section's reservation set, §7.5 as acceptance,
  and the §7.6 split. It has been amended (§9 `CONT-EXPV2-GATE1-RESCOPE`).
- **Lifecycle axis: blocked.** A cleared packet is not a startable gate. Gate 1 does not start while
  its predecessor map is defective, and four rounds have now said it is.

### 7.1 The convergence rule, corrected

Revision 1 proposed that `route.ts` issue and parse its own `nvidia-smi` query on both dialects while
the standalone probes were separately extended. The review's verdict is accepted: that is a **third**
structured GPU observer, not a convergence, and it directly contradicts revision 1's own §6 finding.
Revision 1's proposed query also silently dropped `driver_version`, which both canonical probes carry.

The corrected direction:

```
canonical probe (probe-windows.ps1 / probe-linux.sh)   -- the only CANONICAL PER-DEVICE INVENTORY
                                                       observer. NOT the only structured GPU
                                                       observer: collect-resident-hermes-embedding-
                                                       evidence.ps1:58 runs its own nvidia-smi
                                                       --query-gpu and emits structured resource
                                                       fields (:139). That is a SPECIALIST_RUNTIME_
                                                       METRIC producer (S6.6) and stays out of Gate 1,
                                                       but "the ONLY structured GPU observer" was
                                                       false. Scope searched: TypeScript/Next, Python,
                                                       PowerShell, shell, .mjs, config/JSON.
    -> registry.schema.json $defs.gpu                  -- the ONLY canonical GPU record shape
        -> assemble-registry-core.mjs                  -- the ONLY validator/assembler
            -> registry.snapshot.json                  -- the canonical inventory
                -> SystemObject projection             -- read-only, no authority
                    -> /api/fabric/nodes structured observations (additive, alongside `fields`)
```

`/api/fabric/nodes` **consumes** canonical output. It does not re-observe. Its remaining live
responsibility is reachability and the existing string `fields` for backward compatibility.

### 7.2 Scope — the seams Gate 1 must reserve

Revision 1's scope stopped at the probe scripts. The canonical record is schema-validated and
digest-pinned, so a probe field the schema does not know is not an addition — it is a rejection. The
full seam:

- **`config/execution-fabric/registry.schema.json`** — extend `$defs.gpu` with **both**
  `vram_used_bytes` **and** `vram_source`. `$defs.gpu` is `additionalProperties: false` (`:74-90`), so
  a probe emitting *either* field fails validation. Revision 2 scoped only the first while §7.4
  required the second — the projection rules would have been unimplementable against the canonical
  record. Bump `schema_version`; do not remove `driver_version`.
- **`scripts/execution-fabric/assemble-registry-core.mjs`** — the assembler validates every probe GPU
  against `$defs.gpu` (`:449,455-458`); on failure it calls `recordInvalidProbe`, returns `null`
  (`:485-488`), and the node falls back to the declared seed. Round 2 sharpened this in two
  directions, and both matter:
  - **narrower than revision 2 said**: GPU validation and copying are driven *dynamically* from
    `$defs.gpu` (`:446,540`), so an added GPU property needs no assembler edit of its own. Gate 1
    reserves and tests this file; it does not necessarily change it for the field alone.
  - **wider than revision 2 said, but not as wide as round 2 claimed.** Round 2 reported "hardcoded
    `v0.2` semantic checks at `:653,699,700,704`" and revision 3 accepted it without opening the
    lines. They are **error-message strings**, not version checks: `:653` is
    `errors.push('scheduler must remain disabled and unauthorized in v0.2')` guarding
    `seed.scheduler.state !== 'disabled'` (`:652`), and `:699,700,704` push
    `` `...differs from canonical v0.2 policy` `` guarding the authority allow/deny/bounded-compute
    comparisons. The literal `'0.2'` occurs **exactly once** in the file — the emitted
    `schema_version: '0.2'` at `:720`. A grep for `v0.2` hits five lines; one of them is a version.

    So a `schema_version` bump changes `:720`, and leaves those three error strings saying "v0.2"
    about a v0.3 registry — stale wording to fix, **not** an assembly failure. "Fails assembly
    outright" was false.

    There *is* a real version wall in this file, and neither round found it: `:437` rejects any probe
    whose `schema_version !== '0.1-node-probe'`. That is the **node-probe** schema, a different
    contract from the registry schema, and it is the one that fails closed. The `exactKeys`
    node-shape check (`:433`) must likewise accept any new node-level field.
  - the fallback is also **not silent**: it records `LIVE_PROBE_INVALID` and adds a fail-closed
    scheduling constraint (`:455,509`). Warned fail-closed, not silent — revision 2 overstated it.
- **`scripts/execution-fabric/assemble-registry.mjs`** — the production entrypoint hard-pins the seed
  and schema JCS digests (`:15-16`) and fails closed with `FABRIC_REGISTRY_ENTRYPOINT_WALL` on
  mismatch (`:42-43`). A schema change **must** update `expectedSchemaSha256`, or every production
  assembly stops. This is the single easiest way to break the fabric while believing Gate 1 succeeded.
- **`scripts/execution-fabric/probe-windows.ps1`, `probe-linux.sh`** — extend the query by exactly one
  field, `memory.used`, keeping `driver_version` and one identical field order on both dialects:
  `uuid,name,pci.bus_id,memory.total,memory.used,driver_version,temperature.gpu,utilization.gpu`.
  Without it #974's `HEADROOM` class cannot reach the canonical inventory, and total capacity would be
  the only number available — which #974 explicitly forbids from masquerading as reservable capacity.
- **`config/execution-fabric/registry.seed.json`** — the declared GPU records gain the new field as
  `null`. Declared is not observed. The seed digest pin moves with it.
- **`lib/system/system-object.ts`** — new. Object kinds `NODE` and `ACCELERATOR` only. Canonical
  identity, human label, kind, parent/contains, owner-directed role, truth state including `stale`,
  `observedAt`, health/headroom, technical identity under progressive disclosure. A projection, not an
  authority.
- **`lib/system/registry-join.ts`** — **withdrawn as scoped.** Revision 2 called this "new". It is
  not: the hostname-to-node-id resolver already exists, hardcoded in `probe-windows.ps1:10-12` and
  `probe-linux.sh:51`, beside a hardcoded roster (`assemble-registry-core.mjs:655-660`) and a
  hardcoded per-node authority catalogue (`:32+`, enforced `:699-704`). Writing a new resolver would
  have made a **fourth** owner of node identity in a map whose purpose is to stop exactly that.
  Gate 1's real task here is **consolidation**: derive or validate every alias from one contract, and
  make the probes and assembler read it rather than restate it. That is a larger and more valuable
  piece of work than the join revision 2 imagined, and it is the reason Gate 1a's scope is re-opened
  rather than merely corrected.
- **`lib/system/system-truth.ts`** — extend: add `OMEN`, add `stale`, derive configured roles from the
  Fabric inventory rather than `Exclude<SystemName, "ATLAS">`.
- **`app/api/fabric/nodes/route.ts`** — adapt: emit **structured typed observations** alongside the
  existing string `fields` (additive, so `components/fabric/node-board.tsx` keeps working and the
  change is revertible). Consume canonical probe output rather than querying GPUs itself. **Delete
  `probeLocal()`** and route local nodes through `brokeredExec`, which already handles and audits
  local PowerShell (`broker.mjs:96-104`). Preserve probe-on-request, reason-preserving unreachability
  and `cache-control: no-store`.
- **`tests/execution-fabric-registry.test.ts`** — extend: schema acceptance/rejection, assembler
  round-trip, digest-pin currency, freshness.
- **`tests/system-object-projection.test.ts`** — new.

### 7.3 Explicitly out of Gate 1

Any UI change; the action registry; WorkingWorld; accelerator reservation/fencing; `MODEL_RESIDENCY`;
consumers-by-process; temporal projections; and the specialist producers of §6.6 — Gate 1 must not
contradict them and must not absorb them. Object classes beyond `NODE` and `ACCELERATOR` — #985's full
class list (`CPU`, `MEMORY_POOL`, `DISK`, `SERVICE`, `WORKLOAD`, …) is the eventual target, not this
slice.

### 7.4 Fallback VRAM — projection semantics, stated

Revision 1 asserted an invariant its own canonical producer violates: it required the
`Win32_VideoController` fallback to project VRAM as `UNKNOWN`, while `probe-windows.ps1:116` emits
`AdapterRAM` as `vram_bytes` and only *warns* that it "may understate VRAM above 4 GiB" (`:125`). Two
incompatible rules cannot both be canonical. Resolved as a qualified observation:

```
GPU record gains, alongside vram_used_bytes:
    vram_source: "nvidia-smi" | "win32-videocontroller" | null

PROJECTION RULES (Gate 1 tests these)
  vram_source = "nvidia-smi"             -> measured total. May be presented as capacity.
  vram_source = "win32-videocontroller"  -> QUALIFIED LOWER BOUND.
                                            Never presented as capacity.
                                            Never used to compute headroom.
                                            Never compared against a model's VRAM requirement.
                                            Projects as UNKNOWN with a lower-bound annotation.
  vram_source = null / field absent      -> UNKNOWN. Never 0.
  used VRAM absent                       -> headroom UNKNOWN. Never total-minus-nothing.
```

This keeps the canonical probe honest — it keeps observing what CIM can see — while making it
impossible for that observation to masquerade as measured VRAM, which is #974's hard gate.

### 7.5 Invariants to test

1. An accelerator's canonical identity derives from GPU UUID / PCI bus id, never from the friendly
   name or slot; a device with a new UUID in the same slot is a **new** object. (#985 identity rule.)
   **And the invariant must survive the records that actually exist**: the Windows CIM fallback emits
   `uuid: null, pci_bus_id: null` (`probe-windows.ps1:109-126`) and the declared HERMES GPUs are
   `uuid: null, pci_bus_id: null` (`registry.seed.json:66`). A UUID/PCI-only rule cannot represent
   either. Such observations project as **identity-unresolved** — visible, truthful, and explicitly
   ineligible to inherit or accumulate canonical history — rather than being dropped or silently
   keyed on something weaker.
2. A client can enumerate a node's accelerators without parsing any presentation string. (#985
   acceptance.)
3. An unreachable node still projects, with `truthState: unknown` and its preserved reason. (#985
   "offline objects remain visible truthfully".)
4. A probe older than the freshness bound projects `stale`, never `live`. (#974 freshness classes.)
5. Every owner-directed node in the Fabric inventory — including OMEN — is representable.
6. The projection exposes no mutation and no authority. (#985 "object projection never grants
   authority".)
7. The §7.4 projection rules hold: a fallback-sourced `vram_bytes` never becomes capacity, never
   yields headroom, and never renders as `0`.
8. Total VRAM never presents as reservable/free capacity. (#974 hard gate.)
9. **Schema/assembler round trip**: a probe carrying `vram_used_bytes` validates and reaches the
   snapshot; a probe carrying an unknown GPU property is still rejected and still falls back to
   declared, with the rejection recorded.
10. **Digest-pin currency**: the schema digest that `assemble-registry.mjs` pins matches the schema on
    disk. A test must fail if a schema edit lands without the pin moving.
11. **Registry join**, tested in both directions and in both outcomes:
    - an inventory-only node projects, with transport `unknown`;
    - a transport-only record does **not** project as a canonical `SystemObject`. It is an unverified
      endpoint candidate (§4.1), and a test asserts it is neither promoted nor dropped;
    - **successful join**: a probe whose observed host identity matches a reviewed seed pin promotes
      that endpoint to the pinned node;
    - **mismatched join**: a probe whose observed identity does not match the pin leaves the record
      unpromoted, with the mismatch preserved as the reason rather than reported as unreachable.

    Revision 2's symmetric "both project with `unknown`" rule survived into this invariant after §4.1
    had already withdrawn it, so the acceptance criterion tested the behaviour the join rules forbid.
    It also never tested a join *succeeding* or *mismatching*. The transport record carries no machine
    pin — `{ transport, host, user, os, role, enrolled }` and nothing more
    (`app/api/fabric/nodes/route.ts:30-37`) — which is why promotion has to be an **observation
    result** and cannot be a lookup.
12. **No unbrokered transport on the canonical probe path**: no code path reachable from
    `GET /api/fabric/nodes` executes a node command outside `brokeredExec`. Deliberately narrowed —
    revision 2 wrote "no Gate 1 code path", which `lib/fabric/run-baseline.mjs:309-318` contradicts
    on the very day it was written. Baseline's raw transport is a real defect (§5.6) but it is not
    Gate 1's to fix, and an invariant that is false at merge teaches nothing.
13. **Precedence**: a transport-registry `role` that disagrees with the seed's owner-directed role does
    not override it; both are projected and the transport side is marked `CONFLICTING`. **Not
    `stale`** — §4.1 withdrew that word because the transport record carries no timestamp to support a
    temporal claim, and this invariant kept it anyway.

### 7.6 Gate 1 splits in two — one blocked on this map, one on HERMES's return

Recorded owner direction, 2026-08-24: HERMES is offline because the P40 is being physically installed.
The absence of a canonically attested P40 is therefore **expected and correct** — the system is
rightly refusing to attest hardware it has not observed. That is a good truth-semantics result and is
not treated as a defect anywhere in this map.

The review's merge-threshold finding and that direction converge on the same answer: split the gate.

```
GATE 1a -- SCHEMA / PARSER / PROJECTION            BLOCKED_DEPENDENCY
  reason code: PREDECESSOR_MAP_DEFECTIVE
  note:        revision 3 said RELEASABLE NOW while S9's CONT-EXPV2-GATE1-RESCOPE simultaneously said
               #990's scope was defective and Gate 1a must not start on it. Both cannot be true, and
               round 3 caught the contradiction. #990 has since been amended (S12), so what remains is
               that THIS map is still MAP_DEFECTIVE after three rounds. Gate 1a becomes releasable when
               the map's Gate 1 scope survives a review round, not before.
  when clear:  content and evidence below are unchanged and correct
  content:     S7.2 in full, S7.4 projection rules, S7.5 invariants 1-13
  evidence:    deterministic tests with synthetic probe fixtures; the deterministic CI suite green
  merges on:   its own tests. It claims NO runtime proof and must not.
  terminal?    NO. Accepting 1a does not accept Gate 1.

GATE 1b -- LIVE RUNTIME SETTLEMENT                 BLOCKED_DEPENDENCY
  reason code:            WAITING_EXTERNAL_ENVIRONMENT
  condition:              HERMES_REACHABLE
  continuation:           automatic
  ownerDecisionRequired:  false
  content:     the discovery sequence below, executed against the real machine
  mandatory:   before Gate 2 terminal acceptance. Gate 2 may not be accepted on 1a alone.
  scheduler:   this state must not park unrelated eligible work. Non-HERMES work continues.
```

**Why the state name changed, and what did not change with it.** Round 4 finding 9 is correct that
`WAITING_EXTERNAL_ENVIRONMENT` is **not** a lifecycle state: `playbook:178-193` enumerates the
closed set and does not contain it, and `:195-198` forbids substituting a reason code for a state
name. This map applied that exact rule to reject `EXTEND, dependency-gated` and
`FREEZE_SCOPE_CLEAR / NOT_YET_DEPENDENCY_CLEARED` (§11 row 26) and then exempted this label without
saying why. The charter introduces it at `charter:246-260`, but `AGENTS.md:3-11` names the playbook, as amended
by its supersession, the controlling doctrine and says that where a subordinate document conflicts
with it the conflicting action stops and the doctrine is followed. Lifecycle vocabulary is the
playbook's. (An earlier draft of this paragraph cited `AGENTS.md:80-84`, which governs
*directory-local* `AGENTS.md` files and does not reach the charter at all — corrected here rather
than quietly, because a citation that does not say what it is claimed to say is this document's
recurring defect.)

So the label is retyped as what it is: the canonical lifecycle state `BLOCKED_DEPENDENCY` with
`WAITING_EXTERNAL_ENVIRONMENT` as the **reason code**, exactly the shape `:195-198` requires.

**The owner's recorded direction is untouched by this.** `condition: HERMES_REACHABLE`,
`continuation: automatic`, `ownerDecisionRequired: false` and discovery-not-declaration acceptance
all carry over unchanged — they were the substance of the direction, and none of them depended on
the label being a lifecycle state. This is a vocabulary correction, not a re-decision, and it does
not become an owner question.

#### Gate 1b acceptance — DISCOVERY, NOT DECLARATION

WilliamOS must **discover** the changed machine. The owner must never have to say "I installed a P40,
update your database." The registry currently holds stale declared GPU truth for HERMES (RTX 3050 +
Quadro K2200, null uuids, `ttl_seconds: 0`), so reconciling the real changed hardware through the
canonical probe path — with no hand-maintained configuration — is the first real-world proof of #974
and #985. Gate 1b passes only if this sequence completes without a hand edit:

```
HERMES boots
  -> the existing canonical probe path runs (probe-windows.ps1, unchanged in kind)
  -> hardware inventory observed
  -> a new accelerator identity appears (UUID / PCI bus / model / VRAM bound)
  -> compared against previous hardware truth in the snapshot
  -> WilliamOS records "New accelerator discovered on HERMES"
  -> capability remains UNKNOWN until measured
  -> bench / evaluation
  -> capability evidence
  -> admission
```

Three epistemic facts, never conflated:

1. **`P40 EXISTS`** — established by observation alone, at boot. Not by the owner saying so.
2. **`P40 HEALTHY`** — established by health measurement.
3. **capability** — Pascal support, model X at context Y, current VRAM headroom — established only by
   bench/evaluation evidence.

A Gate 1b run that produces a P40 object with a capability state better than `UNKNOWN` before bench
evidence exists is a **failure**, not a success.

#### Prerequisites, and their current state

| Prerequisite | State |
| --- | --- |
| Test execution | **MET** — deterministic CI profile, green (§8.1) |
| Branch / commit / push / PR | **MET** — this document is delivered through it |
| Fabric inventory read access | **MET** — `config/execution-fabric/registry.seed.json`, tracked |
| Transport-registry shape | **MET** — from `route.ts:30-37` and `tests/fabric-registry-writes.test.ts:21`; the file itself is absent on this host, which is why §4.1 keeps the two registries distinct rather than assuming one |
| Authority-matched bounded child packet | **MET** — #990, opened under #987/#985 and **amended** for the round-2/3 rescope (§3, §9, §12) |
| Gate 1 scope reviewed clean | **NOT MET** — this map is `MAP_DEFECTIVE` after three rounds (§13). Gate 1a is `BLOCKED_DEPENDENCY`, not releasable |
| Live HERMES accelerator observation | **`BLOCKED_DEPENDENCY`**, reason `WAITING_EXTERNAL_ENVIRONMENT` — Gate 1b; automatic continuation on `HERMES_REACHABLE` |

## 8. Phase 0 report

```
PHASE: 0 -- Reconciliation freeze (#987 Gate 0)
STATUS: NOT PASSED (revision 4). FOUR independent adversarial rounds, all MAP_DEFECTIVE.
        Each round found defects inside the previous round's corrections. Round 4 was the first to
        attack in both directions and overturned two findings this map had ACCEPTED. The method is
        the defect; see the status section at the top.

        This block is regenerated from the body at each revision. Round 4 finding 6 caught it three
        revisions stale -- still naming resource/verify as the first action, still calling headroom
        "already observed", still citing a non-canonical lifecycle vocabulary, still saying one
        re-review remained, and still saying NEXT: build Gate 1a. It is the section that states the
        gate verdict, so a stale claim here is controlling, not historical.

CURRENT TRUTH DISCOVERED
  Backend truth primitives are strong but NOT singular -- "singular" was an unscoped uniqueness
  claim contradicted by this map's own S5.3/S5.4/S5.5/S6.7, which name a second memory + fact-authority
  store, a third command catalogue that gates execution, a distinct signed authority chain, and
  multiple selector implementations. Searched surfaces: TypeScript/Next, Python (control-center/,
  scripts/), PowerShell, shell, .mjs, config/JSON. What is strong: the Execution Fabric inventory with pinned
  machine identity, a fingerprint-merged transport registry, brokered audited transport,
  probe-on-request with preserved failure reasons, system truth classes, memory authority lifecycle,
  decision/doctrine supersession, a best-effort governance append log with independent before/after
  payload hashes and no chain (S5.5), evidence, authority grants, queue
  receipts, truth/agent claims, and a fixed-catalogue mutation surface with post-state verification.

  What is missing is a CROSS-SURFACE ADDRESSABLE PROJECTION AND IDENTITY RESOLVER. The underlying
  object models are NOT missing: registry.schema.json already defines identified gpu, disk, runtime
  and node objects. What no surface can do is address one of them as a stable thing, from more than
  one place, under one identity. Resource state reaches the product as a string on a node.

  Corrected in revision 2, and material:
  - TWO node registries, not one. The runtime transport map and the Execution Fabric inventory have
    different shapes and different owners. Revision 1 conflated them. Gate 1 owns the join (S4.1).
  - probeLocal() is a raw unbrokered PowerShell transport in the fabric route. Revision 1 claimed
    brokered-only execution. brokeredExec already handles local, audited (S5.1).
  - POST /api/fabric/baseline is an ALL-NODE MUTATING gate on a raw transport, not the read-only
    selected-node brokered action revision 1 claimed (S5.6). Revision 2 then nominated
    POST /api/resource/verify as the first journey action; that nomination was WITHDRAWN ENTIRELY
    in revision 3 (S11 rows 9-14) -- it mutates nothing, emits POSIX shell only, selects a
    project_resource rather than a SystemObject, and filters without userId. NO first action has
    been selected; the charter-required search has not been run (S5.6, S9 CONT-EXPV2-FIRST-ACTION).
  - Used VRAM and headroom are PRODUCED AND VALIDATED by specialist producers on this fabric --
    stated as capability, not as an observation this map witnessed (S11 row 28). Revision 1 called
    headroom fabric-wide unobtainable, which is false; revision 2 said "already observed", which
    claimed a session fact from a code fact. What is missing is memory.used from the node-probe
    query and the canonical GPU schema (S6.6).
  - lib/intent/router.ts is a competing static action catalogue, not a registry consumer (S5.3).
  - THREE frontend compositions exist, not two: /env (#919) shipped beside /environment (#922) (S5.2).
  - truthClaim already owns claim confidence/freshness/evidence. Its expiresAt column is INERT:
    writes cannot set it, reads recompute freshness (truth.ts:34-35,50,68). Epistemic state is EXTEND,
    not MISSING; only the unified lifecycle is new (S5.4).
  - Extending the probes alone would be REJECTED by the canonical schema and silently replaced by
    declared seed data. Gate 1 must move the schema, the assembler and the digest pin together (S7.2).
  - #921 freezes Claude mutations on the ENVIRONMENT PATH. Gates 3/5 are BLOCKED_RESERVATION behind
    PR #927's measured file set; Gate 2 is BLOCKED_DEPENDENCY on Gate 1. BLOCKED_AUDIT_FREEZE,
    "EXTEND, dependency-gated" and FREEZE_SCOPE_CLEAR / NOT_YET_DEPENDENCY_CLEARED are all
    non-canonical against playbook:178-193 and are withdrawn (S3, S11 row 26).
  - At least FIVE selector implementations exist across four substrates, and no count is asserted:
    the sweep is stated in S6.7 and is demonstrably incomplete. Revision 2 said none, revision 3
    said two, round 3 said four, round 4 found a fifth (S15 row 47).
  - NO cross-registry resolver exists. Duplicated hostname aliases and authority catalogues are real
    and sit inside the inventory side; nothing on main joins transport to inventory (S4.1, S15
    row 48).

REUSED    (see S5) Execution Fabric inventory + assembler, transport registry, broker+audit,
          execution-fabric node probes, resource probe/verify, memory/decision/doctrine authority,
          governance events, event log, evidence, authority grants, receipts, execute guard, fixed
          mutating-operation catalogue, Thread/Project canonical objects, Cockpit capability
          boundary, reservation ledger fencing.
EXTENDED  none -- no code was changed in this Phase 0 delivery.
SUPERSEDED none -- no composition was removed in this Phase 0 delivery.
NEW       three governance documents:
            docs/governance/williamos-experience-v2-implementation-charter.md
            docs/governance/williamos-experience-v2-phase0-collision-map.md
            docs/governance/williamos-experience-v2-phase0-review-evidence.md

TESTS     The DETERMINISTIC CI PROFILE is the acceptance gate, not an ad-hoc local full-suite run.
          .github/workflows/ci.yml:24,53 runs `vitest run --config vitest.ci.config.ts`, which
          excludes only files that cannot pass on a hosted runner, each with a recorded reason
          (vitest.ci.config.ts:10-22), and raises testTimeout/hookTimeout to 60s for tests that spawn
          real subprocesses (vitest.ci.config.ts:32-36).

          RESULT: GREEN, locally and in CI. See S8.1 for the run.

          One green run is not determinism, and round 2 was right to say so. The profile changes
          exclusions and raises timeouts; it does nothing that explains SCHEDULER_LOCK_WALL
          HEARTBEAT_START_REQUIRED. Call it the repository CI ACCEPTANCE profile. The scheduler
          signature stays recorded as unexplained SESSION_OBSERVED evidence until someone isolates
          it -- not as a resolved item.

          Revision 1 recorded a five-file "failing allowlist" from a base-config local run and
          concluded a green suite was unobtainable on this host. That was wrong on its own evidence:
            - execution-fabric-hermes-embedding-bakeoff.test.ts and lab-dev-preflight.test.ts are
              ALREADY excluded from the deterministic profile, with reasons, as host-dependent;
            - hermes-bridge-supervisor.test.ts and execution-fabric-pinned-placement.test.ts failed
              at the base config's 5000ms default, which the CI profile raises to 60000ms precisely
              for those subprocess-spawning tests;
            - the run used the wrong profile.
          A failing-FILE allowlist is also unsound as an acceptance rule: a new regression inside an
          already-red file passes it silently.

          GATE 1 ACCEPTANCE RULE, corrected:
            1. The deterministic CI profile must be GREEN. Not "no new failing file".
            2. Gate 1's own focused tests (S7.5) must PASS.
            3. Any host-only failure outside that profile is recorded as a STABLE SIGNATURE
               (file :: test name :: error class), never as a bare filename, and never as a licence
               for a new failure inside the same file.

RUNTIME PROOF  NONE for the HERMES half, and typed rather than assumed:
          BLOCKED_DEPENDENCY / reason=WAITING_EXTERNAL_ENVIRONMENT /
          condition=HERMES_REACHABLE / continuation=automatic /
          ownerDecisionRequired=false. HERMES is down because the owner is physically installing the
          P40. This is an environmental condition, not an actor-capability gap, not a WilliamOS
          defect, and not owner work. Recorded as CONT-EXPV2-P0-RUNTIME-PROOF (S9). It blocks Gate 1b
          only; it must not park unrelated eligible work.

KNOWN GAPS
  1. No live accelerator observation for HERMES; the P40's existence is owner-stated and spec-stated
     but not evidenced by any on-main canonical record (S4.2 Finding A). Correct behavior; Gate 1b.
  2. memory.used is absent from the node-probe query AND from the canonical GPU schema, so #974's
     HEADROOM class cannot reach the System Object Graph through the canonical inventory path.
     Bounded, and in Gate 1a scope (S7.2). It is NOT absent fabric-wide (S6.6).
  3. Gate 1's bounded child packet exists and has been amended: #990. That clears the PACKET axis
     only. The LIFECYCLE axis is BLOCKED_DEPENDENCY / PREDECESSOR_MAP_DEFECTIVE, and collapsing the
     two axes into one status is what round 4 finding 7 caught (S7, S7.6).
  4. Gates 3/5 are BLOCKED_RESERVATION behind PR #927; Gate 2 is BLOCKED_DEPENDENCY on Gate 1 plus a
     fresh bounded reservation (S3).
  5. FOUR independent review rounds are complete: rounds 1-3 plus round 4, the first to attack the
     map's accepted findings as well as its own claims. All four returned MAP_DEFECTIVE. Round 4's
     16 findings are adjudicated in S15; two of them OVERTURNED findings this map had accepted.
  6. The register now has a machine check (S14). It is not evidence for anything in this block.

NEXT  A fifth review round against a frozen ref. Gate 1a does not start until a round returns clean.
      Gate 1b stays BLOCKED_DEPENDENCY / WAITING_EXTERNAL_ENVIRONMENT and resumes automatically on
      HERMES_REACHABLE. Gate 2 needs Gate 1 (both halves), a fresh reservation, AND the
      charter-required search for an existing canonical first action, which has not been run.
      Gates 3/5 stay BLOCKED_RESERVATION regardless.
```

### 8.1 Recorded test baseline

| Run | Result |
| --- | --- |
| Deterministic CI profile, **local** (`vitest run --config vitest.ci.config.ts`, `SESSION_OBSERVED` 2026-08-24 10:53) | **418 files passed, 4 skipped (422); 5509 tests passed, 46 skipped (5555); 0 failed.** Exit code 0. Duration 255s. |
| Deterministic CI profile, **CI on PR #988** (`EXTERNAL_RECORD`) | `vitest (deterministic suite)` — **SUCCESS** |
| Production build, CI on PR #988 (`EXTERNAL_RECORD`) | `production build (next build)` — **SUCCESS** |

The suite is green on this host under the correct profile. Revision 1's claim that "a green suite is
not obtainable on this host and claiming one would be false" is **withdrawn**: it was obtainable, and
the run that produced the five-file allowlist used the base config rather than the CI profile.

### 8.2 Stable host-only failure signatures

Recorded so a future regression cannot hide behind them. A signature is
`file :: test name :: error class` — never a bare filename.

| Signature | Class | Why it is not a Gate 1 regression |
| --- | --- | --- |
| `tests/execution-fabric-hermes-embedding-bakeoff.test.ts :: * :: CORPUS_BINDING_MISMATCH` | host-dependent; excluded from the deterministic profile by `vitest.ci.config.ts:12-15` | Requires a live Ollama endpoint on HERMES. |
| `tests/lab-dev-preflight.test.ts :: * :: probe payload mismatch` | host-dependent; excluded by `vitest.ci.config.ts:16-19` | Probes real lab hosts and remote git identity. |
| `tests/hermes-bridge-supervisor.test.ts :: * :: timeout 5000ms` | **profile artifact, not a failure** | Base-config default; the CI profile sets 60000ms for exactly these subprocess-spawning tests (`vitest.ci.config.ts:32-36`). Passes under the CI profile. |
| `tests/execution-fabric-pinned-placement.test.ts :: * :: timeout 5000ms` | **profile artifact, not a failure** | Same. Passes under the CI profile. |
| `tests/multi-agent-eligible-set-scheduler.test.ts :: * :: SCHEDULER_LOCK_WALL HEARTBEAT_START_REQUIRED` | **unexplained** | Passes under the CI acceptance profile, but nothing in that profile explains why it failed under the base config. Recorded as an open signature, not a resolved one. |

Four of these five files sit outside Gate 1's source directories. That is **not** proof they cannot be
affected: `tests/execution-fabric-pinned-placement.test.ts:8-20,111-114` imports Execution Fabric code
directly and reads the very schema and seed Gate 1 edits. Coverage must be assessed by **dependency**,
not by pathname — revision 2 reasoned from file location, which proves nothing about what a test
imports.

## 9. Typed continuations — internal, not owner work

No entry is an owner ask. Each is a typed state with an internal owner and an automatic pickup
condition, per #957 and the owner-directed execution doctrine.

```
CONT-EXPV2-P0-RUNTIME-PROOF
  type:                   BLOCKED_DEPENDENCY
  reason:                 WAITING_EXTERNAL_ENVIRONMENT
  condition:              HERMES_REACHABLE
  continuation:           automatic
  ownerDecisionRequired:  false
  subject:   live accelerator observation for HERMES; Gate 1b (S7.6)
  cause:     the owner is physically installing the P40. HERMES being down is EXPECTED, and the
             absence of a canonically attested P40 is CORRECT refusal-to-attest behavior, not a
             defect.
  evidence:  SESSION_OBSERVED 2026-08-24 -- tailnet reported `offline, last seen 2026-08-23 18:42`;
             on 192.168.88.9 ports 22/3000/5985/50080/50443 closed while ICMP answered.
             NOT_REPOSITORY_VERIFIED. Retained only as a timestamp; the owner's account of the
             install supersedes it as the explanation.
             Which HERMES surface: the node's SSH / app / WinRM surfaces. AGENTS.md:68's statement
             that the resident HERMES-to-AEGIS runtime is OPERATING describes the execution
             backend's design status, not this node's current reachability.
  blocks:    Gate 1b only. Gate 2 terminal acceptance depends on Gate 1b.
  does NOT block: Gate 1a implementation and merge on deterministic tests; the Gate 1 child packet;
             any non-HERMES eligible work. A single unavailable dependency must not park unrelated
             work -- that is the queue-blocking bug class already fixed; do not recreate it.
  pickup:    run the canonical probe path (probe-windows.ps1) through the broker, assemble, and
             execute the S7.6 discovery sequence. Compare against the snapshot's previous hardware
             truth. Record "New accelerator discovered on HERMES". Capability stays UNKNOWN until
             bench evidence exists.
  owner:     the executing agent lane, on next HERMES availability
  not:       an owner task. The owner is not asked to power on, repair, report on, or declare a node.

CONT-EXPV2-FIRST-ACTION
  type:      BLOCKED_DEPENDENCY
  reason:    CANONICAL_ACTION_SEARCH_NOT_PERFORMED
  subject:   the "one safe governed mutation" the charter requires for the first journey
             (charter:273-274, charter:488-489)
  state:     OPEN. No conclusion is recorded, because the search the charter requires has not been
             run. Round 4 finding 8 caught the previous version keeping reason
             NO_ELIGIBLE_CANONICAL_ACTION, "finding: no action on main qualifies", and
             "owner: Gate 2, which BUILDS it" as ACTIVE TYPED FIELDS while the prose four lines
             below said all three were withdrawn. A machine reading this packet would have read
             the withdrawn conclusion; that is what typed fields are for.
  examined:  three candidates, which is not a search. baseline is all-node/unbrokered/
             best-effort-audited; resource/verify is a read, POSIX-only, wrong object graph, and
             not user-scoped; relocate/restore are correctly shaped but far past "safest" (S5.6).
  requires:  SystemObject subject; dialect-aware brokered execution; session-user scoping on every
             lookup; durable evidence, not best-effort; verified post-state
  round 3:   REOPENED. charter:273-274 says "Choose the safest existing canonical action"; this
             packet had inverted that into "there is nothing to choose" by reading only the first
             sentence. Three candidates failing is not a search.
  round 4:   STILL OPEN. Revision 4 did not run the search either, and finding 8 says so.
  next:      (a) a scoped search for existing canonical actions across the stated surfaces, then
             adopt the safest qualifying one; or (b) if none qualifies, an explicit charter
             amendment recording that the first journey's action must be built. Not (b) by default.
  not:       an owner courier task. (b) is a charter amendment, which is a recorded-authority
             decision and must be obtained explicitly rather than assumed by this map -- but the
             search in (a) comes first and is ordinary agent work.

CONT-EXPV2-GATE1-RESCOPE
  type:      BLOCKED_DEPENDENCY
  reason:    PREDECESSOR_MAP_DEFECTIVE
  subject:   #990's bounded scope, which was written from revision 2's S7.2
  amendment: DONE. #990 was amended in place before its first commit; S7.6 records the same.
             The packet is retained because Gate 1a is still blocked -- on the map surviving
             review, not on the amendment. Round 4 finding 5 caught the previous version of this
             packet still carrying "action: amend #990 before its first commit" while S7.6 said
             the amendment had landed, and still carrying two claims the map had withdrawn.
  what round 2 invalidated, and what became of each:
             - lib/system/registry-join.ts as "new" -- WITHDRAWN, but the round-2 REASON was wrong.
               No cross-registry resolver exists; what exists is duplicated alias and authority
               data inside the inventory side, so a consolidation module replaces three copies
               rather than adding a fourth (S4.1, S11 row 15, S15 row 48).
             - schema scope named vram_used_bytes only; vram_source is equally blocked by
               additionalProperties:false (S7.2). HOLDS.
             - "the schema_version bump omits the assembler's hardcoded v0.2 walls" -- FALSE, and
               it was carried here after S12 row 35 and S13 row 46 had already established it.
               assemble-registry-core.mjs:653,699-704 are error-message strings; the only output
               literal is :720. The real fail-closed wall is :437, on the NODE-PROBE schema
               (schema_version !== '0.1-node-probe'), with the exactKeys node-shape check at :433.
               That wall, not the strings, is what a bump must move.
             - invariant 1 cannot represent the null-UUID records that actually ship (S7.5). HOLDS.
             - invariant 12 was false at merge (S7.5). HOLDS.
  action:    none on #990 itself. Gate 1a starts when the map survives a review round; the amended
             scope is already correct except for the v0.2 row, corrected above and in S7.2.
  owner:     the delivering agent lane
  not:       an owner decision. #990 is an agent-authored packet under already-recorded authority.

CONT-EXPV2-SELECTOR-INVENTORY
  type:      BLOCKED_DEPENDENCY
  reason:    OWNERSHIP_UNRESOLVED
  subject:   four selector/scheduler implementations with no evidenced call boundary (S6.7)
  members:   scheduleEligibleSet (eligible-set-scheduler.mjs:1635) -- Work Order lanes from a DAG,
             file-backed reservation ledger + lease store + evidence ledger;
             acquireNextEligibleOutcome (outcome-queue-source.mjs:4360) + the queue runtime
             (outcome-queue-runtime.mjs:1283) -- outcome-queue items, Postgres;
             selectNextOutcome (scripts/hermes-bridge/outcome-source.mjs:1276) -- legacy, still the
             orchestrator default;
             selectNextOutcome / acquireOutcome (lib/outcome-queue/engine.ts:277,431) -- used by the
             operator projection.
  finding:   they overlap on dependency eligibility, authority/policy admission, risk/capability
             gating, fencing, leasing and dispatch. scheduleEligibleSet is NOT plan-time only: it
             acquires reservations and leases with fencing tokens and advances work to
             PROVIDER_DISPATCHED (:1785,1792).
  action:    enumerate and classify each as supported runtime, fallback, projection/pure engine, or
             Work-Order scheduler, and evidence the call boundary between them, BEFORE any gate
             decides ownership. Neither "no second scheduler" nor "not a second owner" is
             established.
  owner:     the delivering agent lane
  not:       an owner decision.

CONT-EXPV2-P0-REVIEW-3
  type:      INDEPENDENT_REVIEW_PENDING
  subject:   bounded adversarial re-review of THIS revision of the collision map
  round 1:   COMPLETE. Verdict MAP_DEFECTIVE (8 P0 / 7 P1 / 1 P2). Adjudicated in S10.
  round 2:   COMPLETE. Verdict MAP_DEFECTIVE (19 P0 / 9 P1 / 3 P2). Adjudicated in S11.
  round 3 must specifically attack:  the three method patterns named in the status section, since
             round 2 found more defects than round 1 after every round-1 finding was fixed. A third
             round that only re-checks rows will miss the same way.
  scope:     ownership-seam misclassification above all -- the failure mode the charter names as
             inherited by every later phase; plus whether revision 2's corrections are themselves
             supported by exact lines.
  sourcing:  sovereign tiers first, per the runtime-and-review supersession. "Independent review
             required" never means "third-party review service required." Round 1 lost several lanes
             to `code-mode host exited during handshake`; run fewer parallel lanes.
  owner:     the delivering agent lane
  not:       an owner courier task. The owner does not relay the review request or its result.

CONT-EXPV2-GATE1-PACKET
  type:      CLEARED
  was:       BLOCKED_DEPENDENCY / BOUNDED_CHILD_PACKET_MISSING
  subject:   Gate 1's authority-matched bounded child issue / goal / Work Order
  basis:     charter:464-470 makes the bounded packet the required predecessor of implementation;
             AGENTS.md:9-10 requires the active authority-matched Work Order. A documentation PR is
             not that packet.
  cleared by: #990 EXPERIENCE_V2_GATE1_SYSTEM_OBJECT_PROJECTION, opened under #987/#985 by the
             delivering lane under already-recorded program authority, carrying
             WO-985-GATE1-SYSTEM-OBJECT-PROJECTION (schemaVersion 2): the S7.2 reservation set, the
             S7.5 invariants as acceptance, the S7.6 1a/1b split, explicit stop conditions, and
             ownerOperationsAllowed: false.
  not:       an owner decision. The authority to create the child under #987 was already recorded.

CONT-EXPV2-P0-REVIEW-4
  type:      COMPLETE
  subject:   bounded adversarial review of revision 4, frozen at ac2c9566
  verdict:   MAP_DEFECTIVE (8 P0 / 7 P1 / 1 P2). Adjudicated in S15.
  first:     the first BIDIRECTIONAL round. It re-verified roughly fifty findings this map had
             ACCEPTED and overturned two of them (S15 rows 47, 48). Three earlier rounds had run
             one way only, which is why those two stood for three revisions.
  gap:       the read-only lane could not spawn processes (CreateProcessAsUserW failed: 5, on 27
             attempts) and therefore did not run the test suite. It declared that rather than
             implying a run. Round 5 is given a writable workspace and an explicit read-only
             instruction so the gap closes, with post-review verification of git state.
  unreviewed: S10 row 12 and S11 rows 8, 10, 12, 18, 27. Unverified in BOTH directions; not
             evidence for anything until a round opens them.

CONT-EXPV2-MERGE-AUTHORITY
  type:      BLOCKED_DEPENDENCY
  reason:    MERGE_MODE_NOT_COVERED_BY_ACTIVE_RECORDED_AUTHORITY
  subject:   PR #988 (WO-987-GATE0-COLLISION-MAP) and PR #989
  evidence:  the A2_WRITE_OWN delivery contract enumerates exactly
             allowedActions: ["implement"], commitAllowed: true, pushAllowed: true,
             tagAllowed: false (scripts/hermes-bridge/work-contract.mjs:76-82,190-196,203-209),
             with exactKeys at :117 closing the field set. There is no merge action and no
             mergeAllowed field. mergeMode defaults to NO_MERGE
             (work-order-envelope-v2.mjs:118), which dispatch-envelope.mjs:308-311 makes
             contradictory with MERGE_ELIGIBLE_PR. A grant's scope.mergeModes must include the
             requested mode (authority-events.mjs:255,364) -- and that function's SUCCESS return
             is ARTIFACTS_VALIDATED_NOT_AUTHORIZED / authorityGranted: false (:369-371). A
             repository-wide search for `authorityGranted: true` outside tests returns nothing.
             playbook:258-261: "Packet fields cannot mint authority."
  machines:  the bounded-merge-controller and automatic-dependent-release are DECISION-ONLY proof
             artifacts for PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001, not reusable merge paths.
             evaluateBoundedMergeController() and evaluateAutomaticDependentRelease() ALWAYS wall
             with CALLER_SUPPLIED_*_REJECTED_USE_CANONICAL_PLAN; their canonical plans assert
             mergePerformed: false and authorityGranted: false and cover their own files only.
  on-disk:   exactly two artifacts in this repository carry a merge mode. Both are unusable:
             runtime-operator/native/authority-registry.json's two Work Orders are AUTO_ELIGIBLE
             but REVOKED_TERMINAL on adapterId local-nested-codex-exec, QUARANTINED_TERMINAL,
             terminal issue #357 -- the adapter AGENTS.md:75-76 forbids reusing. And
             config/execution-fabric/aegis-bounded-dispatch-work-order.json is laneId
             resident-aegis with a single-use hash grant and no PR-lifecycle actions.
  NOT an owner decision, and doctrine says so rather than merely not saying otherwise:
             merging matches none of playbook:46-52's five genuinely-new-authority classes; it is
             named explicitly on playbook:60's never-ask list; AGENTS.md:18-20 assigns agents
             authorized merges; active-program-queue.md:249-258 assigns the lane eligible merge
             and repeats that William is not asked to merge PRs; #762's continuation contract
             step 2 is "verify merged main" after every child delivery. The repository has two
             workflows, ci.yml and work-context.yml; neither deploys and neither triggers on
             merge, so nothing here is a release or cutover. And playbook:262-265 forbids the
             coordinator turning the cryptographic-grant path into a new owner chore for
             already-authorized R0/R1 work. Escalating this would BE the violation this program
             measures, not a resolution of it.
  NOT a session or surface limitation: `gh pr merge` runs from this host. The grant store is a
             Postgres table (record-authority-grant.mjs:33) unreachable here, which is real but is
             not the blocker -- the contract and envelope findings are independent of it.
  IS:        a coordinator gap. No merging Work Order envelope exists for these two lanes. Issuing
             one is coordinator work under the already-active R1 program authority, and this lane
             may not issue it for itself (playbook:258-261). An agent may not self-grant merge by
             authoring a packet, including this one.
  satisfied: both PRs sit at the edge of the gate -- CI green, CLEAN/MERGEABLE, review complete,
             zero unresolved threads on both.
  pickup:    a merging mergeMode envelope for these lanes under the active R1 authority, or a
             recorded determination that the active authority does not reach them. Then merge
             without further review work.
```

## 10. Round-1 review response register

The independent adversarial review of revision 1 returned `MAP_DEFECTIVE`. Every finding was
re-verified against the code here before being accepted or refuted; the verdicts are the delivering
lane's, the evidence is the repository's. Deduplicated across lanes.

| # | Finding (revision 1 claim under attack) | Verdict | Evidence | Remediation |
| --- | --- | --- | --- | --- |
| 1 | Node registry is one registry, `REUSE` | **ACCEPTED (P0)** | `route.ts:30-37,106-118` keyed transport map vs `registry.seed.json:1-9` schema-0.2 node array; `README:29-44` | §4.1 — reclassified `COLLISION/ADAPT`; join, precedence and absence rules defined; §5.1 split into two rows |
| 2 | Headroom is unobtainable fabric-wide | **ACCEPTED (P0)** | `pinned-evidence-registry.mjs:148,159,162,179` validates used/free VRAM and headroom; `collect-resident-hermes-embedding-evidence.ps1:58`; `lab-health.ps1:26` | §6.6 — all eight producers enumerated and classified; gap narrowed to the node-probe query plus the canonical schema |
| 3 | "One shared parser"; route issues its own GPU query | **ACCEPTED (P0)** | `route.ts:41-73` is a third query and parser; revision 1's §7.2 query omitted `driver_version`, present at `probe-windows.ps1:90` and `probe-linux.sh:148` | §7.1 — the route now *consumes* canonical output; §7.2 keeps `driver_version` and fixes one field order |
| 4 | Add `memory.used` to the probes only | **ACCEPTED (P0)** | `registry.schema.json:74-90` `additionalProperties:false`; `assemble-registry-core.mjs:449,455-458` validates, `:485-488` falls back to declared on failure; `assemble-registry.mjs:15-16,42-43` pins digests | §7.2 — schema, assembler, entrypoint digest pin, seed and registry tests all in scope; §7.5 invariants 9-10 |
| 5 | All Gate 1 probing is brokered; preserve brokered-only | **ACCEPTED (P0)** | `route.ts:76-92` raw `execFile` PowerShell at `:90`; `broker.mjs:96-104` already does local, audited | §5.1 names `probeLocal()` as a hidden transport; §7.2 deletes it; §7.5 invariant 12 |
| 6 | Two frontend compositions | **ACCEPTED (P0)** | `/env`→`Environment`→`/api/env/line` (`app/env/page.tsx:4,13`, `environment.tsx:75`, #919 `ddcfa607`) vs `/environment`→`Desk`→`/api/environment/line` (`app/environment/page.tsx:4,24`, `desk.tsx:71`, #922 `2d83948f`) | §5.2 — both lineages classified; §6.3 — three compositions; PR #927 owns the collapse |
| 7 | `router.ts` is a registry consumer | **ACCEPTED (P0)** — an unverified candidate, confirmed locally | `router.ts:14-17` action-kind union, `:31-53` `SIGNALS`, `:55-61` `DESTINATIONS`; consumes the registry only at `:65` | §5.3 — reclassified as a competing half; Gate 2 converges both |
| 8 | Baseline is read-only, selected-node, brokered | **ACCEPTED (P0)**, with one sub-claim refuted | All-node: `baseline/route.ts:18,23` → `run-baseline.mjs:382-386`. Mutating: `:330-338,341-348,361-369`. Not brokered: `:309-318` raw `exec`. **But audited**: `:270,298,304` | §5.6 — reclassified as a mutating all-node gate. **The rest of this cell is superseded**: `POST /api/resource/verify` was withdrawn in revision 3, and this row's "But audited" sub-claim is downgraded to best-effort by §11 row 14 |
| 9 | Blanket Gate 2/3/5 freeze | **ACCEPTED (P1)** | #921 body: "freeze further Claude mutations in the Environment path; preserve reusable backend/API/data work"; PR #927's **54** files contain no `workbench-action-registry.ts` and no `router.ts`, and nothing under `lib/system/`, `app/api/fabric/`, `lib/fabric/` or `*/execution-fabric/` | §3 — Gate 2 `BLOCKED_DEPENDENCY` (disposition `EXTEND`); Gates 3/5 `BLOCKED_RESERVATION` on the measured file set. **Vocabulary superseded** by §11 row 26: `EXTEND, dependency-gated` is not a canonical lifecycle state |
| 10 | `BLOCKED_AUDIT_FREEZE` | **ACCEPTED (P1)** | `multi-agent-operator-playbook.md:178-193` state list; `:196-198` forbids substituting reason codes for state names | §3 — canonical states with a separate reason code |
| 11 | Gate 1 `RELEASABLE` | **ACCEPTED (P1)** | `charter:464-470`; `AGENTS.md:9-10`; no bounded child packet exists | §3 — cleared by opening **#990**; Gate 1 is `DEPENDENCY_CLEARED` on the packet axis; §9. **Vocabulary superseded** by §11 row 26: `FREEZE_SCOPE_CLEAR / NOT_YET_DEPENDENCY_CLEARED`, which this row previously named as the correction, is itself non-canonical |
| 12 | Fallback VRAM projects `UNKNOWN` | **ACCEPTED (P1)** | `probe-windows.ps1:116` emits `AdapterRAM` as `vram_bytes`; `:125` only warns | §7.4 — a `vram_source` field and explicit qualified-lower-bound projection rules; §7.5 invariant 7 |
| 13 | Epistemic state wholly `MISSING` | **ACCEPTED (P1)** — an unverified candidate, confirmed locally | `schema.ts:1106-1122` `truthClaim`; `:1126-1142` `agentClaim`; `brain-council-reasoning.ts:24-40` | §5.4 — `truthClaim`/`agentClaim` `EXTEND`; Brain Council a noncanonical projection predecessor; only the unified lifecycle new |
| 14 | "Nothing on main models a GPU/disk/service as an addressable thing" | **ACCEPTED (P1)** | `registry.schema.json:74-97,142-159,290-315` define identified gpu/disk/runtime/node objects | §8 — restated as a missing cross-surface addressable projection and identity resolver |
| 15 | "No new failing file" acceptance rule | **ACCEPTED (P1)**, and extended | `vitest.ci.config.ts:10-22,32-36`; `ci.yml:24,53`. Four of the five recorded failures are explained by the wrong profile, and the correct profile runs green (§8.1) | §8 — deterministic CI profile is the gate; §8.2 records stable signatures |
| 16 | Gate 1 may merge on synthetic fixtures | **ACCEPTED (P1)**, resolved with the owner direction | `charter:205-217,573-575` | §7.6 — the 1a/1b split, with 1b mandatory before Gate 2. **Superseded in part**: this cell said "Gate 1a releasable now" and §7.6 has typed Gate 1a `BLOCKED_DEPENDENCY / PREDECESSOR_MAP_DEFECTIVE` since round 3 (§13 row 41). Found by the delivering lane, §15 row 58 |
| 17 | Gate 1 collision proof (3 prefixes, 6 branches) | **ACCEPTED (P2)** | Gate 1 also mutates `scripts/execution-fabric/` and `config/execution-fabric/` | §3 — re-measured over the complete path set, all 9 open-PR lanes and all 404 remote refs; the conclusion survives |
| 18 | "The only record that exists"; seed = registry truth | **ACCEPTED (P2)** | `registry.seed.json:57` `declared-seed; live probe required`, `ttl_seconds: 0` | §4.2 — "the only on-main declared seed record located"; evidence classes in §1 |
| 19 | "HERMES serves the app, so `probeLocal()` measures it" | **ACCEPTED (P2)** | `route.ts:117` selects transport from the registry's `transport` field, not from identity | §4.2 — restated as a runtime fact of the deployment's `nodes.json` |
| 20 | Session-local observations presented as repository facts | **ACCEPTED (P2)** | the tailnet, port, ICMP and home-directory claims have no tracked artifact | §1 evidence classes; §9 labels; the sanitized evidence artifact |
| 21 | "HERMES is offline" ambiguous beside `AGENTS.md:68` | **ACCEPTED (P2)** | `AGENTS.md:68` describes the execution backend, not node reachability | §9 — surface, timestamp and the P40-install cause all stated |
| 22 | Preference store collides with `memoryFact.kind="preference"` | **REFUTED** | Revision 1 already drew exactly this distinction (`schema.ts:115`); #987 independently: "No credible canonical Experience V2 preference store was found" | §5.8 unchanged; the refutation is recorded |
| 23 | `lib/governance/events.ts` vs `lib/registers/events.ts` is a second event authority | **REFUTED at P0; ACCEPTED at P2 for precision** | `events.ts:11-34` closed type set ~~plus hash chain~~, vs `registers/events.ts:14-31` open `type`, no chain; #987: "do not create a new generic event authority" | §5.5 — the two are named and separated. **The reasoning is superseded** by §11 row 4: `governanceEvent` is *not* hash-chained, so "Gate 6 projects from the hash-chained log" — this row's original wording — was false. Gate 6 projects from `governanceEvent` + `evidenceRecord` + receipts + the signed authority chain. The conclusion survives; the argument for it did not |
| 24 | Baseline is not audited (implied) | **REFUTED at round 1, then SUPERSEDED at round 2** | `run-baseline.mjs:270,298,304` do call `auditFabricAction` on success and failure — but both calls are `.catch(() => {})`'d (`:294-297`) | §5.6 records audited = **BEST-EFFORT ONLY**, per §11 row 14. The refutation was literally true and practically misleading: the calls exist, and a fleet-wide start/transfer/force-stop can still complete with no durable record |

Four candidates reached the round-1 coordinator unverified because their lanes died at
`code-mode host exited during handshake`. All four were verified locally here: §10 rows 7 (confirmed),
13 (confirmed), 23 (refuted at P0, accepted at P2), 22 (refuted).

## 11. Round-2 review response register

Round 2 attacked revision 2 — the remediation of round 1 — and returned `MAP_DEFECTIVE` with
19 P0, 9 P1 and 3 P2. Every finding below was re-verified against the code by the delivering lane
before being accepted. **All 31 are accepted; none was refuted.** That result is itself the strongest
evidence for the method finding in the status section.

Findings are grouped by what they attack, because several rows share one root cause.

### A. Ownership claims that were false — new owners found on `main`

| # | Revision 2 claimed | Verdict | Evidence | Where corrected |
| --- | --- | --- | --- | --- |
| 1 | "**No second memory database.**" | **ACCEPTED (P0)** | `control-center/backend/copilot/memory.py:24-52` owns `sessions`/`messages`/`facts`/`fact_events`; `:54-63` re-declares the canonical `memoryFact.authority` lifecycle plus `intake`; constructed at `app.py:54`; served at `app.py:426,448,453` | §5.4 — `COLLISION / ADAPT` |
| 2 | Gate 2 has "two halves" | **ACCEPTED (P0)** | `command_center.py:140` classifies every command with `allowed`/`runnable`/`confirmation_required`/`safety_tier`/`execution_path: "safety.py -> command_runner.py"`; `copilot/tools.py:52-55` publishes function schemas for **every registered command** | §5.3 — third catalogue, and the only one that gates execution |
| 3 | Two action classifiers | **ACCEPTED (P0)** | `lib/workbench/registered-outcome-intent.ts` is an independently owned exact-match classifier that `router.ts:94` special-cases and `app/actions/start-workbench-outcome.ts:12-21` exclusively accepts | §5.3 |
| 4 | `governanceEvent` is a "hash-chained authority log" | **ACCEPTED (P0)** | `schema.ts:839-853` has no prior-event hash, sequence or head; `events.ts:64-65` hashes payloads independently; `events.ts:56-71` swallows insert failures by design | §5.5 — best-effort append log |
| 5 | One event authority | **ACCEPTED (P0)** | `scripts/multi-agent-operator/authority-events.mjs:261` is a separate signed, linked authority-status chain governing dispatch and revocation, consumed by `codex-coordinator-adapter.mjs:395` | §5.5, §6.7 |
| 6 | "No second scheduler" | **ACCEPTED (P0)** | `eligible-set-scheduler.mjs:1635` `scheduleEligibleSet` — DAG input, dispatch claims, reservation ledger, lease store, evidence ledger (2295 lines); `outcome-queue-source.mjs` and `outcome-queue-runtime.mjs` own queue selection/acquisition | §6.7 — **still open.** Revision 3's "boundary, not a second owner" answer was itself refuted at round 3: four implementations exist, and `scheduleEligibleSet` reserves/leases/dispatches rather than merely admitting. Retyped as `CONT-EXPV2-SELECTOR-INVENTORY` (§9) |
| 7 | The seed solely owns identity/role/authority | **ACCEPTED (P0)** | `assemble-registry-core.mjs:32+` holds `canonicalAuthority` per node and enforces it against the seed at `:699-704`; `:655-660` holds a hardcoded roster; `probe-windows.ps1:10-12` and `probe-linux.sh:51` hardcode hostname→node-id | §4.1, §6.7, §7.2 |
| 8 | Pinned evidence is a `SPECIALIST_RUNTIME_METRIC` | **ACCEPTED (P0)** | `recommend-pinned-placement.mjs:108` with `pinned-evidence-registry.mjs:443,511` derives a competing node inventory whose GPU array is index-keyed with null UUID/PCI | §6.6 — placement-only projection, barred from owning identity |

**Root cause for this whole group**: the blanket negative in §6.7 was asserted after searching only
the TypeScript surface of a repository the same document calls implementation truth.

### B. The first governed action — revision 2's replacement withdrawn entirely

| # | Revision 2 claimed | Verdict | Evidence | Where corrected |
| --- | --- | --- | --- | --- |
| 9 | `resource/verify` is "the corrected first-journey action" | **ACCEPTED (P0)** | `charter:273` requires "one safe governed **mutation**"; `charter:488-489` "one safe governed **adjustment**… verifies actual post-state". The route mutates nothing | §5.6 — withdrawn |
| 10 | It proves `SYSTEM -> HERMES -> P40` | **ACCEPTED (P0)** | `probe.ts:144-150` emits POSIX shell only; `broker.mjs:102,107` sends local/Windows through PowerShell. HERMES is Windows, and the dialect failure would read as *node unreachable* | §5.6 |
| 11 | "selected object" | **ACCEPTED (P0)** | It selects a `project_resource` (`verify/route.ts:46-54`), not a SystemObject | §5.6 |
| 12 | "governed" | **ACCEPTED (P0)** | `verify/route.ts:31-32` checks only that a session exists; `:46-54,56-60` filter on `identity` with **no `userId`** — any authenticated user can name another user's record and trigger a brokered probe against the node it names | §5.6 |
| 13 | "evidence" | **ACCEPTED (P0)** | `appendGovernanceEvent` swallows failures (`events.ts:56-71`); the optional Thread binding at `verify/route.ts:128` uses a synthetic event id that `tests/workbench-thread-loader.test.ts:412` proves resolves as missing | §5.6 |
| 14 | Baseline is "already audited" | **ACCEPTED (P0)** | `run-baseline.mjs:298,304` both `.catch(() => {})`, deliberately (`:294-297`) | §5.6 — best-effort only |

### C. Gate 1 scope built on defective premises

| # | Revision 2 claimed | Verdict | Evidence | Where corrected |
| --- | --- | --- | --- | --- |
| 15 | `lib/system/registry-join.ts` is "new" | **ACCEPTED (P0), then PARTLY REFUTED at round 4** | The alias/authority duplication is real (§11 row 7). But nothing cited reads the transport shape at `route.ts:30-37`, so no cross-registry resolver exists and "a **fourth** owner" does not follow — §15 row 48 | §4.1, §7.2 — the withdrawal of the *file name* stands; the *reason* is corrected. The task is consolidation **and** a join nothing on `main` performs |
| 16 | Transport records join by machine pin | **ACCEPTED (P0)** | `route.ts:30-37` carries no pin. Transport can only select a provisional endpoint; the probe observes identity; the seed pin promotes | §4.1 |
| 17 | The transport registry owns reachability | **ACCEPTED (P0)** | It has no reachability field; reachability is measured per request (`route.ts:113-127`) | §4.1 |
| 18 | Symmetric `ABSENCE` rule | **ACCEPTED (P0)** | Would promote any transport-only line to a canonical node, against `README:41` | §4.1 — unverified endpoint candidate |
| 19 | Schema scope = `vram_used_bytes` | **ACCEPTED (P0)** | §7.4 also requires `vram_source`, equally blocked by `additionalProperties:false` (`registry.schema.json:74-90`) | §7.2 — both fields |
| 20 | Bumping `schema_version` is enough | **ACCEPTED (P0) at round 2 — now PARTLY REFUTED, see §12 row 35** | The emitted version at `assemble-registry-core.mjs:720` is real and is the only `'0.2'` literal in the file. The cited "walls" at `:653,699,700,704` are error-message strings, not version checks | §7.2 — corrected; the genuine fail-closed version wall is `:437` on the *node-probe* schema, which neither round found |
| 21 | Invariant 1 (UUID/PCI identity) | **ACCEPTED (P0)** | Cannot represent the CIM fallback (`probe-windows.ps1:109-126`) or the declared HERMES GPUs (`registry.seed.json:66`), both `uuid: null, pci_bus_id: null` | §7.5 — identity-unresolved projection |
| 22 | Transport `role` conflict marks `stale` | **ACCEPTED (P1)** | That record has no timestamp; staleness is a temporal claim | §4.1 — `CONFLICTING` |
| 23 | The assembler must change for the field | **ACCEPTED (P1)** | GPU validation and copying are driven dynamically from `$defs.gpu` (`:446,540`) | §7.2 — narrowed |
| 24 | Invalid probes fall back "silently" | **ACCEPTED (P1)** | Fallback records `LIVE_PROBE_INVALID` and adds a fail-closed constraint (`:455,509`) | §7.2 — warned fail-closed |
| 25 | Invariant 12: no Gate 1 path unbrokered | **ACCEPTED (P1)** | `run-baseline.mjs:309-318` contradicts it inside the same path family | §7.5 — narrowed to the canonical probe path |

### D. Precision, vocabulary and evidence hygiene

| # | Revision 2 claimed | Verdict | Evidence | Where corrected |
| --- | --- | --- | --- | --- |
| 26 | §3 uses canonical lifecycle vocabulary | **ACCEPTED (P1)** | `EXTEND, dependency-gated` and `FREEZE_SCOPE_CLEAR / NOT_YET_DEPENDENCY_CLEARED` are not in `playbook:178-193` — the same defect as `BLOCKED_AUDIT_FREEZE`, in the section that corrected it | §3 — `BLOCKED_DEPENDENCY` + reason codes |
| 27 | The Gate 1 measurement was "complete" | **ACCEPTED (P1)** | It claims `tests/` but the published reproduction command omits `tests/` | §3, evidence artifact |
| 28 | Used VRAM/headroom is "already observed" | **ACCEPTED (P1)** | Code proves producer/validator capability, not that any snapshot was collected; validation checks shape and a free-VRAM threshold, not used/free/total consistency | §6.6 |
| 29 | `truthClaim` owns expiry | **ACCEPTED (P1)** | `app/actions/truth.ts:34-35,60-82` — writes cannot set expiry; reads recompute freshness from type and capture time. An inert column | §5.4 |
| 30 | "deterministic suite" | **ACCEPTED (P1)** | The profile changes exclusions and timeouts; nothing explains `SCHEDULER_LOCK_WALL`. One green run is not determinism | §8 — CI *acceptance* profile; the signature stays open |
| 31 | Test-file location proves non-interference | **ACCEPTED (P2)** | `tests/execution-fabric-pinned-placement.test.ts:8-20,111-114` imports fabric code and reads Gate 1's schema and seed | §8.2 — assess by dependency |

Two further P2s are folded in without a row of their own: the GPU table is eight producer rows over
nine executable query sites (§6.6), and `resource/verify` also accepts a `thread` parameter and
deliberately mutates provenance state while leaving its subject unchanged (§5.6).

### What round 2 did not overturn

The round-1 corrections in §10 survive. The two registries are still two, `probeLocal` still bypasses
the broker, `router.ts` is still a competing catalogue, `/env` and `/environment` are still separate
lineages, `truthClaim` is still a predecessor rather than a gap, the CI profile is still the right
acceptance gate, and Gate 1's reservation is still uncontested. Round 2 made several of those
**sharper** rather than wrong.

The refutations in §10 rows 22 and 24 also stand. §10 row 23's does not: it argued that `governanceEvent`
was a hash-chained authority log and `eventLog` merely a feed, so the pair was not a second authority.
The conclusion happens to survive — they are still not competing authorities — but the reasoning was
false (§11 row 4), and a right answer reached through a wrong argument is not evidence of anything.

## 12. Revision-3 self-check — what applying round 2 broke

Revision 3 applied round 2's findings and then re-read its own result against §10 and §11 rather than
against the review. Three defects were introduced or left by the remediation itself. They are recorded
here in full, because this is the third consecutive round in which fixing the previous round's
findings created new ones, and that pattern is the map's central claim about its own method (the status section, which has no
number and is therefore cited by name rather than as a section reference).

| # | Defect | Class | Evidence | Fixed in |
| --- | --- | --- | --- | --- |
| 32 | §11 row 22 accepted that a transport `role` conflict must mark `CONFLICTING`, not `stale`, and §4.1 was corrected — but invariant 13 still said `stale`. The register recorded a correction the acceptance criteria did not carry | **SELF-INTRODUCED (P1)** | §4.1 `CONFLICT` vs §7.5 invariant 13, as written in `cea7ad54` | §7.5 invariant 13 — pin: "the transport side is marked `CONFLICTING`" |
| 33 | §4.1 `ABSENCE` withdrew the symmetric projection rule — a transport-only record is an unverified endpoint candidate and does **not** project as a canonical `SystemObject` — while invariant 11 continued to require exactly that projection. The gate would have tested the behaviour the join rules forbid. Round 2's own P1 (invariant 11 never tests a successful or mismatched join) was also left open | **SELF-INTRODUCED (P0)** | §4.1 `ABSENCE` vs §7.5 invariant 11, as written in `cea7ad54`; `app/api/fabric/nodes/route.ts:30-37` carries no machine pin | §7.5 invariant 11 — pin: "unverified endpoint candidate", "a probe whose observed identity does not match the pin" |
| 34 | Round 2 accepted "no second scheduler" as a **P0** (§11 row 6, pointing at §6.7). Revision 3 deleted the claim from §6.7's negative list without replacing it, so row 6 pointed at nothing and the accepted P0 was silently unresolved | **SELF-INTRODUCED (P0)** | §11 row 6 → §6.7 item 7, as written in `cea7ad54` | §6.7 item 7 — boundary analysis — pin: "distinct overlapping scheduler authorities with an unproven handoff" |
| 35 | Round 2's P0 #20 — "hardcoded `v0.2` semantic checks at `assemble-registry-core.mjs:653,699,700,704`" — was **accepted without opening the lines**, recorded in §7.2 and §11 row 20, and then propagated into #990's binding scope. They are error-message strings guarding a scheduler-state check and the authority-catalogue comparisons. `'0.2'` occurs once in the file, at `:720`. "A `schema_version` bump that leaves these behind fails assembly outright" was false | **ACCEPTED FINDING THAT WAS ITSELF FALSE (P0)** | `assemble-registry-core.mjs:652-653,695-704,720`; `grep -n "'0\.2'" ` returns one line | §7.2, §11 row 20, and #990's assembler row — pin: "They are **error-message strings**, not version checks" |

§12 row 35 is the one that should change how the next round is run. §12 rows 32-34 are failures to carry a
correction *through* the document. §12 row 35 is a failure at the other end: an adversarial finding was
**accepted on the reviewer's word**, written into the map, carried into §11's register, and then
copied into a bounded packet that Gate 1a would have implemented — and it was never true. Three review
rounds hardened the map's positive claims against its own authors while leaving the reviewers'
findings unverified, which is the same asymmetry the map's method rule was written to remove. §12 now
binds the missing half: **an accepted finding is a claim like any other, and gets opened like any
other.** Every remaining round-2 P0 was re-opened on that basis; §12 row 35 is the one that failed.

§12 row 34 is the one worth reading twice for a different reason. §12 rows 32 and 33 are contradictions, which a careful re-read
finds. §12 row 34 is a **deletion**: the false claim was removed, nothing false remained on the page, and
the register still said `ACCEPTED (P0) — see §6.7`. Deleting a claim is not answering it, and the
resulting document reads as clean precisely because the unresolved item is no longer visible. A
register that points into the body is only as good as the body it points into.

So every §10/§11 row's "where corrected" target was re-opened. **That sweep found five more of the
same class**, all in §10 — round-1 rows still naming corrections that rounds 2 and 3 overturned:

| Register row | Named as the correction | Actually |
| --- | --- | --- |
| §10 row 8 | "`POST /api/resource/verify` chosen as the first-journey action" | withdrawn entirely in revision 3 (§5.6); the row's own "But audited" sub-claim is best-effort (§11 row 14) |
| §10 row 9 | "Gate 2 `EXTEND`, dependency-gated" | not a canonical lifecycle state (§11 row 26) |
| §10 row 11 | "`FREEZE_SCOPE_CLEAR / NOT_YET_DEPENDENCY_CLEARED`" | also non-canonical, and §3 says so in the same revision that left this row citing it |
| §10 row 23 | "Gate 6 projects from the hash-chained log" | there is no hash chain (§11 row 4) |
| §10 row 24 | "§5.6 records audited = TRUE" | §5.6 records `BEST-EFFORT ONLY` (§11 row 14) |

Each row is now annotated in place rather than rewritten, so the round-1 verdict stays visible beside
what superseded it. An earlier draft of this section asserted the sweep had been done and found
nothing; it had not been done. That assertion was the same defect this section is about, made inside
the section that names it, which is worth leaving on the record rather than quietly deleting.

**And the corrected sweep was still incomplete.** Round 3 found three more targets whose corrections
had never landed in the body — §11 row 29 (`truthClaim` owns expiry) pointed at §5.4, which still
listed `expiresAt` as an owned field; §11 row 4's hash-chain correction had not reached the §8 Phase 0
report; and the §5.1 broker row still said "every outcome incl. refusals audited". All three are
corrected above. The lesson is not "sweep harder": it is that **a register pointing into a body is a
data structure with no integrity check**, and this document has now failed to maintain it by hand
three times. §13 records that as the finding rather than as three more rows.

**The paragraph that stood here is withdrawn, and round 4 finding 4 is why it is being recorded
rather than deleted.** It said `scheduleEligibleSet` "admits Work Orders from a DAG at plan time"
and that the two systems "share exactly one concept, lease identity and expiry". §13 row 39
accepted that both halves are false, and §6.7 was rewritten — yet this paragraph survived,
asserting the withdrawn answer as current prose *immediately above the register that refutes it*.
Deleting it silently would have been §12 row 34's own defect committed inside §12.

The surviving classification is in §6.7: distinct overlapping scheduler authorities with an
unproven handoff, over an inventory that §15 row 47 now shows was itself undercounted.

## 13. Round-3 review response register

Round 3 ran against `54b02953` as `CONT-EXPV2-P0-REVIEW-3`, sovereign tier, single lane, attacking the
three method patterns rather than re-checking rows. **Verdict: `MAP_DEFECTIVE` — 7 P0, 4 P1.**

Two of its findings had already been found and fixed independently by the delivering lane while the
review was running (`2b314c3a`, `c5363092`); the review reached them from a different direction and
confirmed both. The rest are new.

| # | Pattern | Finding | Verdict | Fixed in |
| --- | --- | --- | --- | --- |
| 36 | A | §5.1 "every outcome incl. refusals audited" is false — `auditFabricAction` returns early when the ledger root is absent (`audit.mjs:33`), silently disabling auditing; denial (`broker.mjs:91`) and error (`:111`) paths swallow | **ACCEPTED (P0)** | §5.1 — fail-loud only on success *and* only when the ledger exists — pin: "fail-loud only when the ledger root already exists" |
| 37 | B | §8 "backend truth primitives are strong and **singular**" — unscoped uniqueness claim this map's own §5.3/§5.4/§5.5/§6.7 contradict | **ACCEPTED (P0)** | §8 — "strong but not singular", with the surfaces stated — pin: "Backend truth primitives are strong but NOT singular" |
| 38 | E | §6.7 "two executable selectors exist" — **four** exist; the sweep was never stated | **ACCEPTED (P0)**, then **OVERTURNED at round 4**: there are at least five, and "four" stated no sweep either (§15 row 47) | §6.7, `CONT-EXPV2-SELECTOR-INVENTORY` — pin: "The sweep, stated — with what it actually returned" |
| 39 | E | §6.7 `scheduleEligibleSet` is not plan-time admission — it acquires reservations and leases with fencing tokens and advances to `PROVIDER_DISPATCHED` (`:1785,1792`); the systems overlap on far more than one concept | **ACCEPTED (P0)** | §6.7 — retyped as distinct overlapping authorities with an unproven handoff — pin: "acquires reservations and leases through `acquirePhaseTwoClaim`" |
| 40 | C | §5.6/§9 reverse `charter:273-274`. The charter says "**Choose the safest existing canonical action**"; the map concluded Gate 2 must build one, by quoting only the preceding sentence | **ACCEPTED (P0)** | §5.6, §9 — disposition reopened — pin: "Choose the safest existing canonical action" |
| 41 | D | §7.6 declares Gate 1a `RELEASABLE NOW` with its packet prerequisite `MET`, while §9 simultaneously says #990's scope is defective and Gate 1a must not start | **ACCEPTED (P0)** | §7.6 — `BLOCKED_DEPENDENCY` with reason code — pin: "reason code: PREDECESSOR_MAP_DEFECTIVE" |
| 42 | D | §12's certification that every register target was reopened is disproved by §11 row 29 and by stale audit/hash-chain targets | **ACCEPTED (P0)** | §12 — certification withdrawn and replaced with the finding — pin: "a register pointing into a body is a data structure with no integrity check" |
| 43 | A | §8's Phase 0 report still calls `governanceEvent` hash-chained | **ACCEPTED (P1)** | §8 — pin: "payload hashes and no chain" |
| 44 | B | §7.1 "the ONLY structured GPU observer" — `collect-resident-hermes-embedding-evidence.ps1:58` runs its own `nvidia-smi --query-gpu` and emits structured fields (`:139`) | **ACCEPTED (P1)** | §7.1 — narrowed to the canonical per-device inventory observer, scope stated — pin: "the only CANONICAL PER-DEVICE INVENTORY" |
| 45 | D | §11 row 29 points at §5.4 as corrected; §5.4 and §8 still claimed `truthClaim` owns expiry | **ACCEPTED (P1)** | §5.4, §8 — inert column — pin: "It is an inert column, not an expiry owner" |
| 46 | D | §7.2/§11 row 20's "hardcoded `v0.2` walls" are error-message strings | **ACCEPTED (P1)** — already found independently, `c5363092` | §7.2, §11 row 20, §12 row 35 — pin: "They are **error-message strings**, not version checks" |

### What round 3 changes about this map's own thesis

The status section says the defect is a method failure in three patterns. Round 3 supports that and
sharpens it in one way the earlier rounds could not, because it is the first round to run against a
revision that had *adopted* the method rule:

**The rule was followed and the same defects recurred.** §6.7's scheduler row was written under the
rule, with behaviour cited and lines opened — and it still asserted an unscoped negative ("two
executable selectors") and an unverified positive ("plan-time admission"). §5.6 was rewritten under
the rule and still reversed its controlling requirement, this time by truncating a two-sentence quote
rather than paraphrasing it. Stating a rule at the top of a document does not execute it.

Two structural findings follow, and they are worth more than any row above:

1. **A register that points into a body has no integrity check.** §12 rows 32-34 and §13 rows 42, 45 are all the
   same failure: a "where corrected" cell naming a correction the body does not contain. Hand
   maintenance has failed three times running. Any future register in this program needs the target
   to be verifiable, or it will drift again.
2. **Accepted findings were never verified, only the map's own claims were** (§12 row 35). Three rounds
   of adversarial pressure ran in one direction. An accepted finding is a claim like any other.

Phase 0 remains **`PHASE_0_NOT_PASSED`**. Three independent rounds, three `MAP_DEFECTIVE` verdicts,
and round 3 found defects inside revision 3's corrections exactly as round 2 found them inside
revision 2's. Gate 1a is `BLOCKED_DEPENDENCY` and does not start on this map.

## 14. The register has a machine check, and round 4 found five defects in it

§13's first structural finding was that a register pointing into a body has no integrity check, and
that hand maintenance of it had failed three rounds running. Revision 4 answered that with
`lib/governance/review-register.ts`, asserted by `tests/experience-v2-collision-map-register.test.ts`
in the deterministic CI profile (`vitest.ci.config.ts`, run on every push by `ci.yml:9-12`).

**Round 4 then attacked the check and found five defects in it, and the section describing it
overclaimed in three places.** That is recorded here in full rather than smoothed over, because a
mechanism built to stop this document overclaiming is the last place an unchecked claim belongs. The
five are §15 rows 55-59; what follows is the corrected description.

### What it enforces

1. **Registers are found by structure, not by title.** Any `##` section with numbered table rows of
   four or more columns. §12 is titled "Revision-3 self-check"; a rule keyed on the word *register*
   would have skipped it silently.
2. **No minimum row count.** The first version required three rows, which made any one- or
   two-finding register invisible to every rule here (round 4 finding 11). The threshold existed
   only to exclude §12's three-column correction sweep — the one table in this document whose entire
   subject is stale correction targets. That table is now parsed as what it is, an **annotation
   table**, and each of its rows must name a register row that exists.
3. **Row numbers are unique and contiguous within their own register.** They are namespaced per
   register: §10 runs 1-24 and §11 restarts at 1.
4. **Every row citation must be register-qualified.** §14's previous version claimed every reference
   already was; the document contained fourteen bare ones, and §6 item 7 had already mis-cited "§10
   row 6" for a finding that is §11 row 6 (round 4 finding 13). Bare citations are now a violation,
   and all fourteen were qualified.
5. **Every section reference resolves**, in both notations. The `§` form and the ASCII `S7.2` form
   the fixed-width blocks use. The first version recognised only the `§` form while §14 claimed it
   checked "every section reference in the whole document" — **44** ASCII references went unchecked,
   almost all of them in §8, the section with the worst record in this document. Found by the
   delivering lane as SF-3 and by round 4 as finding 13, from two directions.
6. **No malformed `§` tokens.** `§ status` sat in §12 through four revisions, resolving to nothing.
7. **Content pins.** A row in §12 or later must carry `pin: "…"` naming text its target contains.
   Matching is whitespace- and blockquote-normalised so a pin survives reflow.
   - Pins have a **specificity floor** — at least 24 characters and 3 words. The first version would
     have accepted `pin: "the"` (round 4 finding 12).
   - Pins match a section's **own text only**, ending at its first numbered subsection. The first
     version's comment claimed this while the code did the opposite: every heading stayed open until
     the next peer, so §7's "own" text ran through §7.6 and a pin naming §7 matched anything beneath
     it. That was a real bug, not a documentation slip, and it is fixed.
   - **Every register row is stripped from a target body before matching**, not just the pinning
     row's own line. Otherwise a row targeting its own register could match a neighbouring row's
     cell and the register could certify itself (round 4 finding 12).

### What it does not establish

Stated at length, because the unstated limit is this program's defect class and because round 4
found the previous version of this list overclaiming three times over.

- **It cannot tell whether a correction is correct.** A section that exists, satisfies its pin, and
  still fails to answer the finding passes. Only review catches that.
- **Pin specificity is a floor, not a judgement of aptness.** A long, specific, entirely irrelevant
  pin passes. The floor makes an *accidental* match implausible; it cannot make a *chosen* one apt.
- **External targets are matched by shape only.** `#990`, a `CONT-EXPV2-*` packet, a commit SHA —
  nothing here resolves any of them, so `#999999` satisfies the rule (round 4 finding 14). Resolving
  them would mean querying GitHub from a unit test and making the check non-deterministic. The limit
  is declared rather than hidden, which is the whole point of this subsection.
- **§10 and §11 are reference-checked but unpinned**, 55 rows. The first version asserted the
  *count* 55; round 4 finding 15 pointed out that a count is not monotonic — pinning one old row
  while leaving a new one unpinned keeps it at 55. The test now asserts the exact **set** of
  namespaced row identities, so a newly unpinned row fails even if the total does not move.
- **It checks one document.** Nothing here generalises to another register until someone points it
  at one.

**Passing this check is not evidence that this register is honest, and it is not evidence for any
claim in §8.** It removes several recurring failure modes from a document that has produced many.

### What building it found, and what building it missed

Building the check found §6 item 7's mis-citation of "§10 row 6" — a class the check still does not
catch, since both citations resolve. Auditing the check against its own §14 found SF-3.

And the check did not catch §10 row 16, which named "Gate 1a releasable now" as its correction while
§7.6 had said `BLOCKED_DEPENDENCY / PREDECESSOR_MAP_DEFECTIVE` since round 3 — the sixth instance of
§13's structural finding, sitting inside the unpinned legacy carve-out this section describes. That
is the carve-out behaving exactly as documented, and it is an argument for pinning §10 and §11 rather
than for leaving them.

## 15. Round-4 review response register

Round 4 ran as `CONT-EXPV2-P0-REVIEW-4` against the frozen ref
**`ac2c9566918f76a8eb658b89bd79ee68f6ae7e7c`**, sovereign tier, single lane, read-only. It is the
first round instructed to attack in **both** directions: the map's claims *and* the findings this map
had accepted. **Verdict: `MAP_DEFECTIVE` — 8 P0, 7 P1, 1 P2.**

Every finding below was re-opened against the code or the frozen document here before being accepted.
**All 16 hold; none was refuted.** §15 rows 63 and 64 were found by the delivering lane while the
review ran and are recorded with it.

The two rows that matter most are 47 and 48, because they are findings this map had **accepted** and
round 4 overturned. Three rounds of one-directional pressure had left them standing.

| # | Round-4 finding | Direction | Pattern | Verdict | Fixed in |
| --- | --- | --- | --- | --- | --- |
| 47 | §13 row 38 said four selector implementations exist. A fifth does: `selectEligibleWorkOrder` (`operational-kernel.mjs:122-142`), called at `:235,304` | ACCEPTED_FINDING | E | **ACCEPTED (P0)** — the row correcting an unstated sweep stated no sweep either | §6.7 — sweep written out with all eight hits classified, no count asserted — pin: "No count is asserted here" |
| 48 | §11 row 15's "a new resolver would be a fourth owner" does not follow: the probes' alias maps and the assembler's roster/authority catalogue never read the transport shape (`route.ts:30-37`), and §5.1 says "no join today" | ACCEPTED_FINDING | A | **ACCEPTED (P0)** | §4.1, §11 row 15 — alias duplication separated from cross-registry joining — pin: "NO cross-registry resolver exists" |
| 49 | §4.1's "Owns" row still gave the transport registry reachability while §4.1's own rule said neither registry owns it | MAP_CLAIM | D | **ACCEPTED (P0)** | §4.1 — pin: "connection configuration only" |
| 50 | §12's closing paragraph still asserted "plan-time admission" and "exactly one concept", directly above the register refuting it | MAP_CLAIM | D | **ACCEPTED (P0)** | §12 — pin: "The paragraph that stood here is withdrawn" |
| 51 | §9's `CONT-EXPV2-GATE1-RESCOPE` still carried the false `v0.2` wall claim and "amend #990 before its first commit" after §7.6 said the amendment had landed | MAP_CLAIM | D | **ACCEPTED (P0)** | §9 — pin: "The real fail-closed wall is :437" |
| 52 | §8's Phase 0 report carried five withdrawn claims: `resource/verify` as first action, headroom "already observed", non-canonical vocabulary, one re-review remaining, and NEXT: build Gate 1a | MAP_CLAIM | D | **ACCEPTED (P0)** — §8 states the gate verdict, so these are controlling | §8 — regenerated — pin: "This block is regenerated from the body at each revision" |
| 53 | §7 said `DEPENDENCY_CLEARED` and §7.6's heading said "releasable now" while §7.6's body typed Gate 1a `BLOCKED_DEPENDENCY` | MAP_CLAIM | D | **ACCEPTED (P0)** | §7, §7.6 — packet and lifecycle axes separated — pin: "A cleared packet is not a startable gate" |
| 54 | §9's `CONT-EXPV2-FIRST-ACTION` kept `NO_ELIGIBLE_CANONICAL_ACTION` and "Gate 2 BUILDS it" as active typed fields beside prose withdrawing both | MAP_CLAIM | D | **ACCEPTED (P0)** — a machine reading the packet reads the withdrawn conclusion | §9 — retyped `CANONICAL_ACTION_SEARCH_NOT_PERFORMED` — pin: "the search the charter requires has not been run" |
| 55 | `WAITING_EXTERNAL_ENVIRONMENT` is not in `playbook:178-193`'s closed lifecycle enumeration, and the map applied that rule to other labels but not this one | MAP_CLAIM | C | **ACCEPTED (P1)** | §7.6, §9 — retyped as `BLOCKED_DEPENDENCY` + reason code — pin: "is a vocabulary correction, not a re-decision" |
| 56 | The status header said "Revision 3", "twice" and "two rounds" while the table below listed three and §13/§14 existed | MAP_CLAIM | E | **ACCEPTED (P1)** | the status section — **which carries no number and is therefore not a machine-verifiable target**; §15 records the limit below rather than faking a pin — pin: "one correction in this register lands somewhere the check cannot reach" |
| 57 | `MIN_REGISTER_COLUMNS = 4` excluded §12's three-column correction sweep — the one table whose subject is stale targets — and no minimum row count is defensible either | MACHINE_CHECK | — | **ACCEPTED (P1)** | `review-register.ts`, §14 — annotation tables parsed; row-count minimum removed — pin: "That table is now parsed as what it is" |
| 58 | Pins used unbounded substring matching, parent `ownText` included nested subsections despite the comment claiming otherwise, and a row could match a neighbouring row in its own register | MACHINE_CHECK | — | **ACCEPTED (P1)** — the subsection half was a real bug, not a comment slip | `review-register.ts`, §14 — pin: "That was a real bug, not a documentation slip" |
| 59 | §14 claimed every row reference was register-qualified and every section reference resolved; fourteen bare row references, `§ status`, and 44 ASCII `S7.2`-form references say otherwise | MACHINE_CHECK | D | **ACCEPTED (P1)** — found independently by the delivering lane as SF-3 | `review-register.ts`, §14 — both notations parsed, bare citations rejected — pin: "ASCII references went unchecked, almost all of them in" |
| 60 | External targets are accepted by syntax alone, so `#999999` satisfies a register row | MACHINE_CHECK | A | **ACCEPTED (P1)** | §14 — declared as a shape test — pin: "External targets are matched by shape only" |
| 61 | Asserting `unpinnedLegacyRows === 55` detects a net count change, not carve-out growth | MACHINE_CHECK | E | **ACCEPTED (P1)** | test, §14 — exact row-identity set asserted — pin: "a count is not monotonic" |
| 62 | §6.7 cited `eligible-set-scheduler.mjs:1792` for records that are at `:1805-1806` | MAP_CLAIM | A | **ACCEPTED (P2)** — found independently by the delivering lane as SF-4 | §6.7 — pin: "which is the `acquirePhaseTwoClaim` call" |

Found by the delivering lane while round 4 was running, and not by round 4:

| # | Defect | Pattern | Verdict | Fixed in |
| --- | --- | --- | --- | --- |
| 63 | §10 row 16 named "Gate 1a releasable now" as its correction; §7.6 has said `BLOCKED_DEPENDENCY / PREDECESSOR_MAP_DEFECTIVE` since round 3. Sixth instance of §13's structural finding, inside the unpinned legacy carve-out | D | **ACCEPTED (P0)** | §10 row 16, §14 — pin: "the sixth instance of §13's structural finding" |
| 64 | §5.6 said the broker is "the only place on `main` where audit is fail-loud" and that a brokered command that cannot reach the ledger "fails rather than completing unrecorded". `broker.mjs:55` aliases `auditBrokerAction` to `auditFabricAction`, whose first line (`audit.mjs:34`) returns silently when the ledger root is absent. §13 row 36 had established this for §5.1 and the correction never reached §5.6 | A, B | **ACCEPTED (P0)** | §5.6 — pin: "the brokered command completes unrecorded" |

### What round 4 changes about this map's own thesis

Rounds 1-3 supported a claim about method: the defect is in how claims are made, not in any single
row. Round 4 sharpens it in a way the earlier rounds structurally could not, because it is the first
round pointed at the map's **accepted** findings as well as its own.

**Two of them fell.** §13 row 38 and §11 row 15 had survived three rounds — not because they were
verified, but because nothing had ever been aimed at them. §12 row 35 had already shown one accepted
finding was false and the map treated that as a single event. It was a sample.

That reframes every register in this document. A row marked **ACCEPTED** records that the delivering
lane agreed with a reviewer; before round 4 it recorded nothing more, and §10 and §11 hold 55 such
rows whose re-verification is only as good as round 4's sweep of them. Round 4's
`SURVIVED_REVERIFICATION` list names roughly fifty it re-opened and confirmed with the lines it read,
and its `NOT_REVIEWED` list names those it did not reach — including §10 row 12 and §11 rows 8, 10,
12, 18 and 27. **Those remain unverified in both directions and are not evidence.**

Round 4 also could not run the focused Vitest suite: the read-only Windows sandbox denied every
process spawn with `CreateProcessAsUserW failed: 5 (Access is denied.)` on 27 attempts. Its review of
the machine check is therefore static reading only, and it said so rather than implying a run. The
delivering lane ran the suite here; that is a different lane's evidence, and this row does not
transfer it. Round 5 is given a writable workspace and an explicit read-only instruction so that gap
closes with post-review verification of `git status` and `HEAD`.

**The six rows round 4 left unreviewed have since been opened by the delivering lane, and all six
hold.** They are recorded here as *this lane's* evidence, not as an independent re-verification —
the distinction round 4 itself drew about the test run, applied to the delivering lane in turn:

| Row | Re-opened at | Result |
| --- | --- | --- |
| §10 row 12 | `probe-windows.ps1:116` (`vram_bytes = if ($_.AdapterRAM) { [int64]$_.AdapterRAM } else { $null }`), `:125` (warning only) | holds, exactly as cited |
| §11 row 8 | `pinned-evidence-registry.mjs:146-152` — `exactKeys(gpu, ["name","vram_total_mb","vram_free_mb","vram_used_mb","util_pct","temp_c"])`, index-keyed, **no `uuid` and no `pci_bus_id`** | holds. The row cites `:443,511`, which are real members of the path; the *shape* evidence is at `:146-152` and the row does not cite it |
| §11 row 10 | `lib/resource/probe.ts:144-150` — `probeCommand` emits `if [ -e … ]; then du -sb … ` and has no PowerShell branch | holds |
| §11 row 12 | `app/api/resource/verify/route.ts:31-32` checks only `session?.user`; `:46-54` filters on `lower(resourceKey)`/`lower(canonicalIdentity)` with **no `userId`** | holds — the security claim is real |
| §11 row 18 | `scripts/execution-fabric/README.md:41-44` — promotion requires "an exact match to the trusted hashed machine-identity pin"; an unpinned node "remains declared and unschedulable" | holds |
| §11 row 27 | `williamos-experience-v2-phase0-review-evidence.md:209` now names the two reserved test files, and `:213-216` records the earlier over-claim | holds, and its correction landed |

Round 5 should still open them independently. One lane confirming its own register is worth less than
a second lane doing it, which is the whole argument of this section.

**And one correction in this register lands somewhere the check cannot reach.** §15 row 56's target is
the status section at the top of this document, which carries no number. Every rule in §14 keys on a
numbered heading, so that correction is verified by reading and by nothing else. Giving the status
section a number would fix it; renumbering fourteen sections during an active review round would not
be a fix, so the gap is recorded here and carried to round 5 rather than papered over with a pin
pointed somewhere convenient.

Phase 0 remains **`PHASE_0_NOT_PASSED`**. Four independent rounds, four `MAP_DEFECTIVE` verdicts, and
the first round to look in the other direction found two accepted findings that were wrong. Gate 1a
is `BLOCKED_DEPENDENCY` and does not start on this map.
