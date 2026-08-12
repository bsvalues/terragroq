import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import {
  createLedgerProviders,
  createTrustedProofProviders,
  trustedResidentIdentity,
} from "../bounded-dispatch/run-resident-aegis-hash-verify.mjs"
import { proveResidentAegisNetworkBoundary } from "./aegis-resident-network-boundary.mjs"
import { validateRemoteDevTrustBaseline } from "./remote-dev-offload-contract.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const SHA40 = /^[a-f0-9]{40}$/
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

class ActivationError extends Error {
  constructor(code, detail) { super(detail); this.code = code }
}

function fail(code, detail) { throw new ActivationError(code, detail) }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("ACTIVATION_SCHEMA_INVALID", `${label} must be an object`); return value }
function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) fail("ACTIVATION_SCHEMA_INVALID", `${label} fields differ`)
}
function same(left, right) { return canonicalizeJcs(left) === canonicalizeJcs(right) }
function normalizedDigest(bytes) {
  const trusted = Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n"), "utf8")
  return crypto.createHash("sha256").update(trusted).digest("hex")
}
function timestamp(value, label) {
  if (typeof value !== "string" || !UTC.test(value) || !Number.isFinite(Date.parse(value))) fail("ACTIVATION_TIME_INVALID", label)
  return Date.parse(value)
}
function blocked(error) {
  return {
    status: "BLOCKED",
    executionAuthorized: false,
    reasons: [{ code: error instanceof ActivationError ? error.code : "ACTIVATION_INTERNAL_ERROR", detail: String(error?.message ?? error) }],
  }
}

const ROOT = new URL("../../../", import.meta.url)
const REPOSITORY_ROOT = fileURLToPath(ROOT)
const ACTIVATION_PATH = "config/execution-fabric/remote-dev-offload-v1-activation.json"
const IDENTITY_PATH = "config/execution-fabric/aegis-resident-identity.json"
const PREREQUISITE_RECEIPT_PATH = "/var/lib/williamos-fabric/remote-dev-prerequisite-verified.json"
const BRIDGE_RECEIPT_PATH = "/var/lib/williamos-fabric/remote-dev-activation-bridge-verified.json"
const LIVE_SESSIONS = new WeakMap()
const ARTIFACT_PATHS = {
  worker: "scripts/execution-fabric/live/aegis-remote-dev-worker.sh",
  controller: "scripts/execution-fabric/live/invoke-remote-dev-offload.ps1",
  contract: "scripts/execution-fabric/live/remote-dev-offload-contract.mjs",
  policy: "config/execution-fabric/remote-dev-offload-v1.policy.json",
  inactiveScope: "config/execution-fabric/remote-dev-offload-v1-inactive-scope.json",
  networkProvider: "scripts/execution-fabric/live/aegis-resident-network-boundary.mjs",
  networkPolicy: "config/execution-fabric/aegis-resident-network-boundary.json",
  networkLauncher: "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs",
  rootPrerequisiteManifest: "config/execution-fabric/aegis-remote-dev-root-handoff.json",
  rootPrerequisiteVerifier: "scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.mjs",
  rootPrerequisiteAdapter: "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs",
  activationHost: "scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs",
  activationBootstrap: "scripts/execution-fabric/provision/aegis-remote-dev-activation-bridge-bootstrap.mjs",
  activationPeer: "scripts/execution-fabric/provision/assets/aegis-remote-dev-activation-peer.py",
  activationSocket: "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation.socket",
  activationService: "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-activation@.service",
  sshEntrypoint: "scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs",
}
const BASELINE_ARTIFACT_PATHS = {
  contract: "config/execution-fabric/aegis-bounded-dispatch-contract.json",
  profiles: "config/execution-fabric/aegis-bounded-operation-profiles.json",
  authorityRegistry: "config/execution-fabric/aegis-bounded-dispatch-authority-registry.json",
  identity: "config/execution-fabric/aegis-resident-identity.json",
  forgePermission: "config/execution-fabric/agent-forge-aegis-bounded-dispatch-permission.json",
  trustedRunner: "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-hash-verify.mjs",
  proofWorker: ARTIFACT_PATHS.worker,
  hashScope: "config/execution-fabric/aegis-bounded-dispatch-authority-scopes/WO-EF-DISPATCH-AEGIS-001.json",
  hashClaim: "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-claim.json",
  hashLease: "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-lease.json",
  hashRelease: "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-release.json",
  hashReplay: "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-replay-evidence.json",
}

const EXPECTED_OPERATIONS = [
  "PROVE_PREFLIGHT", "CREATE_WORKSPACE", "APPLY_RESERVED_PATCH", "RESTORE_DOTNET",
  "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE",
  "COMMIT_RESERVED_PATHS", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE", "CLEAN_EXACT_WORKSPACE",
]
const EXPECTED_RESOURCES = {
  canonicalProfileEquivalent: false,
  cpuThreads: 12,
  memoryBytes: 12884901888,
  scratchBytes: 85899345920,
  timeoutSeconds: 5400,
  maxAttempts: 3,
}
const EXPECTED_ENDPOINTS = [
  { host: "ssh.github.com", port: 443, operations: ["git-fetch", "git-push"] },
  { host: "api.github.com", port: 443, operations: ["github-pr"] },
  { host: "api.nuget.org", port: 443, operations: ["dotnet-restore"] },
  { host: "globalcdn.nuget.org", port: 443, operations: ["dotnet-restore"] },
]
const ACTIVATION_CRITICAL_PATHS = [
  ACTIVATION_PATH,
  "scripts/execution-fabric/live/remote-dev-offload-activation.mjs",
  ARTIFACT_PATHS.worker,
  ARTIFACT_PATHS.controller,
  ARTIFACT_PATHS.contract,
  ARTIFACT_PATHS.policy,
  ARTIFACT_PATHS.inactiveScope,
  ARTIFACT_PATHS.networkProvider,
  ARTIFACT_PATHS.networkPolicy,
  ARTIFACT_PATHS.networkLauncher,
  ARTIFACT_PATHS.rootPrerequisiteManifest,
  ARTIFACT_PATHS.rootPrerequisiteVerifier,
  ARTIFACT_PATHS.rootPrerequisiteAdapter,
  ARTIFACT_PATHS.activationHost,
  ARTIFACT_PATHS.activationBootstrap,
  ARTIFACT_PATHS.activationPeer,
  ARTIFACT_PATHS.activationSocket,
  ARTIFACT_PATHS.activationService,
  ARTIFACT_PATHS.sshEntrypoint,
  "scripts/execution-fabric/canonical-json.mjs",
  "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-hash-verify.mjs",
  IDENTITY_PATH,
]
const TRUSTED_GIT_ENV = Object.freeze({
  HOME: "/nonexistent",
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
})

function read(relativePath) { return fs.readFileSync(new URL(relativePath, ROOT)) }
function jcsDigest(value) { return crypto.createHash("sha256").update(canonicalizeJcs(value)).digest("hex") }
function validateInactiveBaseline() {
  const policy = JSON.parse(read(ARTIFACT_PATHS.policy))
  const scopeBytes = read(ARTIFACT_PATHS.inactiveScope)
  const scope = JSON.parse(scopeBytes)
  const artifacts = { trustScope: scopeBytes }
  for (const [name, relativePath] of Object.entries(BASELINE_ARTIFACT_PATHS)) artifacts[name] = read(relativePath)
  const baseline = validateRemoteDevTrustBaseline(policy, scope, artifacts)
  if (baseline.status !== "INACTIVE_TRUSTED_MAIN_READY" || baseline.executionAuthorized !== false) {
    fail(baseline.reasons?.[0]?.code ?? "TRUST_BASELINE_DRIFT", baseline.reasons?.[0]?.detail ?? "inactive baseline validation failed")
  }
}

function validateAuthority(authority) {
  exactKeys(authority, ["schemaVersion", "activationId", "authorityReference", "workOrderId", "status", "executionAuthorizedByFileAlone", "issue", "run", "target", "trustedMain", "bindings", "executionIdentity", "operations", "resources", "network", "lifecycle", "authoritySeparation", "scheduler"], "authority")
  if (authority.schemaVersion !== 1 || authority.activationId !== "remote-dev-offload-v1-issue-734-single-use-001"
    || authority.authorityReference !== "issue-734-terrafusion-remote-dev-single-use-001"
    || authority.workOrderId !== "WO-TF-REMOTE-DEV-OFFLOAD-001"
    || authority.status !== "FUTURE_DATED_SINGLE_USE_AUTHORITY" || authority.executionAuthorizedByFileAlone !== false) {
    fail(authority.authorityReference === "issue-538-aegis-single-use-hash-001" ? "HASH_SCOPE_REUSE_REJECTED" : "ACTIVATION_SCOPE_MISMATCH", "activation identity differs")
  }
  let reviewedAuthority
  try { reviewedAuthority = JSON.parse(read(ACTIVATION_PATH)) } catch { fail("ACTIVATION_BINDING_DRIFT", "reviewed activation authority is unavailable") }
  if (!same(authority, reviewedAuthority)) fail("ACTIVATION_BINDING_DRIFT", "authority differs from the reviewed activation bytes")
  exactKeys(authority.issue, ["repository", "number", "outcome"], "issue")
  if (!same(authority.issue, { repository: "bsvalues/terrafusion_os_1.0", number: 734, outcome: "MAKE_OMITTED_DOTNET_DOCTRINE_TEST_VISIBLE_AS_INFORMATIONAL" })) fail("ACTIVATION_SCOPE_MISMATCH", "issue #734 binding differs")
  exactKeys(authority.run, ["runId", "issuedAt", "validFrom", "expiresAt", "singleUse", "maximumConsumptionCount"], "run")
  if (!GUID.test(authority.run.runId) || authority.run.singleUse !== true || authority.run.maximumConsumptionCount !== 1) fail("ACTIVATION_RUN_MISMATCH", "run is not a one-use GUID")
  const issued = timestamp(authority.run.issuedAt, "run.issuedAt")
  const validFrom = timestamp(authority.run.validFrom, "run.validFrom")
  const expiresAt = timestamp(authority.run.expiresAt, "run.expiresAt")
  if (issued >= validFrom || expiresAt <= validFrom || expiresAt - validFrom > 14_400_000) fail("ACTIVATION_TIME_INVALID", "authority window must be future-dated and at most four hours")

  exactKeys(authority.target, ["repository", "baseRef", "nodeId", "workspace", "branch"], "target")
  const target = { repository: "bsvalues/terrafusion_os_1.0", baseRef: "refs/heads/main", nodeId: "aegis", workspace: "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001", branch: "codex/wo-tf-remote-dev-offload-001-734" }
  if (!same(authority.target, target)) fail("ACTIVATION_SCOPE_MISMATCH", "target differs")
  exactKeys(authority.trustedMain, ["controlPlane", "target"], "trustedMain")
  exactKeys(authority.trustedMain.controlPlane, ["repository", "ref", "minimumCommit", "ancestryRequired", "cleanExactHeadRequired", "proofProvider", "workingFilesProof", "criticalPaths"], "trustedMain.controlPlane")
  if (authority.trustedMain.controlPlane.repository !== "bsvalues/terragroq" || authority.trustedMain.controlPlane.ref !== "refs/heads/main"
    || !SHA40.test(authority.trustedMain.controlPlane.minimumCommit) || authority.trustedMain.controlPlane.ancestryRequired !== true
    || authority.trustedMain.controlPlane.cleanExactHeadRequired !== true || authority.trustedMain.controlPlane.proofProvider !== createTrustedProofProviders.name
    || authority.trustedMain.controlPlane.workingFilesProof !== inspectActivationCriticalWorkingFiles.name
    || !same(authority.trustedMain.controlPlane.criticalPaths, ACTIVATION_CRITICAL_PATHS)) fail("TRUSTED_MAIN_UNPROVEN", "control-plane trusted-main requirements differ")
  exactKeys(authority.trustedMain.target, ["repository", "ref", "pinnedCommit", "freshRemoteEqualityRequired", "freshRemoteEqualityOperation"], "trustedMain.target")
  if (!same(authority.trustedMain.target, { repository: authority.target.repository, ref: authority.target.baseRef, pinnedCommit: "ffd2fa35f5152de2b95e7f63b220050d18193d7a", freshRemoteEqualityRequired: true, freshRemoteEqualityOperation: "CREATE_WORKSPACE" })) fail("TARGET_TRUSTED_MAIN_UNPROVEN", "TerraFusion target trusted-main requirements differ")

  exactKeys(authority.bindings, Object.keys(ARTIFACT_PATHS), "bindings")
  for (const [name, relativePath] of Object.entries(ARTIFACT_PATHS)) {
    exactKeys(authority.bindings[name], ["path", "sha256"], `bindings.${name}`)
    if (authority.bindings[name].path !== relativePath || !SHA256.test(authority.bindings[name].sha256)
      || authority.bindings[name].sha256 !== normalizedDigest(read(relativePath))) fail("ACTIVATION_BINDING_DRIFT", `${name} bytes differ from authority`)
  }

  exactKeys(authority.executionIdentity, ["account", "privilege", "identityProvider", "reviewedIdentityPath", "machineIdSha256", "noSudoProofRequired"], "executionIdentity")
  if (!same(authority.executionIdentity, { account: "williamos-fabric", privilege: "non-root-no-sudo", identityProvider: trustedResidentIdentity.name, reviewedIdentityPath: IDENTITY_PATH, machineIdSha256: "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b", noSudoProofRequired: true })) fail("ACTIVATION_SCOPE_MISMATCH", "execution identity differs")
  if (!same(authority.operations, EXPECTED_OPERATIONS) || !same(authority.resources, EXPECTED_RESOURCES)) fail("ACTIVATION_SCOPE_MISMATCH", "operations or resources differ")
  exactKeys(authority.network, ["defaultDeny", "atlasAllowed", "enforcementProofRequired", "endpoints"], "network")
  if (!same(authority.network, { defaultDeny: true, atlasAllowed: false, enforcementProofRequired: true, endpoints: EXPECTED_ENDPOINTS })) fail("ACTIVATION_SCOPE_MISMATCH", "network exception differs")
  if (!same(authority.lifecycle, { ledgerProvider: createLedgerProviders.name, durableSingleUseClaimRequired: true, nodeExclusiveLeaseRequired: true, durableReleaseRequired: true, replayRejectionRequired: true, sameRunScopeClaimLeaseRequired: true })) fail("ACTIVATION_SCOPE_MISMATCH", "lifecycle requirements differ")
  if (!same(authority.authoritySeparation, { inactiveBaselineRemainsInactive: true, closedCanonicalCiTemplateActivated: false, consumedHashScope: "WO-EF-DISPATCH-AEGIS-001", consumedHashAuthorityReference: "issue-538-aegis-single-use-hash-001", hashScopeReuseAllowed: false, hashEvidenceMutationAllowed: false })) fail("HASH_SCOPE_REUSE_REJECTED", "authority separation differs")
  if (!same(authority.scheduler, { state: "disabled", standingAegisAuthority: false, autonomousDispatch: false })) fail("ACTIVATION_SCOPE_MISMATCH", "scheduler or standing authority differs")
}

function validateCandidate(authority, candidate) {
  exactKeys(candidate, ["runId", "workOrderId", "issue", "repository", "baseRef", "baseSha", "nodeId", "workspace", "branch", "operations", "resources", "network", "executionIdentity"], "candidate")
  if (candidate.runId !== authority.run.runId) fail("ACTIVATION_RUN_MISMATCH", "candidate run differs")
  if (!SHA40.test(candidate.baseSha) || candidate.baseSha !== authority.trustedMain.target.pinnedCommit) fail("TARGET_TRUSTED_MAIN_UNPROVEN", "candidate TerraFusion base is not the reviewed target commit")
  const expected = {
    runId: authority.run.runId,
    workOrderId: authority.workOrderId,
    issue: authority.issue,
    repository: authority.target.repository,
    baseRef: authority.target.baseRef,
    baseSha: candidate.baseSha,
    nodeId: authority.target.nodeId,
    workspace: authority.target.workspace,
    branch: authority.target.branch,
    operations: authority.operations,
    resources: authority.resources,
    network: authority.network,
    executionIdentity: authority.executionIdentity,
  }
  if (!same(candidate, expected)) fail("ACTIVATION_SCOPE_MISMATCH", "candidate differs from single-use authority")
}

export function validateRemoteDevActivationAuthority(authority, candidate) {
  try {
    validateInactiveBaseline()
    if (authority === null || authority === undefined) fail("REMOTE_DEV_SCOPE_INACTIVE", "inactive baseline cannot activate itself")
    validateAuthority(authority)
    validateCandidate(authority, candidate)
    return { status: "ACTIVATION_AUTHORITY_MATCHED", executionAuthorized: false, runId: authority.run.runId, authorityReference: authority.authorityReference, nextGate: "TRUSTED_RUNTIME_PROOFS" }
  } catch (error) { return blocked(error) }
}

export function inspectRemoteDevActivationWindow(authority, now) {
  try {
    validateAuthority(authority)
    const trustedNow = timestamp(now, "now")
    if (trustedNow < Date.parse(authority.run.validFrom)) fail("ACTIVATION_NOT_YET_VALID", "activation window has not opened")
    if (trustedNow >= Date.parse(authority.run.expiresAt)) fail("ACTIVATION_EXPIRED", "activation window has closed")
    return { status: "WINDOW_ACTIVE", executionAuthorized: false, runId: authority.run.runId }
  } catch (error) { return blocked(error) }
}

export function inspectResidentNoSudoResult(evidence) {
  try {
    exactKeys(evidence, ["status", "signal", "errorCode", "stdout", "stderr"], "noSudoEvidence")
    const stderr = typeof evidence.stderr === "string" ? evidence.stderr.replace(/\r\n/g, "\n") : ""
    if (evidence.status !== 1 || evidence.signal !== null || evidence.errorCode !== null || evidence.stdout !== ""
      || stderr !== "Sorry, user williamos-fabric may not run sudo on aegis.\n") {
      fail("EXECUTION_IDENTITY_UNPROVEN", "sudo result is not the exact fixed resident policy denial")
    }
    return { status: "NO_SUDO_VERIFIED", executionAuthorized: false, account: "williamos-fabric", nodeId: "aegis" }
  } catch (error) { return blocked(error) }
}

function proveNoSudoCapability() {
  const result = spawnSync("/usr/bin/sudo", ["-n", "-l"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5000,
    env: { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  })
  const inspected = inspectResidentNoSudoResult({
    status: result.status,
    signal: result.signal,
    errorCode: result.error?.code ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  })
  if (inspected.status !== "NO_SUDO_VERIFIED") fail("EXECUTION_IDENTITY_UNPROVEN", inspected.reasons?.[0]?.detail ?? "no-sudo capability could not be proven")
}

function runControlPlaneAncestry(args) {
  return spawnSync("/usr/bin/git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5000,
    env: TRUSTED_GIT_ENV,
  })
}

export function inspectControlPlaneTrustedCheckout(authority, candidate, checkout, runAncestry = runControlPlaneAncestry) {
  try {
    const controlPlane = authority?.trustedMain?.controlPlane
    const target = authority?.trustedMain?.target
    if (!controlPlane || !target || candidate?.baseSha !== target.pinnedCommit) fail("TARGET_TRUSTED_MAIN_UNPROVEN", "TerraFusion target base differs from the reviewed target commit")
    if (checkout?.verified !== true || checkout?.clean !== true || checkout?.trusted_ref !== controlPlane.ref
      || !SHA40.test(checkout?.head_commit ?? "")) fail("TRUSTED_MAIN_UNPROVEN", "canonical control-plane checkout proof differs")
    const ancestry = runAncestry(["--no-replace-objects", "merge-base", "--is-ancestor", controlPlane.minimumCommit, checkout.head_commit])
    if (ancestry?.status !== 0) fail("TRUSTED_MAIN_UNPROVEN", "minimum control-plane trusted-main ancestry is unproven")
    return { status: "CONTROL_PLANE_TRUSTED_MAIN_VERIFIED", executionAuthorized: false, headCommit: checkout.head_commit, targetCommit: target.pinnedCommit }
  } catch (error) { return blocked(error) }
}

export function inspectResidentIdentityBinding(authority, actual, reviewed) {
  try {
    exactKeys(reviewed, ["schema_version", "node_id", "hostname", "machine_id_sha256", "machine_id_source", "network_address_is_identity", "status"], "reviewed identity")
    exactKeys(actual, ["node_id", "hostname", "machine_id_sha256", "agent_identity", "provider_identity"], "resident identity")
    if (reviewed.schema_version !== "0.1-aegis-resident-identity" || reviewed.node_id !== "aegis" || reviewed.hostname !== "aegis"
      || reviewed.machine_id_source !== "/etc/machine-id" || reviewed.network_address_is_identity !== false
      || reviewed.status !== "REVIEWED_IDENTITY_NOT_AUTHORITY" || !SHA256.test(reviewed.machine_id_sha256)
      || authority?.executionIdentity?.reviewedIdentityPath !== IDENTITY_PATH
      || authority?.executionIdentity?.machineIdSha256 !== reviewed.machine_id_sha256
      || actual.node_id !== reviewed.node_id || actual.hostname !== reviewed.hostname
      || actual.machine_id_sha256 !== reviewed.machine_id_sha256
      || actual.agent_identity !== "resident-aegis" || actual.provider_identity !== "resident-aegis") {
      fail("EXECUTION_IDENTITY_UNPROVEN", "resident AEGIS identity differs from the reviewed machine binding")
    }
    return { status: "RESIDENT_IDENTITY_VERIFIED", executionAuthorized: false, nodeId: actual.node_id, machineIdSha256: actual.machine_id_sha256 }
  } catch (error) { return blocked(error) }
}

function defaultReadTrustedMainFile(args) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: null,
    shell: false,
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
    env: TRUSTED_GIT_ENV,
  })
  if (result.status !== 0) fail("TRUSTED_MAIN_UNPROVEN", "trusted control-plane file is unavailable from main")
  return Buffer.from(result.stdout ?? [])
}

export function inspectActivationCriticalWorkingFiles(authority, { repositoryRoot = REPOSITORY_ROOT, runGit = defaultReadTrustedMainFile } = {}) {
  try {
    const controlPlane = authority?.trustedMain?.controlPlane
    if (!controlPlane || controlPlane.ref !== "refs/heads/main" || !same(controlPlane.criticalPaths, ACTIVATION_CRITICAL_PATHS)) fail("TRUSTED_MAIN_UNPROVEN", "activation-critical path set differs")
    const root = fs.realpathSync(repositoryRoot)
    for (const relativePath of ACTIVATION_CRITICAL_PATHS) {
      const lexical = path.join(root, ...relativePath.split("/"))
      const relative = path.relative(root, lexical)
      if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("TRUSTED_MAIN_UNPROVEN", "activation-critical path escapes the repository")
      let cursor = root
      for (const segment of relativePath.split("/")) {
        cursor = path.join(cursor, segment)
        if (fs.lstatSync(cursor).isSymbolicLink()) fail("TRUSTED_MAIN_UNPROVEN", `${relativePath} must not contain symbolic links`)
      }
      const real = fs.realpathSync(lexical)
      const stats = fs.statSync(real)
      if (!stats.isFile() || stats.nlink !== 1) fail("TRUSTED_MAIN_UNPROVEN", `${relativePath} is not a single-link regular file`)
      const trusted = Buffer.from(runGit(["--no-replace-objects", "show", `${controlPlane.ref}:${relativePath}`]))
      if (!trusted.equals(fs.readFileSync(real))) fail("TRUSTED_MAIN_UNPROVEN", `${relativePath} differs from trusted main`)
    }
    return { status: "ACTIVATION_CRITICAL_FILES_VERIFIED", executionAuthorized: false, pathCount: ACTIVATION_CRITICAL_PATHS.length }
  } catch (error) { return blocked(error) }
}

function trustedRuntimeNow() {
  const result = spawnSync("/usr/bin/date", ["-u", "+%Y-%m-%dT%H:%M:%S.%3NZ"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5000,
    env: { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  })
  const value = result.stdout?.trim()
  if (result.status !== 0 || typeof value !== "string" || !UTC.test(value) || !Number.isFinite(Date.parse(value))) fail("ACTIVATION_TIME_INVALID", "fixed resident UTC clock is unavailable")
  return value
}

function readRootPrerequisiteReceipt() {
  let cursor = path.parse(PREREQUISITE_RECEIPT_PATH).root
  for (const segment of PREREQUISITE_RECEIPT_PATH.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment); const stat = fs.lstatSync(cursor)
    if (stat.isSymbolicLink()) fail("ROOT_PREREQUISITES_UNPROVEN", "prerequisite receipt path contains a symlink")
    if (cursor !== PREREQUISITE_RECEIPT_PATH && (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022) !== 0)) fail("ROOT_PREREQUISITES_UNPROVEN", "prerequisite receipt parent is not root-controlled")
  }
  const stat = fs.lstatSync(PREREQUISITE_RECEIPT_PATH)
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== 0o444 || stat.size < 3 || stat.size > 1_048_576) fail("ROOT_PREREQUISITES_UNPROVEN", "prerequisite receipt file trust differs")
  const bytes = fs.readFileSync(PREREQUISITE_RECEIPT_PATH); let receipt
  try { receipt = JSON.parse(bytes.toString("utf8")) } catch { fail("ROOT_PREREQUISITES_UNPROVEN", "prerequisite receipt is not JSON") }
  if (!bytes.equals(Buffer.from(`${canonicalizeJcs(receipt)}\n`, "utf8"))) fail("ROOT_PREREQUISITES_UNPROVEN", "prerequisite receipt is not canonical JSON")
  return { bytes, receipt }
}

export function inspectRootPrerequisiteReceiptEvidence(bytes, manifest, currentMachine, currentControlCommit) {
  try {
    const receipt = JSON.parse(Buffer.from(bytes).toString("utf8"))
    if (!Buffer.from(bytes).equals(Buffer.from(`${canonicalizeJcs(receipt)}\n`, "utf8"))) fail("ROOT_PREREQUISITES_UNPROVEN", "prerequisite receipt is not canonical JSON")
    exactKeys(receipt, ["schemaVersion", "status", "workOrderId", "transactionId", "authorityId", "completedAt", "machineIdSha256", "trustedMainCommit", "reviewedPackageCommit", "observedFreshMainCommit", "rootHandoffManifestSha256", "historicalPreflightManifestJcsSha256", "appliedAssets", "authoritySha256", "inputsSha256", "launchAuthorityPublicKeySha256", "storage", "journalHeadSha256", "schedulerEnabled", "standingAuthority", "dispatchOccurred", "closedHashMutation", "executionAuthorized", "activationAuthorized"], "prerequisite receipt")
    if (receipt.schemaVersion !== 1 || receipt.status !== "PREREQUISITES_VERIFIED" || receipt.workOrderId !== "WO-TF-REMOTE-DEV-OFFLOAD-001"
      || !GUID.test(receipt.transactionId) || !GUID.test(receipt.authorityId) || !UTC.test(receipt.completedAt) || !Number.isFinite(Date.parse(receipt.completedAt))
      || receipt.machineIdSha256 !== currentMachine || receipt.machineIdSha256 !== manifest.target?.machineIdSha256
      || !SHA40.test(currentControlCommit ?? "") || receipt.trustedMainCommit !== "98b458b998010f8ccfe9902fd307d75c0ec8c309" || receipt.reviewedPackageCommit !== receipt.trustedMainCommit || receipt.observedFreshMainCommit !== receipt.trustedMainCommit || receipt.rootHandoffManifestSha256 !== jcsDigest(manifest)
      || receipt.historicalPreflightManifestJcsSha256 !== manifest.prerequisitePackage?.supersededPreflight?.manifestJcsSha256 || !same(receipt.appliedAssets, manifest.appliedAssets)
      || !SHA256.test(receipt.authoritySha256) || !SHA256.test(receipt.inputsSha256) || !SHA256.test(receipt.launchAuthorityPublicKeySha256)
      || !same(receipt.storage, { mode: "VERIFY_ONLY", filesystemUuid: manifest.storage?.filesystemUuid, projectId: 734, hardLimitBytes: 85899345920 })
      || !SHA256.test(receipt.journalHeadSha256) || receipt.schedulerEnabled !== false || receipt.standingAuthority !== false || receipt.dispatchOccurred !== false
      || receipt.closedHashMutation !== false || receipt.executionAuthorized !== false || receipt.activationAuthorized !== false) fail("ROOT_PREREQUISITES_UNPROVEN", "canonical prerequisite receipt binding differs")
    return { status: "ROOT_PREREQUISITES_VERIFIED", executionAuthorized: false, receiptSha256: crypto.createHash("sha256").update(bytes).digest("hex"), transactionId: receipt.transactionId, launchAuthorityPublicKeySha256: receipt.launchAuthorityPublicKeySha256 }
  } catch (error) { return blocked(error) }
}

function proveRootPrerequisites(currentControlCommit, authority) {
  const manifest = JSON.parse(read(ARTIFACT_PATHS.rootPrerequisiteManifest)); const { bytes } = readRootPrerequisiteReceipt()
  const currentMachine = crypto.createHash("sha256").update(fs.readFileSync("/etc/machine-id", "utf8").trim()).digest("hex")
  const result = inspectRootPrerequisiteReceiptEvidence(bytes, manifest, currentMachine, currentControlCommit)
  if (result.status !== "ROOT_PREREQUISITES_VERIFIED") fail("ROOT_PREREQUISITES_UNPROVEN", result.reasons?.[0]?.detail ?? "canonical prerequisite receipt differs")
  for (const asset of manifest.appliedAssets ?? []) {
    let cursor = path.parse(asset.destination).root
    for (const segment of path.dirname(asset.destination).slice(cursor.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment); const parent = fs.lstatSync(cursor)
      if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o022) !== 0) fail("ROOT_PREREQUISITES_UNPROVEN", "installed prerequisite parent trust differs")
    }
    const stat = fs.lstatSync(asset.destination)
    const installedSha256 = crypto.createHash("sha256").update(fs.readFileSync(asset.destination)).digest("hex")
    const bridgeEntrypoint = asset.destination === "/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs" && installedSha256 === authority.bindings.sshEntrypoint.sha256 && (stat.mode & 0o7777) === 0o555
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0
      || (!bridgeEntrypoint && ((stat.mode & 0o7777) !== Number.parseInt(asset.mode, 8) || installedSha256 !== asset.sha256))) fail("ROOT_PREREQUISITES_UNPROVEN", "installed prerequisite bytes or metadata differ")
  }
  let bridgeBytes, bridge
  try { const s=fs.lstatSync(BRIDGE_RECEIPT_PATH); if(s.isSymbolicLink()||!s.isFile()||s.nlink!==1||s.uid!==0||s.gid!==0||(s.mode&0o7777)!==0o444) throw new Error(); bridgeBytes = fs.readFileSync(BRIDGE_RECEIPT_PATH); bridge = JSON.parse(bridgeBytes) } catch { fail("ROOT_PREREQUISITES_UNPROVEN", "activation bridge receipt is unavailable") }
  if (!bridgeBytes.equals(Buffer.from(`${canonicalizeJcs(bridge)}\n`)) || bridge.schemaVersion !== 1 || bridge.status !== "ACTIVATION_BRIDGE_VERIFIED" || bridge.runId !== authority.run.runId
    || bridge.machineIdSha256 !== currentMachine || bridge.controlCommit !== currentControlCommit || bridge.prerequisiteReceiptSha256 !== crypto.createHash("sha256").update(bytes).digest("hex")
    || bridge.schedulerEnabled !== false || bridge.standingAuthority !== false || bridge.executionAuthorized !== false) fail("ROOT_PREREQUISITES_UNPROVEN", "activation bridge receipt binding differs")
  const expectedAssets = [
    ["activationHost", "/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs", "0555"],
    ["activationPeer", "/usr/local/libexec/williamos-aegis-remote-dev-activation-peer.py", "0555"],
    ["activationSocket", "/etc/systemd/system/williamos-aegis-remote-dev-activation.socket", "0444"],
    ["activationService", "/etc/systemd/system/williamos-aegis-remote-dev-activation@.service", "0444"],
    ["sshEntrypoint", "/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs", "0555"],
  ].map(([name,destination,mode]) => ({ destination, sha256: authority.bindings[name].sha256, mode }))
  if (!same(bridge.assets, expectedAssets)) fail("ROOT_PREREQUISITES_UNPROVEN", "activation bridge assets differ")
  return result
}

export async function authorizeRemoteDevActivation(authority, candidate) {
  try {
    const matched = validateRemoteDevActivationAuthority(authority, candidate)
    if (matched.status !== "ACTIVATION_AUTHORITY_MATCHED") fail(matched.reasons?.[0]?.code ?? "ACTIVATION_SCOPE_MISMATCH", matched.reasons?.[0]?.detail ?? "authority did not match")
    if (process.platform !== "linux") fail("ACTIVATION_RUNTIME_NODE_INVALID", "live activation is available only inside the resident AEGIS Linux boundary")
    const window = inspectRemoteDevActivationWindow(authority, trustedRuntimeNow())
    if (window.status !== "WINDOW_ACTIVE") fail(window.reasons?.[0]?.code ?? "ACTIVATION_TIME_INVALID", window.reasons?.[0]?.detail ?? "activation window is unavailable")
    let identity
    try { identity = trustedResidentIdentity() } catch { fail("EXECUTION_IDENTITY_UNPROVEN", "fixed resident identity proof failed") }
    let reviewedIdentity
    try { reviewedIdentity = JSON.parse(read(IDENTITY_PATH)) } catch { fail("EXECUTION_IDENTITY_UNPROVEN", "reviewed resident identity is unavailable") }
    const identityBinding = inspectResidentIdentityBinding(authority, identity, reviewedIdentity)
    if (identityBinding.status !== "RESIDENT_IDENTITY_VERIFIED") fail("EXECUTION_IDENTITY_UNPROVEN", identityBinding.reasons?.[0]?.detail ?? "fixed resident identity differs")
    proveNoSudoCapability()
    let checkout
    try { checkout = createTrustedProofProviders().proveTrustedCheckout() } catch { fail("TRUSTED_MAIN_UNPROVEN", "fixed trusted-main provider failed") }
    const controlPlane = inspectControlPlaneTrustedCheckout(authority, candidate, checkout)
    if (controlPlane.status !== "CONTROL_PLANE_TRUSTED_MAIN_VERIFIED") fail(controlPlane.reasons?.[0]?.code ?? "TRUSTED_MAIN_UNPROVEN", controlPlane.reasons?.[0]?.detail ?? "control-plane trusted main is unproven")
    const criticalFiles = inspectActivationCriticalWorkingFiles(authority)
    if (criticalFiles.status !== "ACTIVATION_CRITICAL_FILES_VERIFIED") fail("TRUSTED_MAIN_UNPROVEN", criticalFiles.reasons?.[0]?.detail ?? "activation-critical working files are unproven")
    const prerequisites = proveRootPrerequisites(checkout.head_commit, authority)
    if (prerequisites.status !== "ROOT_PREREQUISITES_VERIFIED") fail("ROOT_PREREQUISITES_UNPROVEN", "root prerequisite receipt differs")
    const networkBoundary = await proveResidentAegisNetworkBoundary()
    if (networkBoundary.status !== "RESIDENT_NETWORK_BOUNDARY_VERIFIED") {
      fail("NETWORK_BOUNDARY_UNPROVEN", networkBoundary.reasons?.[0]?.detail ?? "fixed resident network boundary is unproven")
    }
    if (networkBoundary.launchAuthorityPublicKeySha256 !== prerequisites.launchAuthorityPublicKeySha256) fail("ROOT_PREREQUISITES_UNPROVEN", "network launch authority differs from the durable prerequisite receipt")

    // Claims and leases are reachable only after the fixed resident network proof succeeds.
    const ledger = createLedgerProviders()
    const scopeSha256 = normalizedDigest(read(ACTIVATION_PATH))
    const claim = await ledger.claimSingleUse({ request_sha256: jcsDigest(candidate), scope_sha256: scopeSha256, authority_reference: authority.authorityReference, maximum_attempts: authority.resources.maxAttempts })
    if (claim.claimed !== true) fail("REQUEST_ALREADY_CONSUMED", "single-use activation was already claimed")
    const lease = await ledger.acquireExclusiveLease({ claim_id: claim.claim_id })
    if (lease.acquired !== true) fail("NODE_EXCLUSIVE_LEASE_UNPROVEN", "node-exclusive AEGIS lease was not acquired")
    const session = Object.freeze({ runId: authority.run.runId })
    LIVE_SESSIONS.set(session, {
      ledger,
      runId: authority.run.runId,
      authorityReference: authority.authorityReference,
      maximumAttempts: authority.resources.maxAttempts,
      requestSha256: jcsDigest(candidate),
      scopeSha256,
      networkProofId: networkBoundary.proofId,
      networkEnforcementGenerationId: networkBoundary.enforcementGenerationId,
      networkControlGroupIdentity: networkBoundary.controlGroupIdentity,
      networkLauncherSha256: networkBoundary.launcherSha256,
      networkWorkerSha256: networkBoundary.workerSha256,
      networkLaunchAuthorityPublicKeySha256: networkBoundary.launchAuthorityPublicKeySha256,
      rootPrerequisiteReceiptSha256: prerequisites.receiptSha256,
      rootPrerequisiteTransactionId: prerequisites.transactionId,
      claimId: claim.claim_id,
      leaseId: lease.lease_id,
      leaseReleased: false,
      settling: false,
    })
    return {
      status: "AUTHORIZED_SINGLE_USE",
      executionAuthorized: true,
      runId: authority.run.runId,
      claimId: claim.claim_id,
      leaseId: lease.lease_id,
      networkProofId: networkBoundary.proofId,
      networkEnforcementGenerationId: networkBoundary.enforcementGenerationId,
      networkControlGroupIdentity: networkBoundary.controlGroupIdentity,
      networkLauncherSha256: networkBoundary.launcherSha256,
      networkWorkerSha256: networkBoundary.workerSha256,
      networkLaunchAuthorityPublicKeySha256: networkBoundary.launchAuthorityPublicKeySha256,
      rootPrerequisiteReceiptSha256: prerequisites.receiptSha256,
      rootPrerequisiteTransactionId: prerequisites.transactionId,
      session,
      schedulerActivated: false,
      standingAegisAuthority: false,
      atlasAllowed: false,
    }
  } catch (error) { return blocked(error) }
}

export async function settleRemoteDevActivationState(state) {
  try {
    if (!state || typeof state !== "object" || state.settling === true) fail("ACTIVATION_SESSION_INVALID", "activation session is already settling or invalid")
    state.settling = true
    try {
      if (state.leaseReleased !== true) {
        const released = await state.ledger.releaseExclusiveLease({ lease_id: state.leaseId, claim_id: state.claimId })
        if (released !== true) fail("ACTIVATION_EVIDENCE_MISMATCH", "canonical lease release failed")
        state.leaseReleased = true
      }
      const replay = await state.ledger.claimSingleUse({ request_sha256: state.requestSha256, scope_sha256: state.scopeSha256, authority_reference: state.authorityReference, maximum_attempts: state.maximumAttempts })
      if (replay.claimed !== false || replay.claim_id !== state.claimId) fail("ACTIVATION_EVIDENCE_MISMATCH", "canonical replay rejection failed")
      const evidence = state.ledger.runtimeEvidence()
      if (!SHA256.test(evidence.release_sha256 ?? "")) fail("ACTIVATION_EVIDENCE_MISMATCH", "canonical durable release evidence is unavailable")
      return { status: "SETTLEMENT_EVIDENCE_VERIFIED", executionAuthorized: false, releaseSha256: evidence.release_sha256 }
    } finally {
      state.settling = false
    }
  } catch (error) { return blocked(error) }
}

export async function settleRemoteDevActivation(session) {
  try {
    if (!session || typeof session !== "object" || !LIVE_SESSIONS.has(session)) fail("ACTIVATION_SESSION_INVALID", "settlement requires the opaque session returned by the fixed live gate")
    const state = LIVE_SESSIONS.get(session)
    const settled = await settleRemoteDevActivationState(state)
    if (settled.status !== "SETTLEMENT_EVIDENCE_VERIFIED") fail(settled.reasons?.[0]?.code ?? "ACTIVATION_EVIDENCE_MISMATCH", settled.reasons?.[0]?.detail ?? "settlement evidence is unavailable")
    LIVE_SESSIONS.delete(session)
    return { status: "CONSUMED_SINGLE_USE", executionAuthorized: false, runId: state.runId, claimId: state.claimId, leaseReleased: true, replayRejected: true, releaseSha256: settled.releaseSha256, schedulerActivated: false, standingAegisAuthority: false }
  } catch (error) { return blocked(error) }
}

export async function recoverRemoteDevActivationSettlement(authority, candidate, recovery) {
  try {
    const matched = validateRemoteDevActivationAuthority(authority, candidate)
    if (matched.status !== "ACTIVATION_AUTHORITY_MATCHED") fail("ACTIVATION_EVIDENCE_MISMATCH", "recovery authority differs")
    exactKeys(recovery, ["runId", "claimId", "leaseId"], "recovery")
    if (recovery.runId !== authority.run.runId || !/^claim-[a-f0-9]{24}$/.test(recovery.claimId) || !/^lease-[a-f0-9]{24}$/.test(recovery.leaseId)) fail("ACTIVATION_EVIDENCE_MISMATCH", "recovery claim or lease differs")
    const state = {
      ledger: createLedgerProviders(), runId: recovery.runId, authorityReference: authority.authorityReference,
      maximumAttempts: authority.resources.maxAttempts, requestSha256: jcsDigest(candidate), scopeSha256: normalizedDigest(read(ACTIVATION_PATH)),
      claimId: recovery.claimId, leaseId: recovery.leaseId, leaseReleased: false, settling: false,
    }
    return await settleRemoteDevActivationState(state)
  } catch (error) { return blocked(error) }
}
