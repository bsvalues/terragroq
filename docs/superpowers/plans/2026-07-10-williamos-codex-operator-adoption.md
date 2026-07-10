# WilliamOS Codex Operator Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt `WILLIAMOS-CODEX-OPERATOR-PLAYBOOK-001` as a native, static/read-only WilliamOS operating contract and prove `GOAL-WOS-CODEX-OPERATOR-001` through all 24 registered Work Orders.

**Architecture:** Extend the existing goal, loop, evidence, authority, decision, Academy, and shell patterns with one pure TypeScript operator registry. Deterministic resolver and continuation functions consume declared records and return decisions without performing actions. A read-only panel presents the active program on `/goal-console`; governance, Academy, Wiki, tests, and reports provide the durable proof chain.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest, existing WilliamOS static surface patterns.

## Global Constraints

- Risk ceiling is R1; R0/R1 merges are Codex-eligible after all gates pass.
- No command runner, shell bridge, scheduler, background service, autonomous runtime loop, production write, or dynamic ingestion.
- No auth, database, schema, data, environment, package, dependency, Vercel, deploy, release, tag, Hermes, MCP, worker, memory-write, vector, embedding, RAG, TerraFusion, PACS, or secret changes.
- `/goal`, `/loop`, resolver, evaluator, and console objects remain governance/read-model surfaces; they never execute repository or runtime work.
- The existing `.obsidian/` owner state remains untouched.

---

### Task 1: Canonical Contracts and Program Registry (WO-001 through WO-008)

**Files:**
- Create: `components/operator/codex-operator-registry.ts`
- Create: `tests/codex-operator-registry.test.ts`
- Modify: `docs/governance/codex-operator-playbook.md`
- Modify: `docs/governance/goal-registry.md`
- Modify: `docs/governance/loop-registry.md`
- Modify: `docs/governance/work-order-template.md`

**Interfaces:**
- Produces: `OperatorRiskClass`, `OperatorGoalContract`, `OperatorLoopContract`, `OperatorWorkOrderRecord`, `OperatorProgramRecord`, `CODEX_OPERATOR_GOAL`, `CODEX_OPERATOR_LOOP`, `CODEX_OPERATOR_WORK_ORDERS`, and `getCodexOperatorProgram()`.
- Records all 24 Work Orders with exact risk, dependencies, evidence paths, next transitions, and safety boundaries.

- [ ] Write tests asserting the canonical document ID, goal/loop identity, R1 ceiling, complete sequential WO range, dependency integrity, and no blocked runtime capability.
- [ ] Run `npm test -- --run tests/codex-operator-registry.test.ts` and confirm it fails because the module does not exist.
- [ ] Implement the typed registry and complete records for WO-001 through WO-024.
- [ ] Reconcile the four canonical governance documents to the new contract while preserving completed historical goals.
- [ ] Run the focused test and confirm it passes.

### Task 2: Resolver, Continuation Gate, Stop Packets, and Operator Doctrine (WO-009 through WO-014)

**Files:**
- Create: `components/operator/codex-operator-resolver.ts`
- Create: `tests/codex-operator-resolver.test.ts`
- Modify: `docs/governance/owner-decision-packet-template.md`
- Modify: `docs/governance/review-thread-monitor-protocol.md`
- Modify: `docs/governance/merge-gate-checklist.md`
- Modify: `docs/governance/production-verification-checklist.md`

**Interfaces:**
- Consumes: `OperatorProgramRecord` and `OperatorWorkOrderRecord` from Task 1.
- Produces: `resolveNextOperatorWorkOrder(program)`, `evaluateOperatorContinuation(input)`, typed reason codes `CONTINUE | REMEDIATE | COMPLETE | AUTHORITY_WALL`, and `buildOperatorStopPacket(input)`.

- [ ] Write table-driven tests for deterministic selection, unmet dependency, passed-WO continuation, in-scope remediation, goal completion, auth/schema/secret/PACS/runtime-activation walls, and concise resumable stop packets.
- [ ] Run `npm test -- --run tests/codex-operator-resolver.test.ts` and confirm it fails before implementation.
- [ ] Implement pure resolver/evaluator functions with no imports from server actions, filesystem, network, process execution, timers, or persistence.
- [ ] Align Git/worktree, review, merge, post-merge, and owner-decision doctrine so routine operator steps stay with Codex and true authority walls stay with the Primary.
- [ ] Run focused registry/resolver tests and confirm they pass.

### Task 3: Current Truth and Read-Only Operator Console (WO-015 through WO-017)

**Files:**
- Create: `components/operator/codex-operator-surface.ts`
- Create: `components/operator/codex-operator-panel.tsx`
- Create: `tests/codex-operator-surface.test.ts`
- Modify: `app/(shell)/goal-console/page.tsx`

**Interfaces:**
- Consumes: registry and resolver from Tasks 1-2.
- Produces: `CodexOperatorSurface`, `getCodexOperatorSurface()`, provenance labels, progress summary, current/next WO state, evidence/trace/memory links, stop-wall visibility, and static safety proof cards.

- [ ] Write tests asserting Primary-centered language, 24-WO progress, observed/declared/stale/unknown provenance, deterministic next action, Evidence/Trace/Memory links, and absence of execute/approve/run controls.
- [ ] Run `npm test -- --run tests/codex-operator-surface.test.ts` and confirm the missing surface fails.
- [ ] Implement the static surface and panel using existing cards, badges, links, and Lucide icons.
- [ ] Place the panel on `/goal-console` above the existing native `/goal` and `/loop` concepts without changing auth or existing goal actions.
- [ ] Run focused operator and goal-console tests.

### Task 4: Academy, Wiki, Command Alignment, and Adversarial Proof (WO-018 through WO-021)

**Files:**
- Create: `docs/academy/operator-training/codex-operator-goal-loop.md`
- Create: `docs/wiki/concepts/codex-operator.md`
- Create: `docs/reports/WO-CODEX-OPERATOR-001-021-adoption-evidence.md`
- Modify: `components/academy/academy-wiki-registry.ts`
- Modify: `docs/wiki/glossary.md`
- Create: `tests/codex-operator-adoption.test.ts`

**Interfaces:**
- Consumes the canonical registry and static surface.
- Adds Academy/Wiki records and cross-references without dynamic ingestion or runtime training.

- [ ] Add tests covering the required normal-continuation and authority-wall scenarios from WO-020, curriculum registration, glossary definitions, command consistency, and preservation of completed goals.
- [ ] Implement Academy/Wiki lessons and definitions for `/goal`, `/loop`, Work Order, Evidence, `/stop`, Codex Operator, and Primary authority.
- [ ] Add the migration/evidence matrix showing historical goals preserved and the new operator schema adopted prospectively.
- [ ] Run focused Academy, Wiki, operator, and adversarial tests.

### Task 5: Low-Risk Pilot, Safety Sweep, and Final Acceptance (WO-022 through WO-024)

**Files:**
- Create: `docs/reports/WO-CODEX-OPERATOR-022-low-risk-pilot.md`
- Create: `docs/reports/WO-CODEX-OPERATOR-023-safety-secret-sweep.md`
- Create: `docs/reports/WO-CODEX-OPERATOR-024-final-rollup.md`
- Modify: `components/operator/codex-operator-registry.ts`
- Modify: `tests/codex-operator-adoption.test.ts`

**Interfaces:**
- Closes each WO as evidenced only after its acceptance proof exists.
- Final report records branch, PR, checks, review threads, merge, `origin/main`, route verification, safety exclusions, and next-goal recommendation.

- [ ] Exercise the current adoption goal itself as the low-risk pilot: owner approved once; Codex owns implementation, validation, PR, review, merge, and verification.
- [ ] Scan the entire changed-file set for secrets and for blocked runtime capabilities; classify any finding as an authority wall.
- [ ] Record the final 24-WO evidence rollup and set the static program record to complete only when all proof gates are available.
- [ ] Run `git diff --check`, focused tests, `npm run lint`, `npm test -- --run`, and `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`.
- [ ] Stage only intended files, commit, push, open the PR, monitor checks/reviews, remediate narrow findings, merge when eligible, verify `origin/main`, and read-only verify `/api/health`, `/api/auth/readiness`, `/goal-console`, `/work-orders`, `/audit`, `/trace`, `/memory`, and `/academy`.

## Self-Review

- Spec coverage: WO-001 through WO-024 map to Tasks 1-5 with explicit deliverables and proof.
- Placeholder scan: no deferred implementation markers are present.
- Type consistency: registry feeds resolver; registry and resolver feed surface; surface and records feed docs/tests/reports.
- Safety: all executable behavior remains outside the product; only the human-operated Codex development workflow performs authorized repository actions.
