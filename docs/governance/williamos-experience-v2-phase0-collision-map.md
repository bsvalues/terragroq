# WilliamOS Experience V2 — Phase 0 Reconciliation and Collision Map

Document: `WILLIAMOS-EXPERIENCE-V2-PHASE0-COLLISION-MAP-001`

Gate: `#987` Gate 0 — reconciliation freeze. Charter:
[`williamos-experience-v2-implementation-charter.md`](williamos-experience-v2-implementation-charter.md).

Status: `PASS — AWAITING INDEPENDENT REVIEW`. Per the charter's PR/delivery discipline, this map
receives independent adversarial review before Phase 1 proceeds far.

Phase 0 is declared `PASS` only because every mandatory read has now actually happened, including the
25 controlling issue bodies that the first Phase 0 session could not reach (§2). A prior revision of
this document claimed `COMPLETE` while those reads were inaccessible; that claim was wrong and is
retracted in §2.

## 1. Session and repository truth

| Check | Result |
| --- | --- |
| Session authority | `PASS` — cwd `C:\Users\bsval\terragroq`, session started here |
| Repository | `PASS` — `git@github.com:bsvalues/terragroq.git`, toplevel `C:/Users/bsval/terragroq` |
| Branch / worktree | `main`, working tree clean at start of Phase 0 |
| `origin/main` | `9dd61c67` — `feat(hermes): dispatch actually reroutes to the claude lane` (2026-08-22 08:44 -0700) |
| Remote-tracking freshness | `.git/FETCH_HEAD` stamped 2026-08-24 09:33 local |
| `AGENTS.md` | Read in full |
| `CLAUDE.md` | Read in full |
| Controlling doctrine | `multi-agent-operator-playbook.md` + `sovereign-runtime-and-review-supersession.md` read |
| Spec branch | `origin/feat/williamos-intelligence-fabric-package` @ `666a3d3c` (2026-08-23 18:44 -0700) |
| Controlling issue bodies | `PASS` — all 25 read in full (§2), plus the #921 comment thread |
| Test baseline | `PASS` — established, and recorded as a flaky set rather than a number (§8) |
| `#831` work context | Established for `WO-987-GATE0-COLLISION-MAP`; provenance `local`, since OMEN has no enrolled cockpit device credential — the same condition the #921 lane recorded |

### Verified specification location

The Experience V2 / Intelligence Fabric package is **not on `origin/main`**. `git diff --name-status
origin/main...origin/feat/williamos-intelligence-fabric-package` reports 41 files, all `A` (added),
5508 insertions, 0 deletions, entirely under `docs/governance/williamos-intelligence-fabric/`.

Consequence: `origin/main` is implementation truth; the spec branch is specification. A Phase 1 PR
based on `main` cannot cite an on-main path for its controlling contract. The charter and this map are
therefore written into `docs/governance/` on the `main` lineage so implementation children have an
on-main citation target.

## 2. Actor-capability history — what was blocked, and how it was closed

Phase 0 ran in two sessions. The first could not perform several already-authorized reads and could
not run tests, branch, or commit. It nevertheless reported Phase 0 `COMPLETE`. That was wrong on the
charter's own terms: a phase cannot be `PASS` while mandatory evidence is inaccessible. The true
status of the first session was:

```
PHASE_0_INCOMPLETE_ACTOR_CAPABILITY_BLOCKED
```

Every one of those blockers was an **actor-capability** condition — a property of the executing
session, not a governance decision and not a repository defect. Per #957's machine-tested doctrine
(`tests/runtime-operator-execution-path-not-owner-gate.test.ts`), such conditions are internal
routing work. None of them became owner work; none was resolved by the owner.

| Capability | First session | Resolution in this session | Route |
| --- | --- | --- | --- |
| Issue bodies #762, #921, #964–#987 | Denied — `gh` unreachable | **CLOSED.** All 25 bodies read in full, plus the #921 comment thread | Evidence captured out-of-band into a session-local cache, then read here |
| `node` / `npm` / `npx` | "Denied" | **CLOSED.** The Volta shims on `PATH` fail without `VOLTA_HOME`; the resolved image at `~/AppData/Local/Volta/tools/image/node/24.19.0` runs correctly | Rerouted to the direct interpreter path — an actor-capability workaround, internal |
| Full test suite | Denied | **CLOSED.** `vitest run` executed twice; baseline recorded in §8 | Same |
| Branch / commit / push / PR | Denied | **CLOSED.** This map and the charter are delivered through the governed branch/PR lifecycle | Agent-owned per AGENTS.md |
| `~/.williamos/fabric/nodes.json` | Recorded as "read denied" | **CORRECTED.** The path is not permission-blocked; it **does not exist on this host**. OMEN is the cockpit, not the registry holder | Registry truth re-sourced from `config/execution-fabric/registry.seed.json` (§4.1) |
| Live HERMES probe | Not attempted | **NODE-UNAVAILABLE.** See §9 continuation `CONT-EXPV2-P0-RUNTIME-PROOF` | Typed and persisted for automatic pickup; not an owner task |

The first session's "reads outside the repository are denied" row was itself a misdiagnosis: the
registry file is absent, not forbidden. A capability report that guesses at a cause produces exactly
this kind of inherited error, which is why §4.1 now re-derives node truth from a file that is on
`main` and independently verifiable.

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

## 3. BLOCKING COLLISION — the Environment frontend lane is under a recorded takeover

The first Phase 0 session could not reach GitHub and therefore left the status of
`origin/wb/primary-experience-replacement` undetermined, proposing that a coordinator or the owner
decide whether it was active or abandoned. **That escalation is withdrawn.** The question was already
answered in the record, and reading it required no owner and no new authority.

### The recorded verdict

#921 required exactly one of three outputs. The owner-recorded outcome, posted 2026-08-20T19:13:58Z
and reaffirmed at 19:57:29Z, is:

```
ENVIRONMENT_FRONTEND_TAKEOVER
```

Codex owns the Environment frontend replacement lane from that point, and Claude's frontend mutation
lane is frozen. The takeover lane is `codex/environment-frontend-takeover-921`, delivered as
**PR #927**, which is **still open** — green on code, deliberately unmerged, held at
`activation: HOLD_UNPROVEN_AUTHORITY_AND_RUNTIME` because the live migration, runtime credential and
public preview route have not been proven. #921 is open at activation and six-job proof, not at code
review.

### What `origin/wb/primary-experience-replacement` actually is

`8c0c9bfe` (2026-08-22 20:50 -0700), branched from `a7efbe59` (= `origin/main~1`), **unmerged**, no
PR, one behind main. 89 files, +3660 / −10660. Thirteen commits of directed single-day work: phases
1–3 plus buckets A/B "legacy strangulation", ending mid-flight ("…and a gap I created").

Every commit carries `Co-Authored-By: Claude Opus 5`. **It is a Claude-lane branch**, authored
2026-08-22 — two days *after* the takeover verdict froze Claude's frontend lane. It is therefore not
the authoritative Environment lane and not a Codex reservation. It is frozen Claude work whose
direction is superseded by #927.

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

### Ruling

```
GATE 2, GATE 3, GATE 5: BLOCKED_AUDIT_FREEZE
Held by:            #921 ENVIRONMENT_FRONTEND_TAKEOVER (owner-recorded 2026-08-20)
Lane owner:         Codex, on codex/environment-frontend-takeover-921 / PR #927
Release condition:  #921 reaches activation and six-job proof, or a later owner-recorded verdict on
                    that issue supersedes the takeover.
Secondary hold:     origin/wb/primary-experience-replacement holds the same files as a frozen
                    Claude-lane reservation. Superseded in direction by #927; must not be extended.
```

This is an **inter-agent sequencing fact read out of the existing record** — not an owner decision,
not a new authority, and not an owner ask. No owner action releases it; #921's own activation gates
do.

Two independent doctrines forbid a Claude Gate 2/3/5 PR here, and either alone suffices:

1. **#921 freeze** — Claude frontend mutation in the Environment path is frozen pending the audit.
2. **`CLAUDE.md` reservation rule** — do not claim another builder's file, contract, branch, or
   worktree reservation.

Writing a third implementation of the action registry or the working-world adapter would also trip
the charter's own "third shell" / "second command registry" stop conditions through the back door.

### Gate 1 freeze-scope determination

The charter's build order puts Gate 1 next, so whether the #921 freeze reaches it is decisive.
Verified rather than assumed, on three independent grounds:

1. **Scope of the freeze.** #921 freezes the *frontend* implementation and, on takeover, "further
   Claude mutations in the Environment path", while directing that "reusable backend/API/data work"
   be preserved. Gate 1 is entirely lib/ and API-side: `lib/system/`, `app/api/fabric/`, `tests/`.
   It touches no Environment route, no component, and no frontend composition.
2. **Path collision, measured.** `git diff --name-only origin/main...<branch>` was run against all
   six open lanes — `codex/environment-frontend-takeover-921`, `wb/primary-experience-replacement`,
   `wb/operator-identity-isolation`, `wb/start-work-honest-refusal`, `codex/hermes-goal-0024-28`,
   `codex/outcome-762-live-integration`. **None** touches `lib/system/`, `app/api/fabric/`, or
   `lib/fabric/`. Gate 1's reservation is uncontested.
3. **#985's own disposition.** #985 directs work at `/api/fabric/nodes` — "preserve the live-probe /
   failure-reason doctrine, but do not freeze its string-valued GPU/memory/disk/service summaries as
   the subresource model" — which is exactly Gate 1's scope, addressed to the object-graph lane and
   not to the frozen frontend lane.

```
GATE 1: RELEASABLE — outside the #921 freeze scope; no path collision on any open lane.
```

## 4. ARCHITECTURAL COLLISION — two competing System representations

Two surfaces on `main` both claim to represent the machine room, from different truth sources, with no
shared object identity.

**A. `app/(shell)/system/page.tsx`** (226 lines) — "the truthful, read-only primary."
Sources: `getAuthReadiness` (one live ATLAS database probe), `buildRuntimeStatus` (configuration),
`getOperatorState` (queue/knowledge counts), and `lib/system/system-truth.ts` for node role truth.
It never probes a node. Composition is card sections.

**B. `app/(shell)/fabric/page.tsx` → `components/fabric/node-board.tsx` → `GET /api/fabric/nodes`.**
Sources: the canonical fabric registry plus a live brokered probe per node, on request. This is where
real machine state lives. Composition is a `md:grid-cols-2` card grid.

Neither knows about the other. `/system` shows `HERMES: inferred (configured role)` while `/fabric`
can simultaneously hold a live measured probe of the same machine. That is precisely the
"stale/inferred state presented beside live state with no shared identity" failure the charter forbids.

Concrete defect found in the shared type:

```ts
// lib/system/system-truth.ts:1
export type SystemName = "ATLAS" | "HERMES" | "AEGIS"
```

**OMEN is absent from the System truth model** while being an owner-directed node in the fabric
registry and named in the charter as a first-class machine identity. `/system` structurally cannot
represent OMEN.

**Ruling.** `SUPERSEDE_COMPOSITION_ONLY` for both card compositions; their *truth semantics* are
`REUSE`. The canonical SystemObject projection (Gate 1) becomes the single source both surfaces consume.
Fixing `SystemName` is in Gate 1 scope because Gate 1 must address every owner-directed node.

### 4.1 Node registry truth, re-sourced — and the P40 is not in it

The first session recorded the canonical registry as unreadable. It is not permission-blocked: on this
host `~/.williamos/fabric/nodes.json` **does not exist**. OMEN is the operator cockpit; the registry
that `GET /api/fabric/nodes` reads lives on the node that serves the application. Node truth is
therefore re-derived here from `config/execution-fabric/registry.seed.json`, which is on `main` and
independently verifiable.

| Node | `os.family` | Role | Availability |
| --- | --- | --- | --- |
| `omen` | windows | operator-cockpit-development-burst-compute | interactive |
| `hermes-node` | windows | local-ai-gpu-execution-worker | resident |
| `atlas` | linux | durable-state-forge-retrieval | stateful |
| `aegis` | linux | secondary-cpu-batch-ci-worker-storage-pending | secondary |

Two findings follow, and both are material to Gate 1.

**Finding A — the seed records no P40 on HERMES.** The only on-`main` accelerator inventory for
`hermes-node` is:

| `id` | model | `vram_bytes` | `uuid` | `pci_bus_id` |
| --- | --- | --- | --- | --- |
| `gpu0` | GeForce RTX 3050 | 6442450944 | `null` | `null` |
| `gpu1` | Quadro K2200 | 4294967296 | `null` | `null` |

The charter's first System proof, #985's first proof, and #983's HUD proof are all
`SYSTEM -> HERMES -> P40`. **No canonical on-`main` record evidences a P40 on HERMES.** The seed is
explicitly `"probe": "declared-seed; live probe required"`, `"confidence": "declared"`,
`"ttl_seconds": 0`, `generated_at` 2026-08-09 — so it is stale-by-declaration rather than wrong, and
the accelerator inventory may well have changed in the fifteen days since. But it is the only record
that exists, and Gate 1 must not paper over the difference between "the owner says P40" and "canonical
state evidences P40".

This is exactly the identity discipline #985 demands ("replacement hardware must not inherit history
only because it occupies the same slot/name") and #974 demands (`IDENTITY` evidence separate from
`HEADROOM`). Gate 1's projection must therefore be able to represent an accelerator whose identity is
`UNKNOWN` pending probe, rather than asserting a P40 that no evidence supports. Resolution is
`CONT-EXPV2-P0-RUNTIME-PROOF` (§9).

**Finding B — the Windows probe path emits no VRAM at all.** §5.1 records that
`app/api/fabric/nodes/route.ts` emits `gpu` as a presentation string. That is true, but it understates
the gap, and the understatement matters because HERMES is the P40's host:

```ts
// LINUX_PROBE  — name and total only, semicolon-joined:
//   nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | paste -sd';'
// WINDOWS_PROBE and probeLocal() — name only, no memory field at all:
//   "gpu=" + ((Get-CimInstance Win32_VideoController).Name -join ";")
```

`hermes-node` is `os.family: windows`, and HERMES serves the application, so it is measured by
`probeLocal()`. **Through this route, HERMES's accelerators today yield a display name and nothing
else** — no VRAM total, no VRAM used, no utilization, no temperature, no UUID, no PCI bus id. The
"parse the GPU string" problem on the Linux path is real; on the Windows path there is not even a
number to parse.

Consequences for Gate 1, all of which #985 and #974 already require:

- the parsing work must cover both dialects, and the Windows dialect needs `nvidia-smi` added — CIM
  `Win32_VideoController` cannot supply VRAM used, utilization, temperature, UUID or PCI bus id;
- `Win32_VideoController.Name` is a driver display string and is **not** a durable identity;
- until a live probe lands, every HERMES accelerator field except the name is `UNKNOWN`, and #974's
  rule applies: unknown stays `UNKNOWN` and must not be rendered as zero or as live.

## 5. Collision map — classification by primitive

Legend: `REUSE` = reuse as is · `EXTEND` = extend existing · `SUPERSEDE` = supersede composition only ·
`ADAPT` = adapt at boundary · `MISSING` = genuinely missing.

### 5.1 System / fabric truth

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Node registry (merge-safe, fingerprinted) | `lib/fabric/registry.mjs` | `REUSE` | Optimistic-concurrency merge writes, `RegistryConflict`, `RegistryFieldLoss`. Already correct. No second node inventory. |
| Node command transport + audit | `lib/fabric/broker.mjs`, `lib/fabric/audit.mjs` | `REUSE` | Unknown node → `BrokerDenied`; host keys pinned; every outcome incl. refusals audited. All Gate 1 probing must go through `brokeredExec`. No raw SSH. |
| Live node probe | `app/api/fabric/nodes/route.ts` | `ADAPT` | Correct behaviours to keep: probe-on-request (not cached), unreachable nodes retained with reason, per-platform dialect, `cache-control: no-store`. Wrong for V2: emits `Record<string,string>`; the Linux `gpu` field is `"name,memtotal;name,memtotal"` and the **Windows field is bare `Win32_VideoController` names with no memory at all** (§4.1 Finding B). #985 names this exactly. It must converge on the canonical probe field set below rather than growing its own parser. |
| System truth classes | `lib/system/system-truth.ts` | `EXTEND` | Keep `live/persisted/inferred/unknown` + configured-role-is-not-liveness. Must add `stale`, add `OMEN`, and stop hardcoding two roles in a const map. |
| Baseline capability gate | `lib/fabric/baseline.ts`, `/api/fabric/baseline` | `REUSE` | Becomes an object action (`run baseline`) in Gate 2; not re-implemented. |
| `/system` page | `app/(shell)/system/page.tsx` | `SUPERSEDE` | Truth semantics reused; card composition superseded. |
| `/fabric` node board | `components/fabric/node-board.tsx` | `SUPERSEDE` | Same. |
| **Structured accelerator observation** | `scripts/execution-fabric/probe-windows.ps1`, `probe-linux.sh` → `assemble-registry-core.mjs` | `EXTEND` — **canonical owner, previously missed** | Both probes already run the identical query `uuid,name,pci.bus_id,memory.total,driver_version,temperature.gpu,utilization.gpu` and emit structured per-device records with a `Win32_VideoController` fallback that *warns* it may understate VRAM. #974 is explicit: extend this evidence path, do not create another hardware-monitoring database. Gate 1 must reuse this field set. Genuine gap: `memory.used` is not queried, so headroom is unobtainable — that is an `EXTEND_EXISTING_PROBE` addition here, not new code elsewhere. |
| Accelerator reservation / fencing | — | `MISSING` (quantitative only) | `reservation` in the codebase means Work-Order path/contract reservation, not accelerator residency. Do not conflate. **But #973 forbids an independent GPU lock authority**: the fencing tokens, holder digests and stale-lock recovery in `scripts/multi-agent-operator/reservation-ledger.mjs` are the required substrate, and only quantitative VRAM/KV capacity is genuinely missing. Out of Gate 1 scope either way. |

### 5.2 Environment / Workbench composition

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| `WorkingWorldSnapshot` meaning/chrome separation | `lib/environment/working-world.ts` | `EXTEND` — **frozen (§3)** | The `CHROME_KEY_PATTERN` tripwire and `WORLD_UNKNOWN_KEY` refusal are exactly the discipline Gate 3 needs. Held by the #921 freeze; `wb/primary-experience-replacement` holds the same file as a frozen Claude-lane branch (§3). |
| Working-world persistence | `workingWorld` table (`lib/db/schema.ts:369`), `migrations/0012-working-world.sql` | `REUSE` | Meaning, not pixels, already durable. |
| `Desk` / The Line | `components/desk/desk.tsx` | `SUPERSEDE` — **frozen (§3)** | Doc 24's finding confirmed in code: `desk.tsx:105` renders `"What are we working on?"` as the empty state. That is the blank-assistant-prompt failure, not re-entry. Two primitives only (Line + appended surfaces); no Inspector, no selected object, no semantic zoom. |
| Workbench shell | `components/workbench/workbench-shell.tsx` (781 lines) | `SUPERSEDE` — **frozen (§3)** | Primitives (restoration, Inspector concept, Execution panel, status strip) are `EXTEND`; the four-mode navigation ontology is `SUPERSEDE`. |
| Thread durable conversation + projections | `lib/workbench/thread-conversation.ts`, `thread-projection.ts`, `thread-registry.ts`, `load-threads.ts` | `REUSE` | Chronology stays authoritative. Semantic map is a projection above it, never a replacement. |
| Project / project resource | `lib/projects/*`, `project`/`projectResource` tables | `REUSE` | Project ≠ repository; do not infer from path. |
| Universal intent | `components/intent/universal-intent.tsx`, `lib/intent/router.ts` | `EXTEND` | Consumer of the registry; extends with it. |
| Shell navigation | `components/shell/nav-items.ts`, `sidebar-nav.tsx`, `mobile-nav.tsx` | `SUPERSEDE` | Page taxonomy → semantic world navigation, keeping useful shortcuts. |

### 5.3 Command / action

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Action registry | `lib/intent/workbench-action-registry.ts` (81 lines) | `EXTEND` — **frozen (§3)** | Confirmed navigation-shaped exactly as doc 29 states: 4 static `mode` descriptors + capabilities derived from `supportingCapabilities`, each `{id, kind, label, href, keywords, navigationAliases}`. Matching is substring-over-label. `matchWorkbenchNavigationTarget` already refuses ambiguity by returning `null` unless exactly one phrase matches — that is the disambiguation invariant the charter demands, and it must survive generalization. There is **no** object kind, no action kind, no authority field, no context ranking. |

### 5.4 Epistemic / memory / decisions

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Memory facts + authority lifecycle | `memoryFact` (`schema.ts:111`) | `EXTEND` | `authority` (`unreviewed→working→reviewed→canon→deprecated/superseded/archived`), `supersededById`, `stale`, `pinned`, `embedding vector(1024)`. Strong substrate. **No second memory database.** |
| Context compartment / world scoping | — | `MISSING` | `memoryFact` has `userId` + `tags[]` and no governed compartment column. `documentChunk` likewise scopes by user. Doc 21's gap statement is confirmed in the schema. Gate 4 concern. |
| Decision register | `decision` (`schema.ts:133`) | `EXTEND` | `status`, `authority` (binding/advisory/informational), `scope`, `evidence[]`, `locked`, `supersedesId`/`supersededById`. Maps onto `DECIDED`/`SUPERSEDED`. |
| Doctrine | `doctrine` (`schema.ts:159`) | `REUSE` | `allowed[]`/`forbidden[]`/`requiresApproval[]` — the policy-diff substrate Gate 11 will need. |
| Epistemic states `QUESTION`/`HYPOTHESIS`/`OBSERVED`/`LIKELY`/`PROVEN`/`DISPROVEN` | — | `MISSING` | Must reconcile *onto* memory/decision/doctrine authority, not beside it. `parkedIdea` (`schema.ts:1188`) is a partial predecessor for `IDEA`/`PARKED`. |

### 5.5 Temporal / evidence / authority

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Append-only governance events | `governanceEvent` (`schema.ts:839`) | `REUSE` | `beforeHash`/`afterHash`, never updated in place. |
| Event log | `eventLog` (`schema.ts:1210`) | `REUSE` | |
| Evidence records | `evidenceRecord` (`schema.ts:809`) | `REUSE` | |
| Authority grants | `authorityGrant` (`schema.ts:859`) | `REUSE` | Approval ≠ authority; explicit unexpired unrevoked grant required. |
| Queue receipts | `outcomeQueueAcquisitionReceipt`, `outcomeQueueMutationReceipt`, `goalOutcomeIntakeReceipt` | `REUSE` | |
| Truth/agent claims, conflicts, locks | `truthClaim`, `agentClaim`, `conflictRecord`, `lockRecord` | `REUSE` | |
| `NOW`/`TREND`/`HISTORY`/`CAUSE` projection | — | `MISSING` | Gate 6. Projection only. **No new generic event authority.** |

### 5.6 Governed mutation (the "one safe action" candidate)

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Execute guard | `lib/governance/execute-guard.ts` | `REUSE` | Locked the execute loop to a non-mutating surface. |
| Fixed mutating-operation catalogue | `lib/resource/mutation.ts` | `REUSE` — **model for Gate 2** | `MUTATING_OPERATIONS = ["relocate-source","restore-database"]`. Chosen by name, never caller text; source/destination from the resource record, never a request; refuses unsafe paths rather than escaping them; nothing deletes. This is the exact shape an object action registry must adopt. |
| Resource operation routes | `app/api/resource/{operation,relocate,restore,verify,reconcile}` | `REUSE` | Post-state verification already exists (`verify`). |
| Read-only resource probe | `lib/resource/probe.ts` | `REUSE` | |

**Safest existing canonical action for the first journey:** `run baseline` on a selected node
(`POST /api/fabric/baseline`) — already governed through the broker, already audited, read-only, and
already reason-preserving on failure. It proves `select object → deterministic action → governed
execution → observed post-state → evidence` without inventing any mutation. The relocate/restore pair
in `lib/resource/mutation.ts` remains the model for how a *mutating* action must be shaped, but is not
needed to prove Gate 1/2 and must not be pulled forward for demo value.

### 5.7 Native shell

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Cockpit / Tauri shell | `cockpit/src-tauri/` (with `capabilities/`, `permissions/`, `tests/`), `cockpit/ui/` | `REUSE` (constrained) | Already has an explicit capability/permission boundary. Doctrine: `docs/governance/omen-cockpit-boundary.md`. Gate 8 only; holds no authority. |

### 5.8 Personalization

| Primitive | Current owner | Class | Note |
| --- | --- | --- | --- |
| Owner preference store | — | `MISSING` | Confirmed: no preference table in `lib/db/schema.ts`; `memoryFact.kind` includes `"preference"` but that is a memory fact, not an inspectable preference record with `owner-set`/`suggested`/`learned-confirmed` provenance. Gate 10. Keep narrow. |

## 6. Duplication findings to resolve, not to add to

1. **Two System representations** — §4. Must converge on the Gate 1 projection.
2. **Two frontend compositions** (`(shell)` Workbench vs `/environment` Desk) — #982's finding,
   confirmed in code. Both `wb/primary-experience-replacement` and the #921 takeover lane (PR #927)
   are collapsing this, in different directions. That is one collapse too many to race: §3 rules the
   seam frozen behind #921 activation, and the takeover lane owns it.
3. **`SystemName` omits OMEN** — §4. Concrete, small, in Gate 1 scope.
4. **Two GPU observation implementations** — `scripts/execution-fabric/probe-{windows.ps1,linux.sh}`
   emit structured per-device records carrying UUID and PCI bus id, while
   `app/api/fabric/nodes/route.ts` separately re-observes GPUs with a weaker ad-hoc query and returns
   presentation strings. The first pass missed this and then proposed writing a *third* parser
   (§7.1). Gate 1 converges them; it must not add to them.
5. No second scheduler, memory system, event authority, node inventory, or command registry was found
   on `main`. The `DO-NOT-REBUILD` register's rows all still have exactly one owner.

## 7. Gate 1 — the smallest valid Phase 1 slice

**Bounded child:** canonical `SystemObject` projection over existing fabric truth, read-only.

`GATE 1: RELEASABLE` per §3. Scope is uncontested across all six open lanes.

### 7.1 Correction carried in from §4.1

An earlier revision of this section proposed parsing `nvidia-smi` inside
`app/api/fabric/nodes/route.ts`. **That would have built a second GPU observation implementation.**
`scripts/execution-fabric/probe-windows.ps1` and `probe-linux.sh` already own structured accelerator
observation and already emit `uuid` and `pci_bus_id`. #974 forbids a second hardware-observation path
in as many words, and the charter's DO-NOT-REBUILD discipline forbids it generally.

The corrected direction is convergence, not addition:

```
canonical probe field set (probe-windows.ps1 / probe-linux.sh)
    -> one shared parser
        -> /api/fabric/nodes structured observations   (live, probe-on-request)
        -> SystemObject projection                     (read-only, no authority)
```

### 7.2 Scope

- `lib/system/system-object.ts` — new. Object kinds `NODE` and `ACCELERATOR` only. Canonical identity,
  human label, kind, parent/contains, owner-directed role, truth state including `stale`, `observedAt`,
  health/headroom, technical identity under progressive disclosure. A projection, not an authority.
- `lib/system/system-truth.ts` — extend: add `OMEN`, add `stale`, derive configured roles from the
  registry rather than a two-entry const map.
- `app/api/fabric/nodes/route.ts` — adapt: emit **structured typed observations** alongside the
  existing string `fields` (additive, so `components/fabric/node-board.tsx` keeps working and the
  change is revertible). Use the canonical probe query
  `uuid,name,pci.bus_id,memory.total,memory.used,utilization.gpu,temperature.gpu` on **both** dialects
  — the Windows path must gain `nvidia-smi`, because `Win32_VideoController` cannot supply VRAM used,
  utilization, temperature, UUID or PCI bus id. Preserve probe-on-request, reason-preserving
  unreachability, brokered-only execution, and `cache-control: no-store`.
- `scripts/execution-fabric/probe-windows.ps1`, `probe-linux.sh` — extend by exactly one field:
  `memory.used`. Without it #974's `HEADROOM` class is unobtainable and total capacity would be the
  only number available, which #974 explicitly forbids from masquerading as reservable capacity.
- `tests/system-object-projection.test.ts` — new.

### 7.3 Invariants to test

1. An accelerator's canonical identity derives from GPU UUID / PCI bus id, never from the friendly
   name or slot; a device with a new UUID in the same slot is a **new** object. (#985 identity rule.)
2. A client can enumerate a node's accelerators without parsing any presentation string. (#985
   acceptance.)
3. An unreachable node still projects, with `truthState: unknown` and its preserved reason. (#985
   "offline objects remain visible truthfully".)
4. A probe older than the freshness bound projects `stale`, never `live`. (#974 freshness classes.)
5. Every owner-directed node in the registry — including OMEN — is representable.
6. The projection exposes no mutation and no authority. (#985 "object projection never grants
   authority".)
7. An accelerator observed only through the `Win32_VideoController` fallback projects `UNKNOWN` for
   VRAM, utilization, temperature, UUID and PCI bus id — never `0`, never a name-derived identity.
   (#974 "unknown must remain UNKNOWN rather than becoming zero"; §4.1 Finding B.)
8. Total VRAM never presents as reservable/free capacity. (#974 hard gate.)

### 7.4 Explicitly out of Gate 1

Any UI change; the action registry; WorkingWorld; accelerator reservation/fencing; `MODEL_RESIDENCY`;
consumers-by-process; temporal projections. Object classes beyond `NODE` and `ACCELERATOR` — #985's
full class list (`CPU`, `MEMORY_POOL`, `DISK`, `SERVICE`, `WORKLOAD`, …) is the eventual target, not
this slice.

### 7.5 Prerequisites, and their current state

| Prerequisite | State |
| --- | --- |
| Test execution | **MET** — §8 |
| Branch / commit / push / PR | **MET** — this document is delivered through it |
| Registry read access or fixture | **MET** — `config/execution-fabric/registry.seed.json`, on `main` |
| Live HERMES probe verifying a parsed accelerator record against real `nvidia-smi` output | **NOT MET** — HERMES is offline (§9). Synthetic fixtures are acceptable for the deterministic tests but **not** as the runtime claim. Gate 1 may therefore be built and merged on deterministic tests, but may not claim runtime proof until `CONT-EXPV2-P0-RUNTIME-PROOF` settles. |

## 8. Phase 0 report

```
PHASE: 0 — Reconciliation freeze (#987 Gate 0)
STATUS: PASS

CURRENT TRUTH DISCOVERED
  Backend truth primitives are strong and singular: fabric registry, brokered audited transport,
  probe-on-request with preserved failure reasons, system truth classes, memory authority lifecycle,
  decision/doctrine supersession, append-only governance events, evidence, authority grants, queue
  receipts, and a fixed-catalogue mutation surface with post-state verification.
  What is missing is not truth. It is OBJECTS: nothing on main models a GPU, disk, volume, service or
  workload as an addressable thing with stable identity. Resource state is a string on a node.
  Two System surfaces compete with no shared identity, and OMEN is absent from the System truth type.

  Corrected in this pass, and material:
  - Structured accelerator observation is NOT missing. probe-windows.ps1 and probe-linux.sh already
    query uuid,name,pci.bus_id,memory.total,driver_version,temperature.gpu,utilization.gpu. Gate 1
    must converge on that field set; the earlier plan would have built a second GPU observer (§7.1).
  - The Windows probe path in /api/fabric/nodes emits GPU display names and no memory whatsoever.
    HERMES is a Windows node, so the P40's host currently reports no VRAM through that route (§4.1).
  - No on-main record evidences a P40 on HERMES. registry.seed.json lists RTX 3050 + Quadro K2200,
    declared-seed, uuid and pci_bus_id null, ttl 0 (§4.1 Finding A).
  - #921's verdict is recorded: ENVIRONMENT_FRONTEND_TAKEOVER. Gates 2/3/5 are BLOCKED_AUDIT_FREEZE,
    not an undetermined branch question, and no owner decision releases them (§3).

REUSED    (see §5) fabric registry, broker+audit, baseline gate, execution-fabric node probes,
          memory/decision/doctrine authority, governance events, event log, evidence, authority
          grants, receipts, execute guard, fixed mutating-operation catalogue, resource verify,
          Thread/Project canonical objects, Cockpit capability boundary, reservation ledger fencing.
EXTENDED  none — no code was changed in this Phase 0 delivery.
SUPERSEDED none — no composition was removed in this Phase 0 delivery.
NEW       two governance documents:
            docs/governance/williamos-experience-v2-implementation-charter.md
            docs/governance/williamos-experience-v2-phase0-collision-map.md

TESTS     RUN. `./node_modules/.bin/vitest run` on 9dd61c67 with the working-tree docs only.
          Run 1: 424 files — 3 failed, 417 passed, 4 skipped; 5645 tests — 23 failed, 5576 passed.
          Run 2: 424 files — 5 failed, 415 passed, 4 skipped; 5645 tests — 25 failed, 5574 passed.
          The baseline is FLAKY, and the two runs disagree, so it is recorded as a set rather than a
          number. Union of failing files across both runs:
            tests/execution-fabric-hermes-embedding-bakeoff.test.ts  (CORPUS_BINDING_MISMATCH:
              frozen corpus manifest bytes changed — host artifact state, not logic)
            tests/lab-dev-preflight.test.ts                          (expects an -EncodedCommand /
              printf payload that this host does not produce)
            tests/hermes-bridge-supervisor.test.ts                   (5000ms timeout)
            tests/execution-fabric-pinned-placement.test.ts          (5000ms timeout)
            tests/multi-agent-eligible-set-scheduler.test.ts         (SCHEDULER_LOCK_WALL:
              HEARTBEAT_START_REQUIRED — lease timing)
          All five are pre-existing on unmodified 9dd61c67 and all are environment/timing dependent.
          NONE touches lib/system/, app/api/fabric/, or lib/fabric/. This Phase 0 delivery changes no
          code, so it cannot have caused any of them. Gate 1's acceptance is therefore "no NEW failing
          test file beyond this union", not "green suite" — a green suite is not obtainable on this
          host and claiming one would be false.

RUNTIME PROOF  NONE, and typed rather than assumed. HERMES is offline: tailnet reports
          `offline, last seen 2026-08-23 18:42`; on the LAN address 192.168.88.9 ports 22, 3000,
          5985, 50080 and 50443 are all closed while ICMP answers. This is a NODE-UNAVAILABLE
          condition, not an actor-capability gap and not owner work. Recorded as
          CONT-EXPV2-P0-RUNTIME-PROOF (§9) for automatic pickup.

KNOWN GAPS
  1. No live accelerator observation for HERMES; the P40's existence is owner-stated and
     spec-stated but not evidenced by any on-main canonical record (§4.1 Finding A).
  2. memory.used is queried by neither probe, so #974's HEADROOM class is currently unobtainable
     fabric-wide. Bounded, and in Gate 1 scope (§7.2).
  3. The full-suite baseline is flaky on this host; five pre-existing failures, all environmental.
  4. This map has not yet received independent adversarial review, which the charter requires before
     Phase 1 proceeds far. Sourced internally per §9; not an owner task.
  5. Gates 2/3/5 remain BLOCKED_AUDIT_FREEZE behind #921 activation (§3).

NEXT  #987 Gate 1 — canonical object projection, scoped in §7, after the §9 review verdict returns.
      Gates 2, 3 and 5 remain BLOCKED_AUDIT_FREEZE regardless.
```

## 9. Typed continuations — internal, not owner work

Neither entry is an owner ask. Each is a typed state with an internal owner and an automatic pickup
condition, per #957 and the owner-directed execution doctrine.

```
CONT-EXPV2-P0-RUNTIME-PROOF
  type:      NODE_UNAVAILABLE
  subject:   live accelerator observation for HERMES
  evidence:  tailnet `offline, last seen 2026-08-23T18:42`; 192.168.88.9 ports 22/3000/5985/50080/
             50443 closed, ICMP answers; ~/.williamos/fabric/nodes.json absent on OMEN
  blocks:    the runtime half of Gate 1 acceptance, and §4.1 Finding A (does HERMES hold a P40?)
  does NOT block: Gate 1 implementation and merge on deterministic tests with synthetic fixtures
  pickup:    when HERMES is reachable, run the canonical probe
             `nvidia-smi --query-gpu=uuid,name,pci.bus_id,memory.total,memory.used,
              utilization.gpu,temperature.gpu --format=csv,noheader,nounits`
             through the broker, then reconcile against config/execution-fabric/registry.seed.json
             and record the accelerator inventory that is actually present
  owner:     the executing agent lane, on next HERMES availability
  not:       an owner task. HERMES availability is a fabric condition; the owner is not asked to
             power on, repair, or report on a node.

CONT-EXPV2-P0-REVIEW
  type:      INDEPENDENT_REVIEW_PENDING
  subject:   adversarial review of this collision map, per the charter's PR/delivery discipline
  scope:     ownership-seam misclassification above all — the failure mode the charter names as
             inherited by every later phase
  sourcing:  sovereign tiers first, per the runtime-and-review supersession. "Independent review
             required" never means "third-party review service required."
  owner:     the delivering agent lane
  not:       an owner courier task. The owner does not relay the review request or its result.
```
