import crypto from "node:crypto"
import fs from "node:fs"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { validateDispatchEnvelope } from "../../multi-agent-operator/dispatch-envelope.mjs"
import {
  createLedgerProviders,
  createTrustedProofProviders,
  trustedResidentIdentity,
} from "../bounded-dispatch/run-resident-aegis-hash-verify.mjs"

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
function byteDigest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex") }
function trustedTextBytes(bytes) { return Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n"), "utf8") }

function rejectUnsafe(value, label = "input") {
  if (typeof value === "string") { if (SECRET_LIKE.test(value)) block("SECRET_LIKE_VALUE", label); return }
  if (Array.isArray(value)) { value.forEach((entry, index) => rejectUnsafe(entry, `${label}[${index}]`)); return }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (EXECUTABLE_FIELD.test(key.replace(/-/g, "_"))) block("EXECUTABLE_FIELD", `${label}.${key}`)
    rejectUnsafe(child, `${label}.${key}`)
  }
}

const TRUST_ARTIFACT_PATHS = {
  contract: "config/execution-fabric/aegis-bounded-dispatch-contract.json",
  profiles: "config/execution-fabric/aegis-bounded-operation-profiles.json",
  authorityRegistry: "config/execution-fabric/aegis-bounded-dispatch-authority-registry.json",
  identity: "config/execution-fabric/aegis-resident-identity.json",
  forgePermission: "config/execution-fabric/agent-forge-aegis-bounded-dispatch-permission.json",
  trustedRunner: "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-hash-verify.mjs",
  proofWorker: "scripts/execution-fabric/live/aegis-remote-dev-worker.sh",
}
const HASH_EVIDENCE_PATHS = {
  scope: "config/execution-fabric/aegis-bounded-dispatch-authority-scopes/WO-EF-DISPATCH-AEGIS-001.json",
  claim: "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-claim.json",
  lease: "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-lease.json",
  release: "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-release.json",
  replay: "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-replay-evidence.json",
}

function parseArtifact(artifacts, name) {
  const bytes = artifacts?.[name]
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) block("TRUST_BASELINE_DRIFT", `${name} bytes are unavailable`)
  try { return JSON.parse(Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "")) } catch { block("TRUST_BASELINE_DRIFT", `${name} is not JSON`) }
}

function exactTrustKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) block("TRUST_BASELINE_DRIFT", `${label} fields differ`)
}

export function validateRemoteDevTrustBaseline(policy, scope, artifacts) {
  try {
    object(policy, "policy"); object(scope, "trust scope")
    exactTrustKeys(scope, ["schemaVersion", "scopeId", "workOrderId", "templateId", "selectedNodeId", "status", "executionAuthorized", "activationAllowed", "executionIdentity", "trustedMain", "authoritySeparation", "ownerAuthorizedException", "futureActivationRequirements", "scheduler"], "trust scope")
    exactTrustKeys(scope.executionIdentity, ["account", "privilege", "required", "provider"], "executionIdentity")
    exactTrustKeys(scope.trustedMain, ["ref", "checkoutState", "ancestryRequired", "proofProvider", "bindings"], "trustedMain")
    exactTrustKeys(scope.authoritySeparation, ["closedCiTemplate", "consumedHashProof"], "authoritySeparation")
    exactTrustKeys(scope.authoritySeparation.closedCiTemplate, ["contractId", "templateId", "profileId", "contractStatus", "profileStatus"], "closedCiTemplate")
    exactTrustKeys(scope.authoritySeparation.consumedHashProof, ["workOrderId", "authorityReference", "templateId", "claimId", "reuseAllowed", "mutationAllowed", "artifacts"], "consumedHashProof")
    exactTrustKeys(scope.ownerAuthorizedException, ["canonicalProfileEquivalent", "reason", "resources", "network"], "ownerAuthorizedException")
    exactTrustKeys(scope.ownerAuthorizedException.resources, ["cpuThreads", "memoryBytes", "scratchBytes", "timeoutSeconds", "maxAttempts"], "ownerAuthorizedException.resources")
    exactTrustKeys(scope.ownerAuthorizedException.network, ["defaultDeny", "atlasAllowed", "endpoints"], "ownerAuthorizedException.network")
    exactTrustKeys(scope.futureActivationRequirements, ["dedicatedExecutionIdentity", "trustedMainAncestry", "durableSingleUseClaim", "nodeExclusiveLease", "durableLeaseRelease", "replayRejectionEvidence", "ledgerProvider", "sameRunAndScopeBinding"], "futureActivationRequirements")
    exactTrustKeys(scope.scheduler, ["state", "standingAegisAuthority", "autonomousDispatch"], "scheduler")
    exactKeys(policy.trustBaseline, ["scopePath", "scopeSha256"], "policy.trustBaseline")
    if (policy.trustBaseline.scopePath !== "config/execution-fabric/remote-dev-offload-v1-inactive-scope.json") block("TRUST_SCOPE_DIGEST_MISMATCH", "scope path differs")
    const scopeBytes = artifacts?.trustScope
    if (!Buffer.isBuffer(scopeBytes) && !(scopeBytes instanceof Uint8Array)) block("TRUST_SCOPE_DIGEST_MISMATCH", "scope bytes are unavailable")
    if (policy.trustBaseline.scopeSha256 !== byteDigest(trustedTextBytes(scopeBytes))) block("TRUST_SCOPE_DIGEST_MISMATCH", "scope bytes differ")

    if (scope.workOrderId === "WO-EF-DISPATCH-AEGIS-001" || scope.authoritySeparation?.consumedHashProof?.reuseAllowed !== false || scope.authoritySeparation?.consumedHashProof?.mutationAllowed !== false) {
      block("HASH_SCOPE_REUSE_REJECTED", "the consumed HASH_VERIFY scope is immutable and unavailable")
    }
    if (scope.executionIdentity?.account !== "williamos-fabric" || scope.executionIdentity?.privilege !== "non-root-no-sudo"
      || scope.executionIdentity?.required !== true || scope.executionIdentity?.provider !== trustedResidentIdentity.name) block("EXECUTION_IDENTITY_MISMATCH", "dedicated AEGIS identity differs")

    const requirements = scope.futureActivationRequirements
    const requiredFuture = ["dedicatedExecutionIdentity", "trustedMainAncestry", "durableSingleUseClaim", "nodeExclusiveLease", "durableLeaseRelease", "replayRejectionEvidence", "sameRunAndScopeBinding"]
    if (!requirements || requiredFuture.some((field) => requirements[field] !== true) || requirements.ledgerProvider !== createLedgerProviders.name) block("FUTURE_ACTIVATION_EVIDENCE_INCOMPLETE", "claim, lease, release, replay, identity, and ancestry are mandatory")

    const expectedResources = { cpuThreads: 12, memoryBytes: 12884901888, scratchBytes: 85899345920, timeoutSeconds: 5400, maxAttempts: 3 }
    const expectedNetwork = {
      defaultDeny: true,
      atlasAllowed: false,
      endpoints: [
        { host: "github.com", port: 443, operations: ["git-fetch", "git-push"] },
        { host: "api.github.com", port: 443, operations: ["github-pr"] },
        { host: "api.nuget.org", port: 443, operations: ["dotnet-restore"] },
        { host: "globalcdn.nuget.org", port: 443, operations: ["dotnet-restore"] },
      ],
    }
    if (scope.ownerAuthorizedException?.canonicalProfileEquivalent !== false
      || scope.ownerAuthorizedException?.reason !== "ISSUE_734_DOTNET_RESTORE_TEST_BUILD_PROOF"
      || canonicalizeJcs(scope.ownerAuthorizedException?.resources) !== canonicalizeJcs(expectedResources)
      || canonicalizeJcs(scope.ownerAuthorizedException?.network) !== canonicalizeJcs(expectedNetwork)) {
      block("OWNER_EXCEPTION_INVALID", "the non-equivalent resource/network exception is ambiguous or widened")
    }

    if (scope.schemaVersion !== 1 || scope.scopeId !== "remote-dev-offload-v1-ci-build-inactive"
      || scope.workOrderId !== "WO-TF-REMOTE-DEV-OFFLOAD-001" || scope.templateId !== "aegis.ci-build-test.v1"
      || scope.selectedNodeId !== "aegis" || scope.status !== "OWNER_AUTHORIZED_EXCEPTION_INACTIVE"
      || scope.executionAuthorized !== false || scope.activationAllowed !== false
      || canonicalizeJcs(scope.scheduler) !== canonicalizeJcs({ state: "disabled", standingAegisAuthority: false, autonomousDispatch: false })) {
      block("TRUST_BASELINE_DRIFT", "inactive proof identity or posture differs")
    }
    if (scope.trustedMain?.ref !== "refs/heads/main" || scope.trustedMain?.checkoutState !== "EXACT_CLEAN_HEAD"
      || scope.trustedMain?.ancestryRequired !== true || scope.trustedMain?.proofProvider !== createTrustedProofProviders.name) {
      block("FUTURE_ACTIVATION_EVIDENCE_INCOMPLETE", "trusted-main ancestry proof is not mandatory")
    }

    const bindings = scope.trustedMain.bindings
    if (JSON.stringify(Object.keys(bindings ?? {}).sort()) !== JSON.stringify(Object.keys(TRUST_ARTIFACT_PATHS).sort())) block("TRUST_BASELINE_DRIFT", "trusted-main artifact set differs")
    for (const [name, artifactPath] of Object.entries(TRUST_ARTIFACT_PATHS)) {
      exactTrustKeys(bindings[name], ["path", "sha256"], `trustedMain.bindings.${name}`)
      if (bindings[name]?.path !== artifactPath || bindings[name]?.sha256 !== byteDigest(trustedTextBytes(artifacts?.[name] ?? Buffer.alloc(0)))) block("TRUST_BASELINE_DRIFT", `${name} digest differs`)
    }
    if (policy.canonicalAegisContract?.path !== TRUST_ARTIFACT_PATHS.contract || policy.canonicalAegisContract?.sha256 !== bindings.contract.sha256) block("TRUST_BASELINE_DRIFT", "policy contract binding differs")

    const canonicalContract = parseArtifact(artifacts, "contract")
    const profiles = parseArtifact(artifacts, "profiles")
    const authorityRegistry = parseArtifact(artifacts, "authorityRegistry")
    const identity = parseArtifact(artifacts, "identity")
    const forgePermission = parseArtifact(artifacts, "forgePermission")
    const ciProfile = profiles.profiles?.find((entry) => entry.profile_id === "williamos.standard-validation.v1")
    if (canonicalContract.contract_id !== "resident-aegis-bounded-compute-v1" || canonicalContract.status !== "NON_ACTIVE_CONTRACT"
      || canonicalContract.execution_authorized !== false || canonicalContract.required_execution_identity?.account !== "williamos-fabric"
      || !canonicalContract.templates?.some((entry) => entry.template_id === "aegis.ci-build-test.v1" && entry.network_scope === "none")
      || profiles.status !== "NON_ACTIVE_PROFILES" || ciProfile?.template_id !== "aegis.ci-build-test.v1" || ciProfile?.network_scope !== "none"
      || identity.node_id !== "aegis" || forgePermission.scheduler_activation_allowed !== false || forgePermission.autonomous_dispatch_allowed !== false) {
      block("TRUST_BASELINE_DRIFT", "canonical non-active CI contract semantics differ")
    }
    if (canonicalContract.resource_ceilings?.maximum_memory_bytes === expectedResources.memoryBytes
      || canonicalContract.workspace?.maximum_written_bytes === expectedResources.scratchBytes
      || canonicalContract.resource_ceilings?.maximum_runtime_ms === expectedResources.timeoutSeconds * 1000) {
      block("OWNER_EXCEPTION_INVALID", "proof exception is incorrectly represented as canonical profile equivalence")
    }

    const separation = scope.authoritySeparation
    if (canonicalizeJcs(separation.closedCiTemplate) !== canonicalizeJcs({ contractId: "resident-aegis-bounded-compute-v1", templateId: "aegis.ci-build-test.v1", profileId: "williamos.standard-validation.v1", contractStatus: "NON_ACTIVE_CONTRACT", profileStatus: "NON_ACTIVE_PROFILES" })) block("TRUST_BASELINE_DRIFT", "closed CI template binding differs")
    const consumed = separation.consumedHashProof
    if (consumed.workOrderId !== "WO-EF-DISPATCH-AEGIS-001" || consumed.authorityReference !== "issue-538-aegis-single-use-hash-001"
      || consumed.templateId !== "aegis.hash-verify.v1" || consumed.claimId !== "claim-dce2320e5b737d481de2bc69") block("HASH_SCOPE_REUSE_REJECTED", "consumed HASH_VERIFY identity differs")
    if (JSON.stringify(Object.keys(consumed.artifacts ?? {}).sort()) !== JSON.stringify(Object.keys(HASH_EVIDENCE_PATHS).sort())) block("HASH_SCOPE_REUSE_REJECTED", "consumed HASH_VERIFY artifact set differs")
    for (const [name, artifactPath] of Object.entries(HASH_EVIDENCE_PATHS)) {
      const artifactName = `hash${name[0].toUpperCase()}${name.slice(1)}`
      exactTrustKeys(consumed.artifacts[name], ["path", "sha256"], `consumedHashProof.artifacts.${name}`)
      if (consumed.artifacts[name]?.path !== artifactPath || consumed.artifacts[name]?.sha256 !== byteDigest(trustedTextBytes(artifacts?.[artifactName] ?? Buffer.alloc(0)))) block("HASH_SCOPE_REUSE_REJECTED", `consumed ${name} bytes differ`)
    }
    const hashScope = parseArtifact(artifacts, "hashScope")
    const hashClaim = parseArtifact(artifacts, "hashClaim")
    const hashLease = parseArtifact(artifacts, "hashLease")
    const hashRelease = parseArtifact(artifacts, "hashRelease")
    const hashReplay = parseArtifact(artifacts, "hashReplay")
    const authorityEntry = authorityRegistry.entries?.find((entry) => entry.reference === consumed.authorityReference)
    if (hashScope.work_order_id !== consumed.workOrderId || hashScope.reference !== consumed.authorityReference
      || hashClaim.claim_id !== consumed.claimId || hashClaim.authority_reference !== consumed.authorityReference
      || hashLease.claim_id !== consumed.claimId || hashRelease.claim_id !== consumed.claimId || hashRelease.lease_id !== hashLease.lease_id
      || hashReplay.claim_id !== consumed.claimId || hashReplay.rejection_code !== "REQUEST_ALREADY_CONSUMED"
      || authorityEntry?.work_order_id !== consumed.workOrderId || authorityEntry?.scope_path !== HASH_EVIDENCE_PATHS.scope) {
      block("HASH_SCOPE_REUSE_REJECTED", "consumed HASH_VERIFY evidence chain differs")
    }

    return { status: "INACTIVE_TRUSTED_MAIN_READY", executionAuthorized: false, workOrderId: scope.workOrderId, executionIdentity: scope.executionIdentity.account }
  } catch (error) { return blocked(error) }
}

function readTrustBaseline(policy) {
  const scopeBytes = fs.readFileSync(new URL(`../../../${policy.trustBaseline.scopePath}`, import.meta.url))
  const scope = JSON.parse(scopeBytes.toString("utf8"))
  const artifacts = { trustScope: scopeBytes }
  for (const [name, artifactPath] of Object.entries(TRUST_ARTIFACT_PATHS)) artifacts[name] = fs.readFileSync(new URL(`../../../${artifactPath}`, import.meta.url))
  for (const [name, artifactPath] of Object.entries(HASH_EVIDENCE_PATHS)) artifacts[`hash${name[0].toUpperCase()}${name.slice(1)}`] = fs.readFileSync(new URL(`../../../${artifactPath}`, import.meta.url))
  return validateRemoteDevTrustBaseline(policy, scope, artifacts)
}

function validatePolicy(policy) {
  exactKeys(policy, ["schemaVersion", "workOrderId", "repository", "baseRef", "nodeId", "workspace", "branchPrefix", "patchGeneration", "reservedPaths", "resourceLimits", "operations", "transport", "canonicalAegisContract", "trustBaseline", "scheduler", "deniedActions", "deniedTargets"], "policy")
  if (policy.schemaVersion !== 1 || policy.workOrderId !== "WO-TF-REMOTE-DEV-OFFLOAD-001" || policy.repository !== "bsvalues/terrafusion_os_1.0" || policy.baseRef !== "refs/heads/main" || policy.nodeId !== "aegis" || policy.workspace !== "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001" || policy.branchPrefix !== "codex/wo-tf-remote-dev-offload-001-" || policy.patchGeneration !== 1) block("POLICY_INVALID", "immutable identity changed")
  exactValue(policy.resourceLimits, { cpuThreads: 12, memoryBytes: 12884901888, scratchBytes: 85899345920, timeoutSeconds: 5400, maxAttempts: 3 }, "resourceLimits")
  exactValue(policy.operations, ["PROVE_PREFLIGHT", "CREATE_WORKSPACE", "APPLY_RESERVED_PATCH", "RESTORE_DOTNET", "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE", "COMMIT_RESERVED_PATHS", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE", "CLEAN_EXACT_WORKSPACE"], "operations")
  exactValue(policy.transport, { controller: "omen", relay: "hermes", worker: "aegis", hermesOnly: true }, "transport")
  exactValue(policy.canonicalAegisContract, { path: "config/execution-fabric/aegis-bounded-dispatch-contract.json", sha256: "18299f57bb86e9cd4902a98b93f56c702aa51b44e5d9e085dddac247f24b8d22", contractId: "resident-aegis-bounded-compute-v1", status: "NON_ACTIVE_CONTRACT", ciBuildTemplateId: "aegis.ci-build-test.v1" }, "canonicalAegisContract")
  const canonicalBytes = fs.readFileSync(new URL("../../../config/execution-fabric/aegis-bounded-dispatch-contract.json", import.meta.url))
  if (crypto.createHash("sha256").update(canonicalBytes).digest("hex") !== policy.canonicalAegisContract.sha256) block("CANONICAL_AEGIS_CONTRACT_MISMATCH", "contract bytes")
  const canonicalAegis = JSON.parse(canonicalBytes.toString("utf8"))
  if (canonicalAegis.contract_id !== policy.canonicalAegisContract.contractId || canonicalAegis.status !== policy.canonicalAegisContract.status || canonicalAegis.execution_authorized !== false || canonicalAegis.scheduler_activation_allowed !== false || !canonicalAegis.templates?.some((template) => template.template_id === policy.canonicalAegisContract.ciBuildTemplateId)) block("CANONICAL_AEGIS_CONTRACT_MISMATCH", "non-active CI_BUILD_TEST contract")
  const trust = readTrustBaseline(policy)
  if (trust.status !== "INACTIVE_TRUSTED_MAIN_READY") block(trust.reasons?.[0]?.code ?? "TRUST_BASELINE_DRIFT", trust.reasons?.[0]?.detail ?? "trust baseline failed")
  exactValue(policy.scheduler, { state: "disabled", standingAegisAuthority: false }, "scheduler")
  exactValue(policy.reservedPaths, [".github/workflows/dotnet-test.yml", ".github/workflows/terrafusion-ci.yml", "tests/ci-terrafusion-unit-informational.test.ts", "docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md"], "reservedPaths")
  exactValue(policy.deniedActions, ["ARBITRARY_SHELL", "ATLAS_ACCESS", "CREDENTIAL_ACCESS", "OWNER_CONTACT", "PERSISTENT_SERVICE", "RUNTIME_ACTIVATION"], "deniedActions")
  exactValue(policy.deniedTargets, ["atlas", "omen-workspace", "hermes-workspace", "production", "protected-data"], "deniedTargets")
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
  exactKeys(packet.patch, ["sha256", "generation", "changedPaths"], "packet.patch")
  digest(packet.patch.sha256, "patch.sha256")
  if (!Number.isSafeInteger(packet.patch.generation) || packet.patch.generation !== policy.patchGeneration) block("PATCH_INVALID", "generation")
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
  const approvedEnvelope = {
    schemaVersion: 2, programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001", goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001", loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001", workOrderId: packet.workOrderId,
    objective: "Deliver the bounded TerraFusion informational CI proof.", riskClass: "R1", repositories: [packet.repository], baseRefs: [{ repository: packet.repository, ref: packet.baseRef, commitSha: packet.baseSha }], dependencies: [], fanInGate: "ALL", laneId: "LANE-TF-REMOTE-DEV-OFFLOAD",
    teamRoles: { coordinator: "omen-controller", builder: "aegis-worker", reviewer: "independent-assurance" }, providerRequirements: ["hermes-relay"], preferredProviders: ["hermes-relay"], fallbackProviders: [],
    reservations: { paths: policy.reservedPaths.map((path) => ({ repository: packet.repository, path })), contracts: ["remote-dev-offload-v1"], environments: ["aegis-proof-workspace"] },
    allowedActions: ["READ_REPOSITORY", "WRITE_RESERVED_PATHS", "RUN_VALIDATION", "COMMIT_OWN_CHANGES", "PUSH_OWN_BRANCH", "OPEN_DRAFT_PR", "READ_CI_AND_REVIEW", "MERGE_ELIGIBLE_PR", "VERIFY_POST_MERGE"],
    forbiddenActions: ["OWNER_CONTACT", "CREDENTIAL_ACCESS", "RUNTIME_ACTIVATION", "PRODUCTION_WRITE", "BRANCH_PROTECTION_BYPASS", "DESTRUCTIVE_GIT"], authorityGrantRefs: ["grant-remote-dev-offload-v1"], programActivationGrantRef: "grant-remote-dev-offload-v1", grantStatusEventRefs: ["grant-status-remote-dev-offload-v1"],
    requiredOutputs: ["policy-bound-packet", "hash-chained-evidence"], requiredValidation: ["focused-vitest"], reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 }, mergeMode: "ASSURANCE_GATED", retryBudget: { maxAttempts: 3, backoffSeconds: 10 }, remediationBudget: { maxCycles: 2 }, reroutePolicy: "NONE", stopConditions: ["authority-wall", "resource-limit"], evidenceTargets: ["branch", "commit", "merge", "cleanup"], ownerDecisionConditions: [], ownerOperationsAllowed: false,
  }
  if (canonicalizeJcs(envelope) !== canonicalizeJcs(validateDispatchEnvelope(approvedEnvelope).envelope)) block("DISPATCH_ENVELOPE_MISMATCH", "canonical envelope")
  return packet
}

function blocked(error) { return { status: "BLOCKED", reasons: [{ code: error instanceof ContractError ? error.code : "INTERNAL_ERROR", detail: String(error?.message ?? error) }] } }

export function bindRemoteDevPacket(packet, policy, trustedContext) {
  try {
    const validPolicy = validatePolicy(policy); const trusted = validateTrustedContext(trustedContext); const value = validatePacket(packet, validPolicy, trusted)
    const bound = structuredClone(value); const unsigned = structuredClone(bound); delete unsigned.bindings
    bound.bindings = { policySha256: hash(validPolicy), packetSha256: hash(unsigned) }
    return { status: "INACTIVE_TRUSTED_MAIN_READY", executionAuthorized: false, packet: bound, policySha256: bound.bindings.policySha256 }
  } catch (error) { return blocked(error) }
}

function validateEvidence(evidence, packet, previous, expectedIndex, trustedNow) {
  rejectUnsafe(evidence, "evidence")
  exactKeys(evidence, ["schemaVersion", "runId", "operation", "attempt", "startedAt", "completedAt", "status", "exitCode", "nodeId", "workspace", "branch", "baseSha", "headSha", "outputSha256", "policySha256", "packetSha256", "patchSha256", "patchGeneration", "previousEvidenceSha256"], "evidence")
  if (evidence.schemaVersion !== 1 || evidence.runId !== packet.runId || evidence.operation !== packet.operations[expectedIndex] || !Number.isSafeInteger(evidence.attempt) || evidence.attempt < 1 || evidence.attempt > packet.resourceLimits.maxAttempts || !Number.isSafeInteger(evidence.exitCode) || evidence.nodeId !== packet.nodeId || evidence.workspace !== packet.workspace || evidence.branch !== packet.branch || evidence.baseSha !== packet.baseSha || evidence.policySha256 !== packet.bindings.policySha256 || evidence.packetSha256 !== packet.bindings.packetSha256 || evidence.patchSha256 !== packet.patch.sha256 || evidence.patchGeneration !== packet.patch.generation || !SHA40.test(evidence.headSha)) block("EVIDENCE_IDENTITY_MISMATCH", "evidence")
  const started = utcMs(evidence.startedAt, "evidence.startedAt"); const completed = utcMs(evidence.completedAt, "evidence.completedAt")
  const issued = utcMs(packet.authority.issuedAt, "authority.issuedAt"); const expires = utcMs(packet.authority.expiresAt, "authority.expiresAt")
  if (started < issued || completed <= started || completed > Math.min(trustedNow, expires) || completed - started > packet.resourceLimits.timeoutSeconds * 1000) block("EVIDENCE_TIME_INVALID", "evidence duration")
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
    history.forEach((entry, index) => validateEvidence(entry, valid, index === 0 ? undefined : history[index - 1], index, trusted.now))
    validateEvidence(evidence, valid, history.length === 0 ? undefined : history.at(-1), history.length, trusted.now)
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
