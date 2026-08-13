import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")
const programPath = path.join(root, "docs/governance/ai-evalops-harness-program.md")
const packetRoot = path.join(root, "docs/governance/ai-evalops-harness/work-orders")
const reportPath = path.join(packetRoot, "draft-structural-validation.json")
const program = fs.readFileSync(programPath, "utf8")

const expected = new Map()
for (const line of program.split(/\r?\n/)) {
  const match = line.match(/^\| `WO-AEH-(\d{3})` \| ([^|]+?) \| ([^|]+?) \| (R[0-3]) \|/)
  if (!match || match[1] === "000") continue
  const [, number, rawTitle, rawDependencies, risk] = match
  const dependencies = rawDependencies.trim() === "None"
    ? []
    : rawDependencies.split(",").map((value) => `WO-AEH-${value.trim().padStart(3, "0")}`)
  expected.set(`WO-AEH-${number}`, { title: rawTitle.trim(), dependencies, risk })
}

const canonicalFields = [
  "WORK_ORDER", "TITLE", "PROGRAM", "GOAL", "LOOP", "STATUS", "RISK_CLASS", "DEPENDS_ON",
  "REPO", "BASE", "BRANCH", "PURPOSE", "CURRENT_TRUTH", "OBJECTIVE", "SCOPE", "OUT_OF_SCOPE",
  "ALLOWED_FILES_OR_AREAS", "FILES_ALLOWED", "FILES_FORBIDDEN", "ALLOWED_ACTIONS", "BLOCKED",
  "BLOCKED_ACTIONS", "DELIVERABLES", "AUTHORITY_LEVEL", "AUTHORITY_GRANT", "AUTHORITY_DECISION_ID",
  "AUTHORITY_GRANT_REF", "AUTHORITY_STATUS_EVENT_REFS", "AUTHORITY_SUBJECT", "AUTHORITY_SCOPE_REQUIRED",
  "PROGRAM_ACTIVATION_GRANT_REF", "ACTIVE_AUTHORITY_EVIDENCE_REF", "OWNER_OPERATION_TOUCH_COUNT",
  "OWNER_CREDENTIAL_TOUCH_COUNT", "OWNER_DIAGNOSTIC_TOUCH_COUNT", "OWNER_ROUTINE_DECISION_COUNT",
  "OWNER_ROUTINE_CONTACT_COUNT", "OWNER_OPERATION_EVIDENCE_REF", "OWNER_OPERATION_CERTIFICATION_STATE",
  "COMMIT_ALLOWED", "PUSH_ALLOWED", "TAG_ALLOWED", "MERGE_AUTHORITY", "MERGE_MODE", "RETRY_BUDGET",
  "REMEDIATION_BUDGET", "REROUTE_POLICY", "ACCEPTANCE_CRITERIA", "VALIDATION", "VALIDATION_REQUIRED",
  "REVIEW_REQUIREMENTS", "ROLLBACK_OR_REVERSAL", "STOP_CONDITIONS", "EVIDENCE_PATH", "SUCCESS_TRANSITION",
  "VALIDATION_FAILURE_TRANSITION", "REVIEW_TRANSITION", "MERGE_TRANSITION", "POST_MERGE_TRANSITION",
  "NEXT_WO_TRANSITION", "NEXT_ON_PASS", "NEXT_ON_BLOCK", "ESCALATION_RULES",
]

const envelopeKeys = [
  "schemaVersion", "artifactType", "validationOnly", "dispatchReadiness", "dispatchPerformed",
  "authorityGranted", "workOrderId", "programId", "goalId", "loopId", "objective", "riskClass",
  "repositories", "checkoutBindings", "baseRefs", "dependencies", "fanInGate", "laneId", "teamRoles",
  "providerRequirements", "preferredProviders", "fallbackProviders", "reservations", "allowedActions",
  "forbiddenActions", "authorityGrantRefs", "programActivationGrantRef", "grantStatusEventRefs",
  "authorityScopeRequired", "requiredOutputs", "requiredValidation", "reviewRequirements", "mergeMode",
  "retryBudget", "remediationBudget", "reroutePolicy", "stopConditions", "evidenceTargets",
  "ownerDecisionConditions", "ownerTouchBudget", "ownerOperationsAllowed", "communicationPolicy",
]

const failures = []
const results = []
const markdownFiles = fs.readdirSync(packetRoot).filter((name) => /^WO-AEH-\d{3}-.+\.md$/.test(name)).sort()
const yamlFiles = fs.readdirSync(packetRoot).filter((name) => /^WO-AEH-\d{3}-.+\.draft-envelope\.yaml$/.test(name)).sort()

if (expected.size !== 52) failures.push(`expected program rows 52, found ${expected.size}`)
const exactExpectedIds = Array.from({ length: 52 }, (_, index) => `WO-AEH-${String(index + 1).padStart(3, "0")}`)
if (JSON.stringify([...expected.keys()].sort()) !== JSON.stringify(exactExpectedIds)) failures.push("canonical program child ID set is not exactly WO-AEH-001..052")
if (markdownFiles.length !== 52) failures.push(`expected Markdown packets 52, found ${markdownFiles.length}`)
if (yamlFiles.length !== 52) failures.push(`expected YAML envelopes 52, found ${yamlFiles.length}`)
const markdownIds = markdownFiles.map((name) => name.match(/^(WO-AEH-\d{3})-/)?.[1])
if (new Set(markdownIds).size !== markdownIds.length) failures.push("duplicate Markdown packet ID")
if (JSON.stringify([...markdownIds].sort()) !== JSON.stringify(exactExpectedIds)) failures.push("Markdown packet ID set is not exactly WO-AEH-001..052")

for (const markdownName of markdownFiles) {
  const id = markdownName.match(/^(WO-AEH-\d{3})-/)?.[1]
  const specification = expected.get(id)
  const markdownPath = path.join(packetRoot, markdownName)
  const body = fs.readFileSync(markdownPath, "utf8")
  const canonical = body.match(/```text\n([\s\S]*?)\n```/)?.[1] ?? ""
  const yaml = body.match(/```yaml\n([\s\S]*?)\n```/)?.[1] ?? ""
  const localFailures = []
  if (!specification) localFailures.push("packet ID missing from canonical program")
  for (const field of canonicalFields) {
    const matches = canonical.match(new RegExp(`^${field}:\\s*\\S.*$`, "gm")) ?? []
    if (matches.length !== 1) localFailures.push(`canonical field ${field} count is ${matches.length}, expected 1`)
  }
  for (const key of envelopeKeys) {
    const matches = yaml.match(new RegExp(`^${key}:.*$`, "gm")) ?? []
    if (matches.length !== 1) localFailures.push(`envelope key ${key} count is ${matches.length}, expected 1`)
  }
  if (specification) {
    if (!canonical.includes(`WORK_ORDER: ${id}`)) localFailures.push("canonical ID mismatch")
    if (!canonical.includes(`TITLE: ${specification.title}`)) localFailures.push("title mismatch")
    if (!canonical.includes(`RISK_CLASS: ${specification.risk}`)) localFailures.push("risk mismatch")
    const dependencyText = specification.dependencies.length ? specification.dependencies.join(", ") : "none"
    if (!canonical.includes(`DEPENDS_ON: ${dependencyText}`)) localFailures.push("dependency mismatch")
    if (!yaml.includes(`workOrderId: ${id}`)) localFailures.push("envelope ID mismatch")
    const dependencyBlock = yaml.match(/^dependencies:\n([\s\S]*?)^fanInGate:/m)?.[1] ?? ""
    const actualDependencies = [...dependencyBlock.matchAll(/^  - "(WO-AEH-\d{3})"$/gm)].map((match) => match[1])
    if (JSON.stringify(actualDependencies) !== JSON.stringify(specification.dependencies)) localFailures.push(`envelope dependency set mismatch: ${actualDependencies.join(",")}`)
  }
  const requiredSafety = [
    "STATUS: DRAFT / NOT_ACTIVATED / BLOCKED_AUTHORITY / BLOCKED_RESERVATION",
    "COMMIT_ALLOWED: false", "PUSH_ALLOWED: false", "TAG_ALLOWED: false",
    "OWNER_OPERATION_TOUCH_COUNT: 0", "OWNER_CREDENTIAL_TOUCH_COUNT: 0",
    "OWNER_DIAGNOSTIC_TOUCH_COUNT: 0", "OWNER_ROUTINE_DECISION_COUNT: 0",
    "OWNER_ROUTINE_CONTACT_COUNT: 0", "OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS",
    "issue #357 retry/wrap/rename/reuse",
  ]
  for (const value of requiredSafety) if (!body.includes(value)) localFailures.push(`missing safety invariant ${value}`)
  if (!yaml.includes("dispatchReadiness: BLOCKED_AUTHORITY_AND_RESERVATION")) localFailures.push("dispatch readiness is not blocked")
  if (!yaml.includes("schemaVersion: 1\nartifactType: DRAFT_WORK_ORDER_PACKET")) localFailures.push("draft envelope identity mismatch")
  if (!yaml.includes("authorityGrantRefs: []")) localFailures.push("draft authority refs are not empty")
  if (!yaml.includes("ownerOperationsAllowed: false")) localFailures.push("owner operations not forbidden")
  const yamlName = markdownName.replace(/\.md$/, ".draft-envelope.yaml")
  const standaloneYamlPath = path.join(packetRoot, yamlName)
  if (!fs.existsSync(standaloneYamlPath)) localFailures.push("standalone envelope missing")
  else if (fs.readFileSync(standaloneYamlPath, "utf8").trim() !== yaml.trim()) localFailures.push("embedded and standalone envelopes differ")
  const evidencePath = canonical.match(/^EVIDENCE_PATH:\s*(.+)$/m)?.[1]
  if (evidencePath && !yaml.includes(`- ${JSON.stringify(evidencePath.replace(/\/[^/]+\.md$/, ""))}`)) localFailures.push("evidence path is not covered by a declared reservation area")
  const digest = crypto.createHash("sha256").update(body, "utf8").digest("hex")
  const yamlDigest = fs.existsSync(standaloneYamlPath) ? crypto.createHash("sha256").update(fs.readFileSync(standaloneYamlPath), "utf8").digest("hex") : null
  results.push({ id, markdown: markdownName, envelope: yamlName, markdown_sha256: digest, envelope_sha256: yamlDigest, status: localFailures.length ? "FAIL" : "LEXICALLY_COMPLETE_DRAFT_BLOCKED_AUTHORITY_AND_RESERVATION", failures: localFailures })
  for (const failure of localFailures) failures.push(`${id}: ${failure}`)
}

// Kahn validation over the exact canonical dependency graph, including WO-AEH-000 as the root.
const nodes = new Set(["WO-AEH-000", ...expected.keys()])
const indegree = new Map([...nodes].map((id) => [id, 0]))
const adjacent = new Map([...nodes].map((id) => [id, []]))
let edges = 0
for (const [id, specification] of expected) {
  for (const dependency of specification.dependencies) {
    if (!nodes.has(dependency)) failures.push(`${id}: unresolved dependency ${dependency}`)
    else {
      indegree.set(id, indegree.get(id) + 1)
      adjacent.get(dependency).push(id)
      edges += 1
    }
  }
}
const queue = [...nodes].filter((id) => indegree.get(id) === 0)
let visited = 0
while (queue.length) {
  const id = queue.shift()
  visited += 1
  for (const successor of adjacent.get(id)) {
    indegree.set(successor, indegree.get(successor) - 1)
    if (indegree.get(successor) === 0) queue.push(successor)
  }
}
if (visited !== nodes.size) failures.push(`dependency graph cycle: visited ${visited}/${nodes.size}`)

const report = {
  schema: "ai-evalops-harness-lexical-draft-packet-validation/1",
  validation_only: true,
  dispatch_performed: false,
  authority_granted: false,
  dispatch_readiness: "BLOCKED_AUTHORITY_AND_RESERVATION",
  status: failures.length ? "FAIL" : "PASS_LEXICAL_DRAFT_COMPLETENESS_NON_AUTHORIZING",
  counts: { program_children: expected.size, markdown_packets: markdownFiles.length, yaml_envelopes: yamlFiles.length, graph_nodes: nodes.size, graph_edges: edges, graph_visited: visited },
  caveats: [
    "This checker validates lexical draft completeness and deterministic cross-file consistency; it is not a YAML schema validator and does not replace the executable authority validator.",
    "Every packet requires refreshed bases, exact collision-checked reservations, named roles, and active authority before dispatch.",
    "The two checkout IDs intentionally distinguish physical roots that currently share one repository origin.",
  ],
  failures,
  packets: results,
}
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
process.stdout.write(`${JSON.stringify({ status: report.status, failures: failures.length, ...report.counts, report: path.relative(root, reportPath).replaceAll("\\", "/") })}\n`)
if (failures.length) process.exitCode = 1
