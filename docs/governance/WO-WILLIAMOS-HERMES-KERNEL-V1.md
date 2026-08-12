# WO-WILLIAMOS-HERMES-KERNEL-V1 — adopt Nous Hermes Agent as the governed worker kernel

Program **T2** of the Vercel-retirement / sovereign-AI architecture (#638). Adopt Nous Research's
**Hermes Agent** as the governed agent/worker kernel *beneath* the WilliamOS control plane —
without surrendering authority, and without routing bounded RAG/inference through it (that is T1's
raw seam). Builds on the integration review (`WO-638-hermes-agent-integration-review.md`) and the
Pilot 0 containment evidence.

Authority note: this WO SCOPES the program. Standing up a live Hermes kernel on any node, wiring
providers, or running the acceptance task are separate authorized steps, each gated.

## 1. Responsibility split — WilliamOS vs Nous Hermes Agent

| Concern | Owner |
|---|---|
| Authority (who may create/expand an outcome), evidence-hash pinning, placement-by-authority, owner-touch gates, GitHub acceptance, audit | **WilliamOS control plane** (above) |
| Agent loop, tool dispatch, subagents (`delegate_task`), durable task board (kanban), memory, skills, scheduling, provider transport | **Nous Hermes Agent** (kernel) |
| Command policy (DENY/ASK/ALLOW) at `pre_tool_call` | **CAPG** (binding, in-kernel) |
| Deterministic file edit/apply/verify with rollback | **SEA** (replaces Hermes free-form editing) |
| Network / filesystem / process isolation | **OS containment** (external, authoritative) |

Rule (carried from [[opensource-agent-runtime-eval]]): worker scheduling *inside* an already-
authorized envelope is fine; a runtime may never create a new product outcome, expand its work
order, or self-select/silently switch providers.

## 2. Hermes persistence — what lives where, and how it is governed

- `~/.hermes/config.yaml` — provider/model/approval config. **Owned by WilliamOS** (set via
  `hermes config set`, versioned/pinned; never carries live provider creds unless authorized).
- `~/.hermes/kanban.db` — SQLite durable task board. Execution-layer state; WilliamOS *creates*
  tasks (authority above), Hermes *executes* them. Governed location + backed up.
- Sessions — per-run conversation state.
- `MEMORY.md` / `USER.md` + project `AGENTS.md`/`CLAUDE.md`/`SOUL.md` — agent memory/context.
- **Skills** — ⚠️ "execute arbitrary Python at import time." Treated as a **code-execution trust
  surface**: skills are review-gated (owner review before install), stored in a governed path,
  never auto-adopted.

Decision: the kernel's writable state (`~/.hermes`) lives on the node running the kernel, under a
governed directory that is inventoried + backed up; skills/memory changes are evidence-logged.

## 3. CAPG integration — `pre_tool_call` remains binding

Hermes exposes a `pre_tool_call` plugin hook in the dispatch path (before the registry dispatches
to a handler). CAPG registers there as the DENY/ASK/ALLOW gate, fail-closed on unrecognized
commands. **But** (SECURITY doc + Pilot 0): in-process hooks are *not* a boundary — Hermes' native
approval gate misclassified exfil/lateral as ALLOW. So CAPG is defense-in-depth; the OS boundary
(§5) is the control. Acceptance: CAPG denial actually blocks the tool call; a seeded exfil/lateral
command is denied by CAPG *and* blocked by containment.

## 4. SEA integration — native free-form editing disabled/replaced

Pilot 0 proved Hermes' free-form agentic editing fails on small local models (literal diff markers
→ SyntaxError; raw tool-call JSON as text; hallucinated paths). Therefore: **disable the native
file-edit toolset** and route edits through SEA (model emits structured JSON → deterministic
validate `old_text`-exactly-once → apply atomically → verify → bounded repair → fail-closed
rollback). SEA is exposed as the sanctioned edit tool / an out-of-loop adapter. Acceptance: a
worker edit lands only via SEA; an invalid edit rolls back with no partial write.

## 5. Containment — network + filesystem + process

Authoritative boundary (Pilot 0 doctrine): **host-enforced deny-egress**, not the agent's own
guards. Requirements:
- **Network:** external egress DENIED by default; only an explicitly-authorized local inference
  pinhole open (e.g. the Ollama endpoint). Proven by outbound negative tests.
- **Filesystem:** no host mounts; workspace-only writes; no credentials/secrets/Atlas keys/county
  data in reach.
- **Process:** run under a disposable/contained runtime (the proven apply/revert cage, or
  OpenShell/container), not directly on an operational host.

## 6. Provider policy — local defaults, external by explicit authority only

Acceptance = **`NO_UNAUTHORIZED_EXTERNAL_EGRESS`** (from the integration review, binding):
- primary `fallback_providers`: explicitly empty (no silent switch);
- **auxiliary** providers (vision, compression, web extraction — incl. Hermes' internal OpenRouter
  retry): explicitly local/pinned or disabled;
- no ambient external provider credentials present unless explicitly authorized for a data-class;
- network containment (§5) is the enforcement — config is policy, containment is enforcement.

## 7. Node placement (roles)

- **OMEN** (RTX 5060 8 GB): strongest single-GPU local inference (fast tier).
- **HERMES** (RTX 3050 6 GB): reasoning-tier local inference; current Ollama host.
- **AEGIS** (K2200 4 GB, 28-core): CPU-side verification, builds, tests, deterministic tools; the
  dev worker. Weak GPU → aux only.
- **ATLAS** (K2200 4 GB): DB/state/retrieval; embedding inference candidate (small model) —
  **pending the R1B bake-off**, not fixed here.
- The Hermes kernel + kanban run on a designated worker node (not the OMEN cockpit); WilliamOS
  placement decides. Cross-node = multiple kernels + WilliamOS placement, not kanban (single-host).

## 8. Hybrid escalation contract

A request escalates from local to an external provider only when **all** hold, with a receipt:
```
sensitivity : data class permits this provider (no county/PACS/protected data externally)
capability  : local fabric cannot meet the quality/latency policy for this task
cost        : within authorized budget (no paid overage)
latency     : policy allows the external round-trip
authority   : an active WilliamOS grant authorizes external use for this outcome
receipts    : provider + model + data-class + purpose + timestamp recorded to audit
```
Default is local ([[williamos-provider-doctrine]] HYBRID_SOVEREIGN). Escalation is never
self-selected by the kernel.

## 9. Failure / recovery

- **No silent fallback** (RULE-0005): a provider/model failure surfaces explicitly; the kernel does
  not silently switch.
- **No silent external egress:** containment denies it; attempts are logged.
- **Deterministic rollback:** SEA restores the workspace on any verify failure; the cage
  apply/revert pipeline restores the node; kanban task runs are append-only + resumable.

## 10. Acceptance proof

One real, bounded task carried end-to-end:
```
WilliamOS (authority + work order + evidence target)
   → Hermes Agent kernel (kanban task, worker + independent-review subagents)
      → CAPG (pre_tool_call DENY/ASK/ALLOW, fail-closed)
      → SEA (structured edit → verify → rollback-on-failure)
   → contained runtime (deny-egress proven; local inference only)
   → GitHub (branch/commit/PR + evidence + audit)
```
Pass requires: zero owner tool operation; a seeded review defect found + remediated; a seeded
forbidden command denied by CAPG and blocked by containment; no external egress; deterministic
rollback demonstrated; final GitHub PR + evidence + audit trail.

## Out of scope / held

- R1B embedding model + dimension (bake-off first; no pgvector freeze).
- `DATABASE_URL` cutover; no canonical data into ATLAS until vector-space + Neon classification.
- Any external-provider live use (T4) beyond a governed, authorized proof.
