import crypto from "node:crypto"
import fs from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import {
  createLedgerProviders,
  createTrustedProofProviders,
  trustedResidentIdentity,
} from "../bounded-dispatch/run-resident-aegis-hash-verify.mjs"
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
const LIVE_SESSIONS = new WeakMap()
const ARTIFACT_PATHS = {
  worker: "scripts/execution-fabric/live/aegis-remote-dev-worker.sh",
  controller: "scripts/execution-fabric/live/invoke-remote-dev-offload.ps1",
  contract: "scripts/execution-fabric/live/remote-dev-offload-contract.mjs",
  policy: "config/execution-fabric/remote-dev-offload-v1.policy.json",
  inactiveScope: "config/execution-fabric/remote-dev-offload-v1-inactive-scope.json",
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
  exactKeys(authority.trustedMain, ["ref", "minimumCommit", "ancestryRequired", "cleanExactHeadRequired", "proofProvider"], "trustedMain")
  if (authority.trustedMain.ref !== "refs/heads/main" || !SHA40.test(authority.trustedMain.minimumCommit)
    || authority.trustedMain.ancestryRequired !== true || authority.trustedMain.cleanExactHeadRequired !== true
    || authority.trustedMain.proofProvider !== createTrustedProofProviders.name) fail("TRUSTED_MAIN_UNPROVEN", "trusted-main requirements differ")

  exactKeys(authority.bindings, Object.keys(ARTIFACT_PATHS), "bindings")
  for (const [name, relativePath] of Object.entries(ARTIFACT_PATHS)) {
    exactKeys(authority.bindings[name], ["path", "sha256"], `bindings.${name}`)
    if (authority.bindings[name].path !== relativePath || !SHA256.test(authority.bindings[name].sha256)
      || authority.bindings[name].sha256 !== normalizedDigest(read(relativePath))) fail("ACTIVATION_BINDING_DRIFT", `${name} bytes differ from authority`)
  }

  exactKeys(authority.executionIdentity, ["account", "privilege", "identityProvider", "noSudoProofRequired"], "executionIdentity")
  if (!same(authority.executionIdentity, { account: "williamos-fabric", privilege: "non-root-no-sudo", identityProvider: trustedResidentIdentity.name, noSudoProofRequired: true })) fail("ACTIVATION_SCOPE_MISMATCH", "execution identity differs")
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
  if (!SHA40.test(candidate.baseSha)) fail("TRUSTED_MAIN_UNPROVEN", "candidate base is not a commit")
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

function proveMinimumTrustedMain(authority, candidate, checkout) {
  if (checkout?.verified !== true || checkout?.clean !== true || checkout?.trusted_ref !== authority.trustedMain.ref
    || checkout?.head_commit !== candidate.baseSha) fail("TRUSTED_MAIN_UNPROVEN", "canonical checkout proof differs")
  const ancestry = spawnSync("/usr/bin/git", ["merge-base", "--is-ancestor", authority.trustedMain.minimumCommit, candidate.baseSha], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5000,
    env: { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  })
  if (ancestry.status !== 0) fail("TRUSTED_MAIN_UNPROVEN", "minimum trusted-main ancestry is unproven")
}

function proveFixedNetworkBoundary() {
  // Static authority is not network enforcement. A later reviewed resident provider must
  // replace this fail-closed boundary with fixed local evidence before claim or lease creation.
  fail("NETWORK_BOUNDARY_UNPROVEN", "no fixed resident default-deny and Atlas-denial provider is provisioned")
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

export async function authorizeRemoteDevActivation(authority, candidate) {
  try {
    const matched = validateRemoteDevActivationAuthority(authority, candidate)
    if (matched.status !== "ACTIVATION_AUTHORITY_MATCHED") fail(matched.reasons?.[0]?.code ?? "ACTIVATION_SCOPE_MISMATCH", matched.reasons?.[0]?.detail ?? "authority did not match")
    if (process.platform !== "linux") fail("ACTIVATION_RUNTIME_NODE_INVALID", "live activation is available only inside the resident AEGIS Linux boundary")
    const window = inspectRemoteDevActivationWindow(authority, trustedRuntimeNow())
    if (window.status !== "WINDOW_ACTIVE") fail(window.reasons?.[0]?.code ?? "ACTIVATION_TIME_INVALID", window.reasons?.[0]?.detail ?? "activation window is unavailable")
    let identity
    try { identity = trustedResidentIdentity() } catch { fail("EXECUTION_IDENTITY_UNPROVEN", "fixed resident identity proof failed") }
    if (identity?.node_id !== "aegis" || identity?.hostname !== "aegis") fail("EXECUTION_IDENTITY_UNPROVEN", "fixed resident identity differs")
    proveNoSudoCapability()
    let checkout
    try { checkout = createTrustedProofProviders().proveTrustedCheckout() } catch { fail("TRUSTED_MAIN_UNPROVEN", "fixed trusted-main provider failed") }
    proveMinimumTrustedMain(authority, candidate, checkout)
    proveFixedNetworkBoundary()

    // This code is unreachable until the explicit fixed network provider above is reviewed.
    const ledger = createLedgerProviders()
    const scopeSha256 = normalizedDigest(read(ACTIVATION_PATH))
    const claim = await ledger.claimSingleUse({ request_sha256: jcsDigest(candidate), scope_sha256: scopeSha256, authority_reference: authority.authorityReference, maximum_attempts: authority.resources.maxAttempts })
    if (claim.claimed !== true) fail("REQUEST_ALREADY_CONSUMED", "single-use activation was already claimed")
    const lease = await ledger.acquireExclusiveLease({ claim_id: claim.claim_id })
    if (lease.acquired !== true) fail("NODE_EXCLUSIVE_LEASE_UNPROVEN", "node-exclusive AEGIS lease was not acquired")
    const session = Object.freeze({ runId: authority.run.runId })
    LIVE_SESSIONS.set(session, { authority, candidate, ledger, claimId: claim.claim_id, leaseId: lease.lease_id, settling: false })
    return { status: "AUTHORIZED_SINGLE_USE", executionAuthorized: true, runId: authority.run.runId, claimId: claim.claim_id, leaseId: lease.lease_id, session, schedulerActivated: false, standingAegisAuthority: false, atlasAllowed: false }
  } catch (error) { return blocked(error) }
}

export async function settleRemoteDevActivation(session) {
  try {
    if (!session || typeof session !== "object" || !LIVE_SESSIONS.has(session)) fail("ACTIVATION_SESSION_INVALID", "settlement requires the opaque session returned by the fixed live gate")
    const state = LIVE_SESSIONS.get(session)
    if (state.settling) fail("ACTIVATION_SESSION_INVALID", "activation session is already settling")
    state.settling = true
    const released = await state.ledger.releaseExclusiveLease({ lease_id: state.leaseId, claim_id: state.claimId })
    if (released !== true) fail("ACTIVATION_EVIDENCE_MISMATCH", "canonical lease release failed")
    const replay = await state.ledger.claimSingleUse({ request_sha256: jcsDigest(state.candidate), scope_sha256: normalizedDigest(read(ACTIVATION_PATH)), authority_reference: state.authority.authorityReference, maximum_attempts: state.authority.resources.maxAttempts })
    if (replay.claimed !== false || replay.claim_id !== state.claimId) fail("ACTIVATION_EVIDENCE_MISMATCH", "canonical replay rejection failed")
    const evidence = state.ledger.runtimeEvidence()
    if (!SHA256.test(evidence.release_sha256 ?? "")) fail("ACTIVATION_EVIDENCE_MISMATCH", "canonical durable release evidence is unavailable")
    LIVE_SESSIONS.delete(session)
    return { status: "CONSUMED_SINGLE_USE", executionAuthorized: false, runId: state.authority.run.runId, claimId: state.claimId, leaseReleased: true, replayRejected: true, releaseSha256: evidence.release_sha256, schedulerActivated: false, standingAegisAuthority: false }
  } catch (error) { return blocked(error) }
}
