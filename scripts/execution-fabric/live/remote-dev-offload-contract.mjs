import crypto from "node:crypto"
import fs from "node:fs"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { validateDispatchEnvelope } from "../../multi-agent-operator/dispatch-envelope.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const SHA40 = /^[a-f0-9]{40}$/
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SECRET_LIKE = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b|\bAKIA[A-Z0-9]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s/]+@)/i
const EXECUTABLE_FIELD = /(?:^|_)(?:command|commands|cmd|shell|script|argv|args|executable|exec|spawn|cwd|stdin|environment|env|endpoint|credential|credentials|password|private_key|secret|token|api_key|connection_string|authorization)(?:$|_)/i

class ContractError extends Error {
  constructor(code, detail) { super(detail); this.code = code }
}

function block(code, detail) { throw new ContractError(code, detail) }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) block("TYPE_INVALID", `${label} must be an object`); return value }
function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort(); const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) block("UNKNOWN_OR_MISSING_FIELD", `${label} fields must match exactly`)
}
function text(value, label) { if (typeof value !== "string" || value.trim() === "" || value.trim() !== value) block("TEXT_INVALID", label); return value }
function hash(value) { return crypto.createHash("sha256").update(canonicalizeJcs(value)).digest("hex") }
function utcMs(value, label) { if (typeof value !== "string" || !UTC.test(value) || !Number.isFinite(Date.parse(value))) block("TIMESTAMP_INVALID", label); return Date.parse(value) }
function digest(value, label) { if (typeof value !== "string" || !SHA256.test(value)) block("HASH_INVALID", label); return value }
function exactValue(left, right, label) { if (canonicalizeJcs(left) !== canonicalizeJcs(right)) block("POLICY_MISMATCH", label) }

function rejectUnsafe(value, label = "input") {
  if (typeof value === "string") { if (SECRET_LIKE.test(value)) block("SECRET_LIKE_VALUE", label); return }
  if (Array.isArray(value)) { value.forEach((entry, index) => rejectUnsafe(entry, `${label}[${index}]`)); return }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (EXECUTABLE_FIELD.test(key.replace(/-/g, "_"))) block("EXECUTABLE_FIELD", `${label}.${key}`)
    rejectUnsafe(child, `${label}.${key}`)
  }
}

function validatePolicy(policy) {
  exactKeys(policy, ["schemaVersion", "workOrderId", "repository", "baseRef", "nodeId", "workspace", "branchPrefix", "reservedPaths", "resourceLimits", "operations", "transport", "canonicalAegisContract", "scheduler", "deniedActions", "deniedTargets"], "policy")
  if (policy.schemaVersion !== 1 || policy.workOrderId !== "WO-TF-REMOTE-DEV-OFFLOAD-001" || policy.repository !== "bsvalues/terrafusion_os_1.0" || policy.baseRef !== "refs/heads/main" || policy.nodeId !== "aegis" || policy.workspace !== "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001" || policy.branchPrefix !== "codex/wo-tf-remote-dev-offload-001-") block("POLICY_INVALID", "immutable identity changed")
  exactValue(policy.resourceLimits, { cpuThreads: 12, memoryBytes: 12884901888, scratchBytes: 85899345920, timeoutSeconds: 5400, maxAttempts: 3 }, "resourceLimits")
  exactValue(policy.operations, ["PROVE_PREFLIGHT", "CREATE_WORKSPACE", "APPLY_RESERVED_PATCH", "RESTORE_DOTNET", "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE", "COMMIT_RESERVED_PATHS", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE", "CLEAN_EXACT_WORKSPACE"], "operations")
  exactValue(policy.transport, { controller: "omen", relay: "hermes", worker: "aegis", hermesOnly: true }, "transport")
  exactValue(policy.canonicalAegisContract, { path: "config/execution-fabric/aegis-bounded-dispatch-contract.json", sha256: "bc9bc0d795462f930bb495e665c05efdd44d5c1809a63326ba81522cda8883d7", contractId: "resident-aegis-bounded-compute-v1", status: "NON_ACTIVE_CONTRACT", ciBuildTemplateId: "aegis.ci-build-test.v1" }, "canonicalAegisContract")
  const canonicalBytes = fs.readFileSync(new URL("../../../config/execution-fabric/aegis-bounded-dispatch-contract.json", import.meta.url))
  if (crypto.createHash("sha256").update(canonicalBytes).digest("hex") !== policy.canonicalAegisContract.sha256) block("CANONICAL_AEGIS_CONTRACT_MISMATCH", "contract bytes")
  const canonicalAegis = JSON.parse(canonicalBytes.toString("utf8"))
  if (canonicalAegis.contract_id !== policy.canonicalAegisContract.contractId || canonicalAegis.status !== policy.canonicalAegisContract.status || canonicalAegis.execution_authorized !== false || canonicalAegis.scheduler_activation_allowed !== false || !canonicalAegis.templates?.some((template) => template.template_id === policy.canonicalAegisContract.ciBuildTemplateId)) block("CANONICAL_AEGIS_CONTRACT_MISMATCH", "non-active CI_BUILD_TEST contract")
  exactValue(policy.scheduler, { state: "disabled", standingAegisAuthority: false }, "scheduler")
  if (!Array.isArray(policy.reservedPaths) || policy.reservedPaths.length !== 4 || !policy.reservedPaths.every((item) => typeof item === "string" && !item.startsWith("/") && !item.includes("..") && !item.includes("\\"))) block("POLICY_INVALID", "reservedPaths")
  if (!Array.isArray(policy.deniedActions) || !Array.isArray(policy.deniedTargets) || !policy.deniedTargets.includes("atlas")) block("POLICY_INVALID", "denial policy")
  return policy
}

function validateTrustedContext(trustedContext, { history = false } = {}) {
  const required = ["now", "seenRunIds", "dispatchEnvelope", "branch"]
  const allowed = new Set([...required, ...(history ? ["evidenceHistory"] : [])])
  object(trustedContext, "trustedContext")
  const unknown = Object.keys(trustedContext).find((key) => !allowed.has(key))
  const missing = required.find((key) => !Object.hasOwn(trustedContext, key))
  if (unknown || missing) block("UNKNOWN_OR_MISSING_FIELD", `trustedContext.${unknown ?? missing}`)
  const now = utcMs(trustedContext.now, "trustedContext.now")
  if (!Array.isArray(trustedContext.seenRunIds) || trustedContext.seenRunIds.some((runId) => typeof runId !== "string")) block("TRUSTED_CONTEXT_INVALID", "seenRunIds")
  let envelope
  try { envelope = validateDispatchEnvelope(trustedContext.dispatchEnvelope).envelope } catch (error) { block("DISPATCH_ENVELOPE_INVALID", String(error?.code ?? error)) }
  if (history && Object.hasOwn(trustedContext, "evidenceHistory") && !Array.isArray(trustedContext.evidenceHistory)) block("TRUSTED_CONTEXT_INVALID", "evidenceHistory")
  return { now, seenRunIds: trustedContext.seenRunIds, branch: text(trustedContext.branch, "trustedContext.branch"), envelope, history: trustedContext.evidenceHistory ?? [] }
}

function validatePacket(input, policy, trustedContext, { requireBindings = false } = {}) {
  const packet = structuredClone(input)
  rejectUnsafe(packet)
  exactKeys(packet, ["schemaVersion", "runId", "workOrderId", "repository", "baseRef", "baseSha", "branch", "nodeId", "workspace", "transport", "resourceLimits", "operations", "patch", "authority", "bindings"], "packet")
  if (packet.schemaVersion !== 1 || !GUID.test(packet.runId)) block("RUN_ID_INVALID", "runId")
  if (trustedContext.seenRunIds.includes(packet.runId)) block("RUN_ID_REUSED", packet.runId)
  if (packet.workOrderId !== policy.workOrderId || packet.repository !== policy.repository || packet.baseRef !== policy.baseRef || packet.nodeId !== policy.nodeId || packet.workspace !== policy.workspace || packet.branch !== trustedContext.branch || !packet.branch.startsWith(policy.branchPrefix) || !SHA40.test(packet.baseSha)) block("PACKET_IDENTITY_MISMATCH", "identity")
  exactKeys(packet.transport, ["controller", "relay", "worker"], "packet.transport")
  exactValue(packet.transport, { controller: "omen", relay: "hermes", worker: "aegis" }, "transport")
  exactValue(packet.resourceLimits, policy.resourceLimits, "resourceLimits")
  exactValue(packet.operations, policy.operations, "operations")
  exactKeys(packet.patch, ["sha256", "changedPaths"], "packet.patch")
  digest(packet.patch.sha256, "patch.sha256")
  if (!Array.isArray(packet.patch.changedPaths) || packet.patch.changedPaths.some((item) => typeof item !== "string") || new Set(packet.patch.changedPaths).size !== packet.patch.changedPaths.length) block("PATCH_INVALID", "changedPaths")
  exactValue([...packet.patch.changedPaths].sort(), [...policy.reservedPaths].sort(), "patch.changedPaths")
  exactKeys(packet.authority, ["grantId", "issuedAt", "expiresAt", "singleUse"], "packet.authority")
  const issued = utcMs(packet.authority.issuedAt, "authority.issuedAt"); const expires = utcMs(packet.authority.expiresAt, "authority.expiresAt")
  if (packet.authority.grantId !== "grant-remote-dev-offload-v1" || packet.authority.singleUse !== true || issued >= trustedContext.now || expires <= trustedContext.now || expires - issued > 14400000) block("AUTHORITY_INVALID", "grant")
  exactKeys(packet.bindings, ["policySha256", "packetSha256"], "packet.bindings")
  if (requireBindings) {
    const unsigned = structuredClone(packet); delete unsigned.bindings
    if (packet.bindings.policySha256 !== hash(policy) || packet.bindings.packetSha256 !== hash(unsigned)) block("BINDING_MISMATCH", "bindings")
  }
  const { envelope } = trustedContext
  if (envelope.workOrderId !== packet.workOrderId || envelope.repositories.length !== 1 || envelope.repositories[0] !== packet.repository || envelope.baseRefs[0].ref !== packet.baseRef || envelope.baseRefs[0].commitSha !== packet.baseSha || envelope.ownerOperationsAllowed !== false) block("DISPATCH_ENVELOPE_MISMATCH", "canonical envelope")
  return packet
}

function blocked(error) { return { status: "BLOCKED", reasons: [{ code: error instanceof ContractError ? error.code : "INTERNAL_ERROR", detail: String(error?.message ?? error) }] } }

export function bindRemoteDevPacket(packet, policy, trustedContext) {
  try {
    const validPolicy = validatePolicy(policy); const trusted = validateTrustedContext(trustedContext); const value = validatePacket(packet, validPolicy, trusted)
    const bound = structuredClone(value); const unsigned = structuredClone(bound); delete unsigned.bindings
    bound.bindings = { policySha256: hash(validPolicy), packetSha256: hash(unsigned) }
    return { status: "READY", packet: bound, policySha256: bound.bindings.policySha256 }
  } catch (error) { return blocked(error) }
}

function validateEvidence(evidence, packet, previous, expectedIndex) {
  rejectUnsafe(evidence, "evidence")
  exactKeys(evidence, ["schemaVersion", "runId", "operation", "attempt", "startedAt", "completedAt", "status", "exitCode", "nodeId", "workspace", "baseSha", "headSha", "outputSha256", "previousEvidenceSha256"], "evidence")
  if (evidence.schemaVersion !== 1 || evidence.runId !== packet.runId || evidence.operation !== packet.operations[expectedIndex] || !Number.isSafeInteger(evidence.attempt) || evidence.attempt < 1 || evidence.attempt > packet.resourceLimits.maxAttempts || !Number.isSafeInteger(evidence.exitCode) || evidence.nodeId !== packet.nodeId || evidence.workspace !== packet.workspace || evidence.baseSha !== packet.baseSha || !SHA40.test(evidence.headSha)) block("EVIDENCE_IDENTITY_MISMATCH", "evidence")
  const started = utcMs(evidence.startedAt, "evidence.startedAt"); const completed = utcMs(evidence.completedAt, "evidence.completedAt")
  if (completed <= started || completed - started > packet.resourceLimits.timeoutSeconds * 1000) block("EVIDENCE_TIME_INVALID", "evidence duration")
  digest(evidence.outputSha256, "evidence.outputSha256")
  if (previous === undefined) { if (evidence.previousEvidenceSha256 !== null) block("EVIDENCE_CHAIN_INVALID", "first evidence") } else if (evidence.previousEvidenceSha256 !== hash(previous) || started <= utcMs(previous.completedAt, "previous.completedAt")) block("EVIDENCE_CHAIN_INVALID", "previous evidence")
  if (evidence.status !== "SUCCEEDED" && !(evidence.operation === "TEST_DOTNET_INFORMATIONAL" && evidence.status === "OBSERVED_FAILURE") && !(evidence.operation === "PROVE_POST_MERGE" && evidence.status === "MERGE_ANCESTRY_PROVEN") && !(evidence.operation === "CLEAN_EXACT_WORKSPACE" && evidence.status === "CLEANUP_ABSENCE_PROVEN")) block("EVIDENCE_STATUS_INVALID", "status")
  if (evidence.status === "OBSERVED_FAILURE" ? evidence.exitCode === 0 : evidence.exitCode !== 0) block("EVIDENCE_EXIT_INVALID", "exitCode")
}

export function evaluateRemoteDevTransition(packet, evidence, trustedContext) {
  try {
    const policy = JSON.parse(fs.readFileSync(new URL("../../../config/execution-fabric/remote-dev-offload-v1.policy.json", import.meta.url), "utf8"))
    const trusted = validateTrustedContext(trustedContext, { history: true }); const valid = validatePacket(packet, policy, trusted, { requireBindings: true })
    const history = trusted.history
    if (history.length >= valid.operations.length) block("EVIDENCE_CHAIN_INVALID", "history is complete")
    history.forEach((entry, index) => validateEvidence(entry, valid, index === 0 ? undefined : history[index - 1], index))
    validateEvidence(evidence, valid, history.length === 0 ? undefined : history.at(-1), history.length)
    const all = [...history, evidence]
    if (all.length !== valid.operations.length) return { status: "RUNNING", evidenceSha256: hash(evidence) }
    if (all.at(-2).operation !== "PROVE_POST_MERGE" || all.at(-2).status !== "MERGE_ANCESTRY_PROVEN" || all.at(-1).operation !== "CLEAN_EXACT_WORKSPACE" || all.at(-1).status !== "CLEANUP_ABSENCE_PROVEN") block("CLEANUP_NOT_AUTHORIZED", "merge ancestry and exact cleanup evidence required")
    return { status: "COMPLETE", evidenceSha256: hash(evidence) }
  } catch (error) { return blocked(error) }
}

export function exitCodeForRemoteDevStatus(status) { return ["READY", "RUNNING", "COMPLETE"].includes(status) ? 0 : 2 }

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error("usage: remote-dev-offload-contract.mjs <policy.json> <packet.json>")
    const result = bindRemoteDevPacket(JSON.parse(fs.readFileSync(process.argv[3], "utf8")), JSON.parse(fs.readFileSync(process.argv[2], "utf8")), { now: new Date().toISOString(), seenRunIds: [], branch: process.env.REMOTE_DEV_BRANCH ?? "", dispatchEnvelope: JSON.parse(process.env.REMOTE_DEV_DISPATCH_ENVELOPE ?? "{}") })
    process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = exitCodeForRemoteDevStatus(result.status)
  } catch (error) { process.stdout.write(`${JSON.stringify(blocked(error))}\n`); process.exitCode = 2 }
}
