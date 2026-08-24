# WilliamOS Experience V2 — Phase 0 Reconciliation and Collision Map

Document: `WILLIAMOS-EXPERIENCE-V2-PHASE0-COLLISION-MAP-001`

Gate: `#987` Gate 0 — reconciliation freeze. Charter:
[`williamos-experience-v2-implementation-charter.md`](williamos-experience-v2-implementation-charter.md).
Evidence artifact:
[`williamos-experience-v2-phase0-review-evidence.md`](williamos-experience-v2-phase0-review-evidence.md).

Status: `PASS — REMEDIATED AFTER INDEPENDENT ADVERSARIAL REVIEW (ROUND 1)`.

Revision 2. The independent adversarial review the charter requires returned **`MAP_DEFECTIVE`**
against revision 1. Every finding was re-verified against the code by the delivering lane before being
accepted or refuted; §10 is the finding-by-finding register with verdicts and exact-line evidence.
Revision 1's defective claims are corrected in place below, not softened — where revision 1 asserted
something the code contradicts, the correction says so.

Phase 0 is declared `PASS` because every mandatory read has actually happened (§2), and because the
map's ownership claims have now survived adversarial attack and local re-verification. An earlier
revision claimed `COMPLETE` while mandatory evidence was inaccessible; that claim was wrong and is
retracted in §2.

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
| Live HERMES probe | Not attempted | **`WAITING_EXTERNAL_ENVIRONMENT`.** See §9 `CONT-EXPV2-P0-RUNTIME-PROOF` | Typed with automatic continuation; not an owner task |

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

GATE 2: EXTEND, dependency-gated
  reason code:      GATE1_PREREQUISITE + RESERVATION_NOT_YET_TAKEN
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
GATE 1: DEPENDENCY_CLEARED
  freeze scope:     clear -- outside #921's Environment-path freeze
  reservation:      uncontested -- measured above across the complete path set
  bounded packet:   #990 EXPERIENCE_V2_GATE1_SYSTEM_OBJECT_PROJECTION, opened under #987/#985 with
                    WO-985-GATE1-SYSTEM-OBJECT-PROJECTION (schemaVersion 2), the S7.2 reservation set,
                    the S7.5 invariants as acceptance, and the S7.6 1a/1b split.
                    charter:464-470 makes that packet the required predecessor of implementation, and
                    AGENTS.md:9-10 requires the active authority-matched Work Order. A documentation
                    PR is not that packet; #990 is.
  history:          revision 2 opened at FREEZE_SCOPE_CLEAR / NOT_YET_DEPENDENCY_CLEARED, which was
                    the correct state until #990 existed. CONT-EXPV2-GATE1-PACKET (S9) is CLEARED.
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
| Owns | reachability: transport, host, user, enrolment | identity, hardware inventory, owner-directed role, authority allow/deny, evidence freshness, capability health |
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

```
IDENTITY, HARDWARE, OWNER-DIRECTED ROLE, AUTHORITY, EVIDENCE FRESHNESS
    -> Execution Fabric inventory. Authoritative. A machine identity that is not pinned in the
       seed is NOT promoted (README:42-44).

TRANSPORT, HOST, USER, ENROLMENT, REACHABILITY
    -> transport registry. Authoritative. The Fabric inventory says nothing about how to reach a node.

JOIN
    -> NOT string equality on the key. The seed's HERMES node has id "hermes-node" and hostname
       "HERMES" (registry.seed.json:43-44), while the transport registry keys by short operational
       name with a separate `host` field (tests/fabric-registry-writes.test.ts:21,25). Gate 1 owns an
       explicit resolver; a name match is a hint, the machine identity pin is the proof.

CONFLICT
    -> the transport registry's `role` field is an operational label and MUST NOT override the seed's
       owner-directed `role`. Where they disagree, project both and mark the transport side `stale`.

ABSENCE
    -> a node present in one registry and not the other still projects, with truthState `unknown` for
       the missing half. Never fabricate the missing half; never drop the node.
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
| Node command transport + audit | `lib/fabric/broker.mjs`, `lib/fabric/audit.mjs` | `REUSE` | Unknown node → `BrokerDenied`; host keys pinned (`run-baseline.mjs:243-251`); every outcome incl. refusals audited. `brokeredExec` **already supports and audits local execution** (`broker.mjs:96-104`). |
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

**Gate 2 must converge these two into one Object + Action Registry.** #987's finding — "existing
`workbenchActionRegistry` is the predecessor for one Object + Action Registry, but it is currently
navigation-only" — names only one of the two halves. This map records the second. Note also that
`router.ts:23` hardcodes `executionAuthorized: false` and `authority.granted: false`: "the registry
never grants authority" is already shipped behavior, and must survive the merge.

### 5.4 Epistemic / memory / decisions

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Memory facts + authority lifecycle | `memoryFact` (`schema.ts:111`) | `EXTEND` | `authority` (`unreviewed→working→reviewed→canon→deprecated/superseded/archived`), `supersededById`, `stale`, `pinned`, `embedding vector(1024)`. Strong substrate. **No second memory database.** |
| Context compartment / world scoping | — | `MISSING` | `memoryFact` has `userId` + `tags[]` and no governed compartment column. `documentChunk` likewise scopes by user. Doc 21's gap statement is confirmed in the schema. Gate 4 concern. |
| Decision register | `decision` (`schema.ts:133`) | `EXTEND` | `status`, `authority` (binding/advisory/informational), `scope`, `evidence[]`, `locked`, `supersedesId`/`supersededById`. Maps onto `DECIDED`/`SUPERSEDED`. |
| Doctrine | `doctrine` (`schema.ts:159`) | `REUSE` | `allowed[]`/`forbidden[]`/`requiresApproval[]` — the policy-diff substrate Gate 11 will need. |
| **Claim lifecycle: confidence, freshness, evidence, expiry** | `truthClaim` (`schema.ts:1106-1122`) | `EXTEND` — **not missing** | Revision 1 classified epistemic state as wholly `MISSING`. Refuted by the schema: `truthClaim` already owns `truthType` (`STATIC \| SESSION \| VOLATILE \| EVIDENCE \| LOCK \| UNKNOWN \| STALE \| ASSUMED`), `confidence`, `freshness` (`fresh\|aging\|stale`), `evidenceId`, `verificationRequiredBefore[]`, `expiresAt`, `status`. `agentClaim` (`:1126-1142`) owns `SELF_REPORTED \| EVIDENCE_BACKED \| UNSUPPORTED \| CONFLICTING \| REQUIRES_VERIFICATION`. |
| Brain Council reasoning packet | `components/brain-council/brain-council-reasoning.ts:24-40` | **noncanonical projection predecessor** | Already shapes question / evidence / unknowns / hypotheses / ranking / confidence, with `safety.readOnly: true`. Its content is a static literal (`:42-`), so it is a UI-side predecessor, not an authority. Do not promote it; do not ignore it when naming the vocabulary. |
| Unified epistemic lifecycle `QUESTION`/`HYPOTHESIS`/`OBSERVED`/`LIKELY`/`PROVEN`/`DISPROVEN` | — | `MISSING` — **narrowed** | What is genuinely absent is the *unified state machine over one subject*, and the transitions between those states. It must reconcile **onto** `truthClaim`/`agentClaim`/`decision`/`doctrine` authority, never beside it. `parkedIdea` (`schema.ts:1188`) is a partial predecessor for `IDEA`/`PARKED`. |

### 5.5 Temporal / evidence / authority

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| **Governance authority log** | `governanceEvent` (`schema.ts:839`) via `lib/governance/events.ts` | `REUSE` — canonical | Closed event-type set (`events.ts:11-34`), `beforeHash`/`afterHash`, never updated in place. This is the authority log. |
| **Register narrative feed** | `eventLog` (`schema.ts:1210`) via `lib/registers/events.ts` | `REUSE` — **not a competing authority** | Open `type: string` with `logEvent`/`getRecentEvents` (`registers/events.ts:14-31`). No hash chain, no closed type set. It is a display feed, not an authority. Recorded here because a reviewer flagged the pair as a possible second event authority; it is not, but Gate 6 must not confuse them. |
| Evidence records | `evidenceRecord` (`schema.ts:809`) | `REUSE` | |
| Authority grants | `authorityGrant` (`schema.ts:859`) | `REUSE` | Approval ≠ authority; explicit unexpired unrevoked grant required. |
| Queue receipts | `outcomeQueueAcquisitionReceipt`, `outcomeQueueMutationReceipt`, `goalOutcomeIntakeReceipt` | `REUSE` | |
| Conflicts, locks | `conflictRecord`, `lockRecord` | `REUSE` | |
| `NOW`/`TREND`/`HISTORY`/`CAUSE` projection | — | `MISSING` | Gate 6. Projection only, and it projects from the **hash-chained governance log plus evidence/receipts**, not from the narrative feed. #987: "do not create a new generic event authority." |

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
| "already audited" | **TRUE** | Every step audits through `auditFabricAction` on success and on failure (`run-baseline.mjs:270,298,304`). |
| "reason-preserving on failure" | **TRUE** | Each step carries a named `meaning` for what its failure implies (`lib/fabric/baseline.ts:28-35`). |

Baseline is a genuine and valuable capability gate. It is a **multi-step mutation across the whole
fabric**, and pulling it forward as "the one safe governed action" would have taught Gate 2 that a
fleet-wide start / transfer / force-stop cycle is what a safe object action looks like. Its
authorization is a session check and nothing more (`baseline/route.ts:13-14`) — no authority grant, no
fencing.

#### The corrected first-journey action

**`POST /api/resource/verify`** satisfies every property revision 1 wrongly attributed to baseline:

| #985's requirement | How the route meets it |
| --- | --- |
| selected object | The request carries `identity` and nothing else (`verify/route.ts:34-41`). |
| deterministic action | Probe chosen from a fixed catalogue by KIND, never by caller text (`probe.ts:14,23`). |
| read-only | `PROBE_KINDS = ["exists-size"]`; "adding one that writes would defeat the point of the seam" (`probe.ts:22-24`). |
| governed execution | Dispatched through `brokeredExec` with `action: "resource-verify"` (`verify/route.ts:83-84`) — audited, unknown node denied. |
| target not inferred | Node comes from the record's identity prefix; unsafe or relative paths are refused, not escaped (`probe.ts:87-101`). |
| observed post-state | `readObservation` returns `exists`, `observedBytes`, `recordedBytes`, `agrees` (`probe.ts:35-44`, `verify/route.ts:87`). |
| evidence | Appends a governance event (`verify/route.ts:1,117`). |
| honest partiality | What could not be probed is reported with a reason, not silently dropped (`probe.ts:125-140`). |

That is the whole journey — `select object → deterministic action → governed execution → observed
post-state → evidence` — already shipped, already governed, and mutating nothing.

The relocate/restore pair in `lib/resource/mutation.ts` remains the model for how a *mutating* action
must be shaped, and must not be pulled forward for demo value.

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
6. **GPU observation is spread across eight call sites, not two.** Revision 1 counted two and
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

   **Used VRAM and headroom are already observed and already validated on this fabric**:
   `pinned-evidence-registry.mjs:148` requires `vram_total_mb`, `vram_free_mb` and `vram_used_mb` per
   GPU, and `:159,162,179` enforce `gpu_vram_headroom_mb` before an inference capability may read
   `READY`. What is missing is narrow and exact: **`memory.used` is absent from the node-probe query
   and from the canonical registry GPU schema**, so headroom cannot reach the System Object Graph
   *through the canonical inventory path*. That is the gap Gate 1 closes.
7. No second scheduler, memory system, event authority, node **inventory**, or command registry beyond
   those named above was found on `main`. The `DO-NOT-REBUILD` register's remaining rows still have
   exactly one owner.

## 7. Gate 1 — the smallest valid Phase 1 slice, rescoped

**Bounded child:** canonical `SystemObject` projection over existing fabric truth, read-only.

Status: `DEPENDENCY_CLEARED` (§3). The reservation is uncontested and the bounded child packet
exists: **#990** `EXPERIENCE_V2_GATE1_SYSTEM_OBJECT_PROJECTION`, carrying
`WO-985-GATE1-SYSTEM-OBJECT-PROJECTION` with this section's reservation set, §7.5 as acceptance, and
the §7.6 split.

### 7.1 The convergence rule, corrected

Revision 1 proposed that `route.ts` issue and parse its own `nvidia-smi` query on both dialects while
the standalone probes were separately extended. The review's verdict is accepted: that is a **third**
structured GPU observer, not a convergence, and it directly contradicts revision 1's own §6 finding.
Revision 1's proposed query also silently dropped `driver_version`, which both canonical probes carry.

The corrected direction:

```
canonical probe (probe-windows.ps1 / probe-linux.sh)   -- the ONLY structured GPU observer
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

- **`config/execution-fabric/registry.schema.json`** — extend `$defs.gpu`. Today it is
  `additionalProperties: false` with no used-VRAM property (`:74-90`), so a probe emitting
  `vram_used_bytes` fails validation. Add the field **and** bump `schema_version`; do not remove
  `driver_version`.
- **`scripts/execution-fabric/assemble-registry-core.mjs`** — the assembler validates every probe GPU
  against `$defs.gpu` (`:449,455-458`); on any failure it calls `recordInvalidProbe` and returns
  `null` (`:485-488`), and the node falls back to the **declared seed**. Extending the probe without
  extending the assembler would therefore produce exactly the stale-state failure Gate 1 exists to
  prevent. Its `exactKeys` node-shape check (`:433`) must also accept any new node-level field.
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
- **`lib/system/registry-join.ts`** — new. The §4.1 resolver and precedence rules. Transport registry
  joined to Fabric inventory by machine-identity pin, with name as a hint only.
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
11. **Registry join**: a node present only in the transport registry, and a node present only in the
    Fabric inventory, each project with `unknown` for the missing half, and neither is dropped nor
    fabricated.
12. **No unbrokered transport**: no Gate 1 code path executes a node command outside `brokeredExec`.
13. **Precedence**: a transport-registry `role` that disagrees with the seed's owner-directed role does
    not override it; both are projected and the transport side marks `stale`.

### 7.6 Gate 1 splits in two — releasable now, and settled on HERMES's return

Recorded owner direction, 2026-08-24: HERMES is offline because the P40 is being physically installed.
The absence of a canonically attested P40 is therefore **expected and correct** — the system is
rightly refusing to attest hardware it has not observed. That is a good truth-semantics result and is
not treated as a defect anywhere in this map.

The review's merge-threshold finding and that direction converge on the same answer: split the gate.

```
GATE 1a -- SCHEMA / PARSER / PROJECTION            RELEASABLE NOW
  content:     S7.2 in full, S7.4 projection rules, S7.5 invariants 1-13
  evidence:    deterministic tests with synthetic probe fixtures; the deterministic CI suite green
  merges on:   its own tests. It claims NO runtime proof and must not.
  terminal?    NO. Accepting 1a does not accept Gate 1.

GATE 1b -- LIVE RUNTIME SETTLEMENT                 WAITING_EXTERNAL_ENVIRONMENT
  condition:              HERMES_REACHABLE
  continuation:           automatic
  ownerDecisionRequired:  false
  content:     the discovery sequence below, executed against the real machine
  mandatory:   before Gate 2 terminal acceptance. Gate 2 may not be accepted on 1a alone.
  scheduler:   this state must not park unrelated eligible work. Non-HERMES work continues.
```

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
| Authority-matched bounded child packet | **MET** — #990, opened under #987/#985 (§3, §9) |
| Live HERMES accelerator observation | **`WAITING_EXTERNAL_ENVIRONMENT`** — Gate 1b; automatic continuation on `HERMES_REACHABLE` |

## 8. Phase 0 report

```
PHASE: 0 -- Reconciliation freeze (#987 Gate 0)
STATUS: PASS (revision 2, remediated after independent adversarial review round 1)

CURRENT TRUTH DISCOVERED
  Backend truth primitives are strong and singular: the Execution Fabric inventory with pinned
  machine identity, a fingerprint-merged transport registry, brokered audited transport,
  probe-on-request with preserved failure reasons, system truth classes, memory authority lifecycle,
  decision/doctrine supersession, hash-chained governance events, evidence, authority grants, queue
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
    selected-node brokered action revision 1 claimed. POST /api/resource/verify is the correct first
    journey action and already satisfies every #985 property (S5.6).
  - Used VRAM and headroom are ALREADY observed and validated on this fabric by specialist producers.
    Revision 1 called headroom fabric-wide unobtainable. It is missing only from the node-probe query
    and the canonical GPU schema (S6.6).
  - lib/intent/router.ts is a competing static action catalogue, not a registry consumer (S5.3).
  - THREE frontend compositions exist, not two: /env (#919) shipped beside /environment (#922) (S5.2).
  - truthClaim already owns claim confidence/freshness/evidence/expiry. Epistemic state is EXTEND,
    not MISSING; only the unified lifecycle is new (S5.4).
  - Extending the probes alone would be REJECTED by the canonical schema and silently replaced by
    declared seed data. Gate 1 must move the schema, the assembler and the digest pin together (S7.2).
  - #921 freezes Claude mutations on the ENVIRONMENT PATH. Gates 3/5 are BLOCKED_RESERVATION behind
    PR #927's measured file set; Gate 2 is EXTEND, dependency-gated. BLOCKED_AUDIT_FREEZE was not a
    canonical lifecycle state and is withdrawn (S3).

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
          WAITING_EXTERNAL_ENVIRONMENT / condition=HERMES_REACHABLE / continuation=automatic /
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
  3. (CLOSED during this revision.) Gate 1's bounded child packet now exists: #990. Gate 1 moved
     FREEZE_SCOPE_CLEAR / NOT_YET_DEPENDENCY_CLEARED -> DEPENDENCY_CLEARED.
  4. Gates 3/5 are BLOCKED_RESERVATION behind PR #927; Gate 2 is dependency-gated on Gate 1 plus a
     fresh bounded reservation (S3).
  5. Round-1 independent review is complete and remediated here. A bounded re-review of THIS revision
     is the remaining assurance step (S9, CONT-EXPV2-P0-REVIEW-2).

NEXT  Build Gate 1a under #990. Gate 1b resumes automatically on
      HERMES_REACHABLE. Gate 2 after Gate 1 (both halves) plus a fresh reservation. Gates 3/5 stay
      BLOCKED_RESERVATION regardless.
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
| `tests/multi-agent-eligible-set-scheduler.test.ts :: * :: SCHEDULER_LOCK_WALL HEARTBEAT_START_REQUIRED` | lease-timing sensitive under parallel load | Passes under the CI profile. Not in any Gate 1 path. |

None of these files touches `lib/system/`, `app/api/fabric/`, `lib/fabric/`, `scripts/execution-fabric/`
or `config/execution-fabric/`, so none can be caused by, or mask, a Gate 1 change.

## 9. Typed continuations — internal, not owner work

No entry is an owner ask. Each is a typed state with an internal owner and an automatic pickup
condition, per #957 and the owner-directed execution doctrine.

```
CONT-EXPV2-P0-RUNTIME-PROOF
  type:                   WAITING_EXTERNAL_ENVIRONMENT
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

CONT-EXPV2-P0-REVIEW-2
  type:      INDEPENDENT_REVIEW_PENDING
  subject:   bounded adversarial re-review of THIS revision of the collision map
  round 1:   COMPLETE. Verdict MAP_DEFECTIVE. Findings adjudicated and remediated in S10.
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
| 8 | Baseline is read-only, selected-node, brokered | **ACCEPTED (P0)**, with one sub-claim refuted | All-node: `baseline/route.ts:18,23` → `run-baseline.mjs:382-386`. Mutating: `:330-338,341-348,361-369`. Not brokered: `:309-318` raw `exec`. **But audited**: `:270,298,304` | §5.6 — reclassified as a mutating all-node gate; `POST /api/resource/verify` chosen as the first-journey action, property by property |
| 9 | Blanket Gate 2/3/5 freeze | **ACCEPTED (P1)** | #921 body: "freeze further Claude mutations in the Environment path; preserve reusable backend/API/data work"; PR #927's **54** files contain no `workbench-action-registry.ts` and no `router.ts`, and nothing under `lib/system/`, `app/api/fabric/`, `lib/fabric/` or `*/execution-fabric/` | §3 — Gate 2 `EXTEND`, dependency-gated; Gates 3/5 `BLOCKED_RESERVATION` on the measured file set |
| 10 | `BLOCKED_AUDIT_FREEZE` | **ACCEPTED (P1)** | `multi-agent-operator-playbook.md:178-193` state list; `:196-198` forbids substituting reason codes for state names | §3 — canonical states with a separate reason code |
| 11 | Gate 1 `RELEASABLE` | **ACCEPTED (P1)** | `charter:464-470`; `AGENTS.md:9-10`; no bounded child packet exists | §3 — `FREEZE_SCOPE_CLEAR / NOT_YET_DEPENDENCY_CLEARED`, then **cleared in this same revision** by opening #990; §9 |
| 12 | Fallback VRAM projects `UNKNOWN` | **ACCEPTED (P1)** | `probe-windows.ps1:116` emits `AdapterRAM` as `vram_bytes`; `:125` only warns | §7.4 — a `vram_source` field and explicit qualified-lower-bound projection rules; §7.5 invariant 7 |
| 13 | Epistemic state wholly `MISSING` | **ACCEPTED (P1)** — an unverified candidate, confirmed locally | `schema.ts:1106-1122` `truthClaim`; `:1126-1142` `agentClaim`; `brain-council-reasoning.ts:24-40` | §5.4 — `truthClaim`/`agentClaim` `EXTEND`; Brain Council a noncanonical projection predecessor; only the unified lifecycle new |
| 14 | "Nothing on main models a GPU/disk/service as an addressable thing" | **ACCEPTED (P1)** | `registry.schema.json:74-97,142-159,290-315` define identified gpu/disk/runtime/node objects | §8 — restated as a missing cross-surface addressable projection and identity resolver |
| 15 | "No new failing file" acceptance rule | **ACCEPTED (P1)**, and extended | `vitest.ci.config.ts:10-22,32-36`; `ci.yml:24,53`. Four of the five recorded failures are explained by the wrong profile, and the correct profile runs green (§8.1) | §8 — deterministic CI profile is the gate; §8.2 records stable signatures |
| 16 | Gate 1 may merge on synthetic fixtures | **ACCEPTED (P1)**, resolved with the owner direction | `charter:205-217,573-575` | §7.6 — Gate 1a releasable now; Gate 1b `WAITING_EXTERNAL_ENVIRONMENT`, mandatory before Gate 2 |
| 17 | Gate 1 collision proof (3 prefixes, 6 branches) | **ACCEPTED (P2)** | Gate 1 also mutates `scripts/execution-fabric/` and `config/execution-fabric/` | §3 — re-measured over the complete path set, all 9 open-PR lanes and all 404 remote refs; the conclusion survives |
| 18 | "The only record that exists"; seed = registry truth | **ACCEPTED (P2)** | `registry.seed.json:57` `declared-seed; live probe required`, `ttl_seconds: 0` | §4.2 — "the only on-main declared seed record located"; evidence classes in §1 |
| 19 | "HERMES serves the app, so `probeLocal()` measures it" | **ACCEPTED (P2)** | `route.ts:117` selects transport from the registry's `transport` field, not from identity | §4.2 — restated as a runtime fact of the deployment's `nodes.json` |
| 20 | Session-local observations presented as repository facts | **ACCEPTED (P2)** | the tailnet, port, ICMP and home-directory claims have no tracked artifact | §1 evidence classes; §9 labels; the sanitized evidence artifact |
| 21 | "HERMES is offline" ambiguous beside `AGENTS.md:68` | **ACCEPTED (P2)** | `AGENTS.md:68` describes the execution backend, not node reachability | §9 — surface, timestamp and the P40-install cause all stated |
| 22 | Preference store collides with `memoryFact.kind="preference"` | **REFUTED** | Revision 1 already drew exactly this distinction (`schema.ts:115`); #987 independently: "No credible canonical Experience V2 preference store was found" | §5.8 unchanged; the refutation is recorded |
| 23 | `lib/governance/events.ts` vs `lib/registers/events.ts` is a second event authority | **REFUTED at P0; ACCEPTED at P2 for precision** | `events.ts:11-34` closed type set plus hash chain, vs `registers/events.ts:14-31` open `type`, no chain; #987: "do not create a new generic event authority" | §5.5 — the two are named and separated; Gate 6 projects from the hash-chained log |
| 24 | Baseline is not audited (implied) | **REFUTED** | `run-baseline.mjs:270,298,304` audit every step, on success and on failure | §5.6 records audited = TRUE |

Four candidates reached the round-1 coordinator unverified because their lanes died at
`code-mode host exited during handshake`. All four were verified locally here: rows 7 (confirmed),
13 (confirmed), 23 (refuted at P0, accepted at P2), 22 (refuted).
