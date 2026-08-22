import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")
const programPath = path.join(root, "docs/governance/ai-evalops-harness-program.md")
const outputRoot = path.join(root, "docs/governance/ai-evalops-harness/work-orders")
const program = fs.readFileSync(programPath, "utf8")

const PROGRAM = "PROGRAM-WILLIAMOS-AI-EVALOPS-HARNESS-001"
const GOAL = "GOAL-WILLIAMOS-DURABLE-AI-EXECUTION-001"
const LOOP = "LOOP-WILLIAMOS-DURABLE-AI-EXECUTION-001"
const BASES = {
  terragroq: "13709f5789c25dea408283730a6bd35e8fd894ab",
  HermesLab: "0481061acf1f683688a00b09795647d0288c7232",
}

const rows = []
for (const line of program.split(/\r?\n/)) {
  const match = line.match(/^\| `WO-AEH-(\d{3})` \| ([^|]+?) \| ([^|]+?) \| (R[0-3]) \| ([^|]+?) \|$/)
  if (!match) continue
  const [, number, title, dependencyText, risk, deliverable] = match
  if (number === "000") continue
  const dependencies = dependencyText.trim() === "None"
    ? []
    : dependencyText.split(",").map((value) => `WO-AEH-${value.trim().padStart(3, "0")}`)
  rows.push({ id: `WO-AEH-${number}`, number, title: title.trim(), dependencies, risk, deliverable: deliverable.trim() })
}

if (rows.length !== 52) throw new Error(`expected 52 child Work Orders, found ${rows.length}`)

const byId = new Map(rows.map((row) => [row.id, row]))
for (const row of rows) {
  for (const dependency of row.dependencies) {
    if (dependency !== "WO-AEH-000" && !byId.has(dependency)) throw new Error(`${row.id} has missing dependency ${dependency}`)
  }
}

const successorMap = new Map(rows.map((row) => [row.id, []]))
for (const row of rows) {
  for (const dependency of row.dependencies) {
    if (successorMap.has(dependency)) successorMap.get(dependency).push(row.id)
  }
}

const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
const quoted = (value) => JSON.stringify(value)
const yamlList = (values, indent = 0) => values.length
  ? values.map((value) => `${" ".repeat(indent)}- ${quoted(value)}`).join("\n")
  : `${" ".repeat(indent)}[]`

const idIn = (id, values) => values.includes(Number(id.slice(-3)))

const SPECIFIC = {
  1: { checkouts: ["terragroq", "HermesLab"], environments: ["repository-governance", "OMEN-read-only", "Hermes-read-only", "Atlas-read-only", "AEGIS-read-only"], validation: ["refresh and record both checkout bases", "verify exact activation grant freshness and scope", "validate the complete DAG and registry consistency", "confirm issue #357 remains quarantined"] },
  7: { environments: ["Hermes-live-preauthorized-containment-boundary"], validation: ["authorized clients remain functional", "prohibited endpoints and remote sources are denied", "no state is deleted", "timed and console rollback succeeds"], rollback: "Restore the retained prior Compose, service, and network bindings; preserve all state; verify authorized access and denied remote access." },
  11: { environments: ["disposable-PostgreSQL-restore-fixtures"], validation: ["successful disposable restore", "corrupt partial and empty restores fail", "psql nonzero status fails the pipeline", "expected database schema table row and application-query invariants pass", "live backups remain untouched"], rollback: "Revert only owned backup-verification code and fixtures; do not mutate or prune live backup generations." },
  14: { environments: ["AEGIS-live-backup-boundary", "approved-offsite-provider", "disposable-offsite-recovery"], validation: ["encryption and immutable retention are enforced", "provider credentials are independently scoped", "replication freshness is under 24 hours", "disposable recovery from the offsite copy passes"], rollback: "Disable replication and revoke the scoped provider credential; preserve both local verified and remote immutable copies." },
  18: { validation: ["reconstruct settlement after coordinator process death", "reject tampered expired wrong-holder wrong-boot and stale-fence descriptors", "prove repeated settlement is idempotent"], rollback: "Revert owned code and use expand-contract schema reversal before writes; after writes preserve descriptors and forward-fix while reconciling attempts." },
  22: { environments: ["Hermes-live-preauthorized-worker-boundary"], validation: ["non-elevated install and uninstall", "concurrency equals one", "exact Ollama model allowlist enforcement", "arbitrary command rejection", "surviving descendant termination", "restart reconciliation"] },
  24: { environments: ["AEGIS-live-preauthorized-worker-boundary"], validation: ["non-root identity", "HASH_VERIFY is the only initially admitted operation", "cgroup CPU RAM scratch and time limits", "arbitrary command and undeclared egress denial", "install and uninstall proof"] },
  28: { environments: ["Atlas-disposable-control-database", "Hermes-live-bounded-test"], validation: ["authenticated request to durable job to Hermes pull and admission to generation", "signed receipt replicated off worker", "restart-safe settlement after worker and coordinator-process restart", "zero duplicate effects"], rollback: "Engage kill switch, stop admission, fence workers, reconcile ambiguous attempts, restore last-known-good service and model, and forward-fix durable state." },
  29: { validation: ["correlation continuity across program work-order job attempt lease fence node boot model authority and digests", "prompt completion secret and environment leakage negatives", "backward-compatible event schema fixtures"] },
  37: { environments: ["Hermes-live-capacity-test", "Atlas-live-protected-capacity-test", "AEGIS-live-capacity-test", "LAN-and-UPS-preauthorized-test"], validation: ["sustained thermal and throttle limits", "UPS graceful shutdown proof", "SMART and NVMe wear capture", "iperf latency loss and throughput", "backup and index contention", "safe abort thresholds and explicit RAM GPU LAN upgrade thresholds"], rollback: "Stop load and fault tests immediately, restore prior service and network state, and verify node and authoritative-state health." },
  39: { validation: ["72 continuous hours", "useful bounded canary workload", "controlled coordinator restart", "zero prohibited events", "complete terminal receipts and independent verdict"] },
  40: { validation: ["seven additional continuous days after the pilot", "at least 25 heterogeneous useful jobs", "at least 200 admitted Hermes requests", "at least 1000 settled attempts", "required coordinator restarts node reboots outages safe retry and offsite restore", "zero prohibited events", "100 percent terminal receipts and evidence replication", "exact SLO query windows recorded"], rollback: "Engage kill switch and deactivate the lane; preserve all evidence; issue an evidence-backed rejection and a narrowly scoped remediation WO.", nextBlock: "DEACTIVATED / CERTIFICATION_REJECTED / REMEDIATION_WO_REQUIRED; preserve all evidence and do not restart the soak implicitly." },
  42: { validation: ["verify exact owner grant subject scope freshness target and cutover window", "verify final canary kill switch and rollback readiness", "treat absent or denied grant as SOAK_PROVEN / NOT_PRODUCTION_AUTHORIZED"], rollback: "Revoke activation, stop new claims, fence and drain workers, restore the last-known-good release, and preserve the certification record.", nextBlock: "If the owner grant is absent or denied, complete as SOAK_PROVEN / NOT_PRODUCTION_AUTHORIZED; otherwise use the typed authority or validation blocker without mutation." },
  52: { environments: ["Atlas-live-preauthorized-coordinator-boundary"], validation: ["single leader", "process and service restart with automatic recovery within five minutes", "stale instance fenced", "durable attempts reconciled", "no OMEN dependency", "uninstall rollback proof"], rollback: "Stop and disable the coordinator, fence the old instance, reconcile durable attempts, restore the signed prior unit and configuration, and prove uninstall." },
}

function metadata(row) {
  const n = Number(row.number)
  let checkoutIds = ["terragroq"]
  let paths = ["terragroq:docs/governance/ai-evalops-harness-program.md"]
  let contracts = [`${row.id.toLowerCase()}-outcome`]
  let environments = ["repository-validation"]
  let protectedResources = ["historical-evidence", "issue-357-quarantine"]
  let rollback = "Revert only owned reviewed repository changes; preserve evidence and foreign or dirty state; rerun validation."
  let validation = ["focused unit and negative tests", "changed-path and secret scan", "git diff --check", "independent review"]

  if (idIn(row.id, [1, 3, 4, 5, 6, 41, 49])) {
    paths = ["terragroq:docs/governance", "terragroq:docs/reports/ai-evalops-harness"]
  }
  if (n === 2) {
    checkoutIds = ["terragroq", "HermesLab"]
    paths = ["terragroq:docs/governance", "HermesLab:README.md", "HermesLab:SERVICE-MAP.md"]
    environments = ["OMEN-read-only", "Hermes-read-only", "Atlas-read-only", "AEGIS-read-only"]
    validation = ["timestamped source-attributed inventory", "declared-versus-observed reconciliation", "no-mutation evidence", "independent review"]
  }
  if (idIn(row.id, [7, 11, 12, 13, 14, 43, 46, 47, 48])) {
    checkoutIds = ["HermesLab"]
    paths = n === 47
      ? ["HermesLab:atlas", "HermesLab:SERVICE-MAP.md"]
      : n === 7 || n === 46
        ? ["HermesLab:hermes", "HermesLab:SERVICE-MAP.md"]
        : ["HermesLab:aegis", "HermesLab:atlas", "HermesLab:hermes"]
    contracts.push("backup-or-host-safety-boundary")
    protectedResources.push("last-restore-verified-generation", "management-access", "authoritative-state")
    rollback = "Stop new activity; preserve the last restore-verified generation; restore the signed prior service, network, identity, or backup configuration; verify authorized access and evidence integrity."
  }
  if (idIn(row.id, [8, 9, 10, 15, 16, 17, 18, 19, 20, 21, 23, 26, 27, 29, 32, 38])) {
    paths = ["terragroq:scripts", "terragroq:components", "terragroq:lib", "terragroq:tests", "terragroq:config", "terragroq:docs"]
    environments = row.risk === "R2" ? ["repository-test", "disposable-integration"] : environments
  }
  if (idIn(row.id, [22, 24, 25, 28, 30, 31, 33, 34, 35, 36, 37, 39, 40, 42, 44, 45, 50, 51, 52])) {
    checkoutIds = ["terragroq", "HermesLab"]
    paths = ["terragroq:scripts", "terragroq:config", "terragroq:tests", "terragroq:docs", "HermesLab:hermes", "HermesLab:atlas", "HermesLab:aegis"]
    protectedResources.push("Atlas-authoritative-state", "Hermes-inference-availability", "AEGIS-backup-and-worker-boundary")
    rollback = "Disable admission; drain or fence active attempts; restore the exact last-known-good artifact, service unit, network policy, model, or configuration; reconcile ambiguous attempts; verify kill switch and retained evidence."
    validation.push("typed fail-closed and rollback verification")
  }
  if (idIn(row.id, [9, 15, 16, 17, 18, 19, 20, 28, 51, 52])) {
    contracts.push("durable-job-attempt-lease-fence")
    protectedResources.push("Atlas-control-database")
    rollback = "Use backward-compatible expand/contract changes, a verified pre-change backup, and forward repair after writes; fence old coordinators and reconcile attempts before restoring service."
    validation.push("migration, concurrency, idempotency, and restart tests")
  }
  if (idIn(row.id, [22, 23, 28, 32, 37, 45])) {
    contracts.push("Hermes-model-resource-envelope")
    environments = ["Hermes-bounded-test"]
    protectedResources.push("Hermes-GPU-headroom", "model-digest-and-allowlist")
    validation.push("TTFT, tokens-per-second, VRAM, thermal, OOM, and cancellation evidence")
  }
  if (idIn(row.id, [24, 25, 35, 37, 48, 50])) {
    contracts.push("AEGIS-non-root-contained-worker")
    environments = ["AEGIS-bounded-test"]
    protectedResources.push("AEGIS-root-boundary", "AEGIS-backup-mounts")
    validation.push("cgroup, process-tree, network, scratch, timeout, and cleanup tests")
  }
  if (idIn(row.id, [29, 30, 31, 44])) {
    contracts.push("telemetry-redaction-and-correlation")
    protectedResources.push("telemetry-payload-confidentiality", "alert-delivery-path")
    validation.push(n === 29 ? "payload leakage negatives and correlation continuity" : "payload leakage negatives and alert fire/recover/dead-man proof")
  }
  if (idIn(row.id, [33, 34, 35, 36, 39, 40, 41, 42])) {
    contracts.push("certification-safety-gates")
    environments = n === 41 ? ["read-only-assurance"] : ["preauthorized-live-certification"]
    protectedResources.push("certification-evidence", "owner-touch-counters")
    validation.push("zero prohibited events and complete immutable evidence")
  }

  const specific = SPECIFIC[n] ?? {}
  if (specific.checkouts) checkoutIds = specific.checkouts
  if (specific.environments) environments = specific.environments
  if (specific.validation) validation = specific.validation
  if (specific.rollback) rollback = specific.rollback
  if (!checkoutIds.includes("terragroq")) checkoutIds.push("terragroq")
  paths.push("terragroq:docs/reports/ai-evalops-harness")
  validation.push(`prove exact declared outcome: ${row.deliverable}`)

  const authorityScope = row.risk === "R3"
    ? "Exact live hosts, actions, protected resources, and time window; separate activation authority is mandatory."
    : row.risk === "R2"
      ? "Exact repository paths, contracts, test environments, and any non-live integration resources."
      : "Exact documentation, read-only inspection, or reversible planning scope."
  const authorityConditions = [
    "new-spend-account-or-provider",
    "credential-or-secret-use",
    "live-database-host-network-sudo-or-backup-mutation",
    "reboot-outage-or-fault-injection",
    "runtime-worker-scheduler-or-production-activation",
  ]

  return { checkoutIds, paths: [...new Set(paths)], contracts: [...new Set(contracts)], environments: [...new Set(environments)], protectedResources: [...new Set(protectedResources)], rollback, validation: [...new Set(validation)], authorityScope, authorityConditions, nextBlock: specific.nextBlock }
}

function renderEnvelope(row, meta, evidencePath) {
  return `schemaVersion: 1
artifactType: DRAFT_WORK_ORDER_PACKET
validationOnly: true
dispatchReadiness: BLOCKED_AUTHORITY_AND_RESERVATION
dispatchPerformed: false
authorityGranted: false
workOrderId: ${row.id}
programId: ${PROGRAM}
goalId: ${GOAL}
loopId: ${LOOP}
objective: ${quoted(row.deliverable)}
riskClass: ${row.risk}
repositories:
${yamlList(meta.checkoutIds, 2)}
checkoutBindings:
${meta.checkoutIds.map((id) => `  - id: ${id}\n    repository: bsvalues/terragroq\n    root: ${id === "terragroq" ? "C:\\Users\\bs\\terragroq-review" : "C:\\HermesLab"}\n    reviewAnchor: ${BASES[id]}`).join("\n")}
baseRefs:
${meta.checkoutIds.map((id) => `  - checkoutId: ${id}\n    sha: ${BASES[id]}\n    status: REVIEW_ANCHOR_REFRESH_REQUIRED_AT_ACTIVATION`).join("\n")}
dependencies:
${yamlList(row.dependencies, 2)}
fanInGate: ALL
laneId: ${row.id.toLowerCase()}-draft
teamRoles:
  coordinator: UNASSIGNED
  builder: UNASSIGNED
  reviewer: UNASSIGNED_INDEPENDENT
providerRequirements:
  - repository-read
  - repository-write-scoped-to-reservations
  - deterministic-validation
preferredProviders:
  - supported-hosted-codex-session
fallbackProviders: []
reservations:
  status: PRELIMINARY_AREA_BOUNDS_REFINEMENT_REQUIRED
  paths:
${yamlList(meta.paths, 4)}
  contracts:
${yamlList(meta.contracts, 4)}
  environments:
${yamlList(meta.environments, 4)}
  protectedResources:
${yamlList(meta.protectedResources, 4)}
allowedActions:
  - inspect-within-declared-scope
  - implement-only-after-authority-match
  - validate-and-record-evidence
forbiddenActions:
  - authority-minting-or-self-activation
  - secret-credential-or-protected-data-access-without-exact-authority
  - issue-357-retry-wrap-rename-or-reuse
  - general-shell-or-unbounded-command-runner
authorityGrantRefs: []
programActivationGrantRef: null
grantStatusEventRefs: []
authorityScopeRequired: ${quoted(meta.authorityScope)}
requiredOutputs:
  - ${quoted(row.deliverable)}
requiredValidation:
${yamlList(meta.validation, 2)}
reviewRequirements:
  - reviewer-differs-from-builder
  - all-blocking-findings-resolved
  - authority-and-scope-independently-verified
mergeMode: NONE_DRAFT_ONLY
retryBudget: 2
remediationBudget: 2
reroutePolicy: compatible-independent-provider-only
stopConditions:
  - missing-stale-mismatched-or-revoked-authority
  - reservation-collision-or-foreign-change
  - ambiguous-base-worker-lease-fence-input-or-outcome
  - duplicate-effect-or-evidence-gap
  - issue-357-reuse
evidenceTargets:
  - ${quoted(evidencePath)}
  - exact-base-head-and-reservation-record
  - authority-freshness-and-validation-results
  - rollback-or-reversal-verification
  - all-five-owner-touch-counter-evidence
  - maturity-state-before-and-after
  - explicit-non-proof-statement
  - independent-reviewer-identity-findings-and-closure
  - immutable-config-image-model-input-output-digests-as-applicable
  - live-worker-boot-claim-lease-fence-evidence-as-applicable
ownerDecisionConditions:
${yamlList(meta.authorityConditions, 2)}
ownerTouchBudget:
  operation: 0
  credential: 0
  diagnostic: 0
  routineDecision: 0
  routineContact: 0
ownerOperationsAllowed: false
communicationPolicy: FINAL_ONLY`
}

function renderPacket(row) {
  const meta = metadata(row)
  const successors = successorMap.get(row.id) ?? []
  const evidencePath = `terragroq:docs/reports/ai-evalops-harness/${row.id}-${slug(row.title)}.md`
  const dependencyText = row.dependencies.length ? row.dependencies.join(", ") : "none"
  const successorText = successors.length ? successors.join(", ") : "program terminal or certification transition"
  const executionNote = row.number === "001" ? `
## Execution result

WO-AEH-001 subsequently completed under the separately recorded, R1-limited
owner decision \`OWNER-DIRECTION-2026-08-11-AEH-EXECUTE-001\`. The authoritative
result is [the activation and authority-map evidence](../../../reports/ai-evalops-harness/WO-AEH-001-program-activation-registration-and-authority-map.md).
This generated packet and its draft envelope remain the pre-execution
specification; they are not rewritten into an executable v2 envelope and do not
authorize any successor or R2/R3 action.
` : ""
  const packet = `# ${row.id} — ${row.title}

Generated from [the canonical program](../../ai-evalops-harness-program.md). This is a standalone
structural draft. It is not dispatchable and creates no authority.
${executionNote}

\`\`\`text
WORK_ORDER: ${row.id}
TITLE: ${row.title}
PROGRAM: ${PROGRAM}
GOAL: ${GOAL}
LOOP: ${LOOP}
STATUS: DRAFT / NOT_ACTIVATED / BLOCKED_AUTHORITY / BLOCKED_RESERVATION
RISK_CLASS: ${row.risk}
DEPENDS_ON: ${dependencyText}
REPO: ${meta.checkoutIds.join(", ")}
BASE: ${meta.checkoutIds.map((id) => `${id}=${BASES[id]} (review anchor; refresh at activation)`).join("; ")}
BRANCH: not assigned; draft packet

PURPOSE: Deliver exactly the outcome named by ${row.id} without expanding authority or scope.
CURRENT_TRUTH: The program is not activated; dependencies, reservations, named roles, refreshed bases, and active authority must be verified before implementation.
OBJECTIVE: ${row.deliverable}
SCOPE: ${row.title}; only the repository-qualified areas, contracts, environments, and protected resources in this packet.
OUT_OF_SCOPE: Any unlisted outcome, production or protected-data mutation, general shell, authority creation, and issue #357 retry/wrap/rename/reuse.
ALLOWED_FILES_OR_AREAS: ${meta.paths.join("; ")}
FILES_ALLOWED: ${meta.paths.join("; ")}
FILES_FORBIDDEN: Paths outside reservations; secrets/auth caches; protected data; historical evidence mutation; rejected runtime paths.
ALLOWED_ACTIONS: Read/plan now; implement, validate, and record evidence only after exact dependency, reservation, and authority gates pass.
BLOCKED: Dispatch, mutation, commit, push, merge, activation, deployment, or live proof before authority matching.
BLOCKED_ACTIONS: Authority self-assertion; unreserved writes; secret inspection; owner courier work; duplicate effects; issue #357 reuse.
DELIVERABLES: ${row.deliverable}

AUTHORITY_LEVEL: ${row.risk} / exact-scope authority required
AUTHORITY_GRANT: none
AUTHORITY_DECISION_ID: not assigned
AUTHORITY_GRANT_REF: not assigned
AUTHORITY_STATUS_EVENT_REFS: none
AUTHORITY_SUBJECT: ${row.id}
AUTHORITY_SCOPE_REQUIRED: ${meta.authorityScope}
PROGRAM_ACTIVATION_GRANT_REF: not assigned
ACTIVE_AUTHORITY_EVIDENCE_REF: not assigned

OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_EVIDENCE_REF: pending execution evidence
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS

COMMIT_ALLOWED: false
PUSH_ALLOWED: false
TAG_ALLOWED: false
MERGE_AUTHORITY: none in draft; separate active authority required
MERGE_MODE: NONE_DRAFT_ONLY
RETRY_BUDGET: 2
REMEDIATION_BUDGET: 2
REROUTE_POLICY: compatible independent provider only; never route owner operations

ACCEPTANCE_CRITERIA: ${row.deliverable.replace(/[.;]+$/, "")}; every required validation below passes including fail-closed negatives; rollback is verified; evidence is immutable; and independent review has no blocking findings.
VALIDATION: ${meta.validation.join("; ")}
VALIDATION_REQUIRED: ${meta.validation.join("; ")}
REVIEW_REQUIREMENTS: Independent reviewer differs from builder, owns no builder reservation, validates scope/authority/risk/evidence, and closes all blocking findings.
ROLLBACK_OR_REVERSAL: ${meta.rollback}
STOP_CONDITIONS: Missing/stale/mismatched authority; dependency or reservation failure; secret/protected-data exposure; ambiguous identity/base/outcome; duplicate effect; evidence gap; issue #357 reuse.
EVIDENCE_PATH: ${evidencePath}

SUCCESS_TRANSITION: Record the verified result and release only dependency successors (${successorText}) to fresh dependency, reservation, and AUTHORITY_MATCH evaluation; success grants no authority.
VALIDATION_FAILURE_TRANSITION: Repair within the same coherent outcome and budget; otherwise create a narrow prerequisite/remediation WO and remain blocked.
REVIEW_TRANSITION: Return blocking findings to the original builder; revalidate and obtain independent re-review.
MERGE_TRANSITION: Merge only under a separate active grant with green checks, exact scope, clean state, no secrets, and no unresolved review.
POST_MERGE_TRANSITION: Verify exact merged main and applicable staging/live evidence; retain rollback point and recompute eligible successors.
NEXT_WO_TRANSITION: Recompute the dependency-cleared, reservation-compatible set; numbering does not serialize work.
NEXT_ON_PASS: ${successorText}
NEXT_ON_BLOCK: ${meta.nextBlock ?? "AUTHORITY_REQUIRED / DEPENDENCY_BLOCKED / RESERVATION_BLOCKED / VALIDATION_FAILED / POLICY_CHANGED with no unauthorized mutation."}
ESCALATION_RULES: Escalate only for new spend/provider, credentials, live DB/host/network/sudo/backup mutation, destructive retention, reboot/fault injection, runtime activation, production cutover, or risk acceptance.
\`\`\`

## Repository-qualified reservations

These are preliminary maximum area bounds, not executable write reservations. Before activation the
coordinator must replace them with exact collision-checked relative paths, named contracts,
environments, protected resources, and a single writer. Until then the packet remains
\`BLOCKED_RESERVATION\`.

Paths:
${meta.paths.map((value) => `- \`${value}\``).join("\n")}

Contracts:
${meta.contracts.map((value) => `- \`${value}\``).join("\n")}

Environments:
${meta.environments.map((value) => `- \`${value}\``).join("\n")}

Protected resources:
${meta.protectedResources.map((value) => `- \`${value}\``).join("\n")}

## Required evidence targets

- Exact evidence report, base/head, authority freshness, reservations, validation, and rollback proof
- All five owner-touch counters with verifier evidence
- Maturity state before and after, with an explicit non-proof statement
- Independent reviewer identity, findings, and closure
- Immutable configuration, image, model, input, and output digests where applicable
- Live worker, boot, claim, lease, and fence evidence where applicable

## Draft structural envelope

The repository's executable authority validator is expected to stop at the authority wall for this
draft. Structural validation is non-authorizing and must never be cited as dispatch readiness.

\`\`\`yaml
${renderEnvelope(row, meta, evidencePath)}
\`\`\`

## Safety state at creation

\`\`\`text
VALIDATION_ONLY: true
DISPATCH_READINESS: BLOCKED_AUTHORITY_AND_RESERVATION
AUTHORITY_GRANTED: false
DISPATCH_PERFORMED: false
RUNTIME_ACTIVATED: false
SCHEDULER_ACTIVE: false
HOST_OR_DATABASE_MUTATION_PERFORMED: false
PRODUCTION_DEPLOYMENT_PERFORMED: false
REJECTED_ISSUE_357_RETRIED: false
SECRETS_EXPOSED: false
MATURITY_PROMOTED: false
\`\`\`

## Explicit non-proof statement

Creating or structurally validating this packet does not prove the implementation, adapter,
recovery, soak, production authority, or owner-touch certification described by the Work Order.

## Standard result format

\`\`\`text
RESULT:
WORK_ORDER: ${row.id}
GOAL: ${GOAL}
BASE:
HEAD_AFTER:
FILES_CHANGED:
VALIDATION:
PR:
MERGE_STATE:
TRANSITION_TAKEN:
NEXT_WO:
ESCALATION_REQUIRED:
\`\`\`
`
  return { packet, envelope: renderEnvelope(row, meta, evidencePath), meta }
}

fs.mkdirSync(outputRoot, { recursive: true })
const generated = []
for (const row of rows) {
  const rendered = renderPacket(row)
  const baseName = `${row.id}-${slug(row.title)}`
  const markdownPath = path.join(outputRoot, `${baseName}.md`)
  const yamlPath = path.join(outputRoot, `${baseName}.draft-envelope.yaml`)
  fs.writeFileSync(markdownPath, rendered.packet, "utf8")
  fs.writeFileSync(yamlPath, `${rendered.envelope}\n`, "utf8")
  generated.push({ ...row, baseName, markdownPath: path.relative(root, markdownPath).replaceAll("\\", "/"), yamlPath: path.relative(root, yamlPath).replaceAll("\\", "/") })
}

const index = `# AI Eval-Ops Harness Work Order Packets

Generated by \`scripts/ai-evalops-harness/materialize-work-orders.mjs\` from the canonical program.

All packets are \`DRAFT / NOT_ACTIVATED / BLOCKED_AUTHORITY / BLOCKED_RESERVATION\`. Structural validation is
non-authorizing; no packet is dispatchable until its exact authority, refreshed bases, named roles,
and reservations are independently verified.

| Work Order | Risk | Dependencies | Packet | Envelope |
| --- | --- | --- | --- | --- |
${generated.map((row) => `| ${row.id} — ${row.title} | ${row.risk} | ${row.dependencies.join(", ") || "none"} | [Markdown](./${row.baseName}.md) | [YAML](./${row.baseName}.draft-envelope.yaml) |`).join("\n")}
`
fs.writeFileSync(path.join(outputRoot, "README.md"), index, "utf8")

process.stdout.write(`${JSON.stringify({ status: "MATERIALIZED_DRAFT_BLOCKED_AUTHORITY_AND_RESERVATION", packets: generated.length, files: generated.length * 2 + 1, outputRoot: path.relative(root, outputRoot).replaceAll("\\", "/") })}\n`)
