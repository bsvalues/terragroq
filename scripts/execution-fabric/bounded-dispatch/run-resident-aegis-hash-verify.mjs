import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import { runPinnedPlacementInProcessCli } from "../recommend-pinned-placement.mjs"
import { executeAegisHashVerify } from "./aegis-hash-verify.mjs"

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

const TRUSTED_REF = "refs/heads/main"
const GIT_BINARY = "/usr/bin/git"
const MACHINE_ID_PATH = "/etc/machine-id"
const REPORTS_ROOT = "docs/reports"
const LEDGER_PARTS = [".williamos", "execution-fabric", "aegis-ledger"]
const SNAPSHOT_PARTS = [".williamos", "execution-fabric", "aegis-snapshots"]
const PLACEMENT_FILES = [
  "scripts/execution-fabric/verify_snapshot.py",
  "config/execution-fabric/registry.seed.json",
  "config/execution-fabric/registry.schema.json",
  "config/execution-fabric/pinned-evidence-policy.json",
  "config/execution-fabric/placement-workloads.json",
]
const FORGE_FILES = {
  permission: "config/execution-fabric/agent-forge-aegis-bounded-hash-verify-permission.json",
  templates: "config/execution-fabric/aegis-bounded-dispatch-templates.json",
  identity: "config/execution-fabric/aegis-resident-identity.json",
  workOrder: "config/execution-fabric/aegis-bounded-dispatch-work-order.json",
}
const AUTHORITY_REGISTRY = "config/execution-fabric/aegis-bounded-dispatch-authority-registry.json"
const SAFE_SCOPE_PATH = /^config\/execution-fabric\/aegis-bounded-dispatch-authority-scopes\/[A-Za-z0-9][A-Za-z0-9._-]{2,200}\.json$/
const COMMIT = /^[a-f0-9]{40}$/

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

function canonicalBytes(value) {
  return Buffer.from(canonicalizeJcs(value), "utf8")
}

function fail(code, detail) {
  const error = new Error(`FABRIC_AEGIS_RESIDENT_RUNNER_INVALID: ${code}: ${detail}`)
  error.code = code
  throw error
}

function assertLinuxNonRoot({ platform = process.platform, getuid = process.getuid } = {}) {
  if (platform !== "linux") fail("PLATFORM_MISMATCH", "resident AEGIS requires Linux")
  if (typeof getuid !== "function") fail("IDENTITY_UNAVAILABLE", "numeric current-user identity is unavailable")
  const uid = getuid()
  if (!Number.isSafeInteger(uid) || uid <= 0) fail("ROOT_FORBIDDEN", "resident AEGIS must run as a non-root user")
  return uid
}

export function parseArguments(argv) {
  const parsed = {}
  const allowed = new Set(["request", "receipt"])
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) fail("ARGUMENT_INVALID", "arguments must use --name value pairs")
    const name = key.slice(2)
    if (!allowed.has(name) || Object.hasOwn(parsed, name)) {
      fail("ARGUMENT_INVALID", `unsupported or duplicate option --${name}`)
    }
    parsed[name] = value
  }
  if (!parsed.request || !parsed.receipt) fail("ARGUMENT_INVALID", "--request and --receipt are required")
  return parsed
}

function assertContained(root, candidate, label) {
  const relative = path.relative(root, candidate)
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("PATH_ESCAPE", `${label} must be a file beneath ${REPORTS_ROOT}`)
  }
}

export function readConfinedReport(relativePath, repositoryRoot = REPOSITORY_ROOT) {
  if (typeof relativePath !== "string" || relativePath.includes("\\") || path.isAbsolute(relativePath)
    || !relativePath.startsWith(`${REPORTS_ROOT}/`)
    || relativePath.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail("PATH_ESCAPE", `artifact path must be a canonical relative path beneath ${REPORTS_ROOT}`)
  }
  const root = fs.realpathSync(repositoryRoot)
  const reportsRoot = fs.realpathSync(path.join(root, ...REPORTS_ROOT.split("/")))
  assertContained(root, reportsRoot, "reports root")
  const lexical = path.join(root, ...relativePath.split("/"))
  assertContained(reportsRoot, lexical, "artifact")
  let cursor = reportsRoot
  for (const segment of path.relative(reportsRoot, lexical).split(path.sep)) {
    cursor = path.join(cursor, segment)
    const stats = fs.lstatSync(cursor)
    if (stats.isSymbolicLink()) fail("PATH_ESCAPE", "artifact path must not contain symbolic links")
  }
  const real = fs.realpathSync(lexical)
  assertContained(reportsRoot, real, "artifact")
  if (!fs.statSync(real).isFile()) fail("PATH_INVALID", "artifact must be a regular file")
  return fs.readFileSync(real)
}

export function trustedResidentIdentity({
  platform = process.platform,
  getuid = process.getuid,
  hostname = os.hostname,
  readMachineId = () => fs.readFileSync(MACHINE_ID_PATH),
} = {}) {
  assertLinuxNonRoot({ platform, getuid })
  const actualHostname = hostname()
  if (actualHostname !== "aegis") fail("IDENTITY_MISMATCH", "resident hostname must be exactly aegis")
  const machineId = Buffer.from(readMachineId()).toString("utf8").trim()
  if (!/^[a-fA-F0-9]{32}$/.test(machineId)) fail("IDENTITY_INVALID", "/etc/machine-id is invalid")
  return {
    node_id: "aegis",
    hostname: actualHostname,
    machine_id_sha256: sha256(Buffer.from(machineId, "utf8")),
    agent_identity: "resident-aegis",
    provider_identity: "resident-aegis",
  }
}

function defaultRunGit(args) {
  const result = spawnSync(GIT_BINARY, args, {
    cwd: REPOSITORY_ROOT,
    encoding: null,
    shell: false,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      HOME: os.homedir(),
      PATH: "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
  })
  if (result.status !== 0) fail("TRUSTED_MAIN_GIT_FAILED", "local trusted-main Git proof failed")
  return Buffer.from(result.stdout ?? [])
}

function gitShow(runGit, revision, relativePath) {
  return runGit(["show", `${revision}:${relativePath}`])
}

function requireGitSuccess(runGit, args, detail) {
  try { runGit(args) } catch { fail("TRUSTED_MAIN_GIT_FAILED", detail) }
}

function assertTrustedWorkingFile(runGit, repositoryRoot, relativePath) {
  const trusted = gitShow(runGit, TRUSTED_REF, relativePath)
  const local = fs.readFileSync(path.join(repositoryRoot, ...relativePath.split("/")))
  if (!trusted.equals(local)) fail("TRUSTED_MAIN_MISMATCH", `${relativePath} differs from trusted main`)
  return trusted
}

export function createTrustedProofProviders({
  repositoryRoot = REPOSITORY_ROOT,
  homeDirectory = os.homedir(),
  runGit = defaultRunGit,
  runPlacementReplay = runPinnedPlacementInProcessCli,
} = {}) {
  function proveTrustedPlacement({ receiptSha256, receipt }) {
    for (const relativePath of PLACEMENT_FILES) assertTrustedWorkingFile(runGit, repositoryRoot, relativePath)
    const args = [
      "--snapshot-root", path.join(homeDirectory, ...SNAPSHOT_PARTS),
      "--verifier", path.join(repositoryRoot, "scripts/execution-fabric/verify_snapshot.py"),
      "--registry", path.join(repositoryRoot, "config/execution-fabric/registry.seed.json"),
      "--schema", path.join(repositoryRoot, "config/execution-fabric/registry.schema.json"),
      "--policy", path.join(repositoryRoot, "config/execution-fabric/pinned-evidence-policy.json"),
      "--workloads", path.join(repositoryRoot, "config/execution-fabric/placement-workloads.json"),
      "--workload", receipt.workload.id,
      "--at", receipt.evaluated_at,
    ]
    for (const evidence of receipt.evidence_snapshot) args.push("--evidence", `${evidence.node}=${evidence.snapshot_sha256}`)
    const replay = runPlacementReplay(args)
    if (replay.status === "INPUT_REJECTED" || canonicalizeJcs(replay) !== canonicalizeJcs(receipt)) {
      fail("PLACEMENT_UNPROVEN", "pinned placement replay does not reproduce the exact receipt")
    }
    return {
      schema_version: "0.1-trusted-pinned-placement-proof",
      receipt_sha256: receiptSha256,
      semantic_replay_sha256: sha256(canonicalBytes(replay)),
      evidence_count: replay.evidence_snapshot.length,
      verified: true,
    }
  }

  function proveTrustedForge({ permissionSha256, templateRegistrySha256, identityRegistrySha256, workOrderSha256 }) {
    const permission = gitShow(runGit, TRUSTED_REF, FORGE_FILES.permission)
    const templates = gitShow(runGit, TRUSTED_REF, FORGE_FILES.templates)
    const identity = gitShow(runGit, TRUSTED_REF, FORGE_FILES.identity)
    const workOrder = gitShow(runGit, TRUSTED_REF, FORGE_FILES.workOrder)
    if (sha256(permission) !== permissionSha256 || sha256(templates) !== templateRegistrySha256
      || sha256(identity) !== identityRegistrySha256 || sha256(workOrder) !== workOrderSha256) {
      fail("FORGE_UNPROVEN", "trusted main does not retain the exact Forge packet")
    }
    const registry = JSON.parse(templates.toString("utf8"))
    const exactTemplateCount = registry.templates.filter((entry) => entry?.template_id === "aegis.hash-verify.v1").length
    return {
      schema_version: "0.1-trusted-aegis-forge-proof",
      trusted_ref: TRUSTED_REF,
      permission_sha256: permissionSha256,
      template_registry_sha256: templateRegistrySha256,
      identity_registry_sha256: identityRegistrySha256,
      work_order_sha256: workOrderSha256,
      exact_template_count: exactTemplateCount,
      verified: exactTemplateCount === 1,
    }
  }

  function proveTrustedAuthority({ registrySha256, authority, scopeSha256, scopeArtifactSha256 }) {
    if (!COMMIT.test(authority.execution_commit) || !COMMIT.test(authority.reviewed_commit)
      || authority.execution_commit === authority.reviewed_commit
      || !SAFE_SCOPE_PATH.test(authority.scope_path)) fail("AUTHORITY_UNPROVEN", "authority Git binding is invalid")
    requireGitSuccess(runGit, ["merge-base", "--is-ancestor", authority.execution_commit, authority.reviewed_commit], "review is not after execution")
    requireGitSuccess(runGit, ["merge-base", "--is-ancestor", authority.reviewed_commit, TRUSTED_REF], "review is not retained by trusted main")
    const registryBytes = gitShow(runGit, TRUSTED_REF, AUTHORITY_REGISTRY)
    const executionScopeBytes = gitShow(runGit, authority.execution_commit, authority.scope_path)
    const reviewedScopeBytes = gitShow(runGit, authority.reviewed_commit, authority.scope_path)
    if (sha256(registryBytes) !== registrySha256
      || sha256(executionScopeBytes) !== scopeArtifactSha256
      || !executionScopeBytes.equals(reviewedScopeBytes)) {
      fail("AUTHORITY_UNPROVEN", "trusted main does not retain the exact authority bytes")
    }
    const registry = JSON.parse(registryBytes.toString("utf8"))
    return {
      schema_version: "0.1-trusted-aegis-authority-proof",
      trusted_ref: TRUSTED_REF,
      registry_sha256: registrySha256,
      authority_reference: authority.reference,
      producer_identity: authority.producer_identity,
      reviewer_identity: authority.reviewer_identity,
      execution_commit: authority.execution_commit,
      authority_reviewed_commit: authority.reviewed_commit,
      strict_after_commit: authority.execution_commit,
      review_commit_is_strict_descendant: authority.execution_commit !== authority.reviewed_commit,
      scope_sha256: scopeSha256,
      scope_artifact_sha256: scopeArtifactSha256,
      exact_entry_count: registry.entries.filter((entry) => entry?.reference === authority.reference).length,
    }
  }

  return { proveTrustedPlacement, proveTrustedForge, proveTrustedAuthority }
}

function ensurePrivateDirectory(homeDirectory, uid, validateDirectory) {
  const home = fs.realpathSync(homeDirectory)
  let cursor = home
  for (const part of LEDGER_PARTS) {
    cursor = path.join(cursor, part)
    try { fs.mkdirSync(cursor, { mode: 0o700 }) } catch (error) {
      if (error?.code !== "EEXIST") throw error
    }
    const stats = fs.lstatSync(cursor)
    if (!validateDirectory(stats, uid)) {
      fail("LEDGER_UNTRUSTED", "AEGIS ledger path must be a current-user-owned real directory")
    }
    const real = fs.realpathSync(cursor)
    if (path.relative(home, real).startsWith("..") || path.isAbsolute(path.relative(home, real))) {
      fail("LEDGER_UNTRUSTED", "AEGIS ledger escapes the current user home")
    }
  }
  return cursor
}

function syncDirectoryDurably(directoryPath) {
  const directory = fs.openSync(directoryPath, fs.constants.O_RDONLY)
  try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
}

function writeExclusiveDurable(filePath, value, syncDirectory) {
  let descriptor
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8")
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  syncDirectory(path.dirname(filePath))
}

function readPrivateLedgerJson(filePath, uid, validateLedgerFile) {
  let descriptor
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const stats = fs.fstatSync(descriptor)
    if (!validateLedgerFile(stats, uid) || stats.size > 16384) {
      fail("LEDGER_UNTRUSTED", "retained AEGIS ledger record is not a private current-user file")
    }
    return JSON.parse(fs.readFileSync(descriptor, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

export function createLedgerProviders({
  homeDirectory = os.homedir(),
  platform = process.platform,
  getuid = process.getuid,
  clock = () => new Date().toISOString(),
  validateDirectory = (stats, uid) => stats.isDirectory() && !stats.isSymbolicLink()
    && stats.uid === uid && (stats.mode & 0o077) === 0,
  validateLedgerFile = (stats, uid) => stats.isFile() && !stats.isSymbolicLink()
    && stats.uid === uid && (stats.mode & 0o077) === 0,
  syncDirectory = syncDirectoryDurably,
} = {}) {
  const uid = assertLinuxNonRoot({ platform, getuid })
  const ledgerRoot = ensurePrivateDirectory(homeDirectory, uid, validateDirectory)
  let retainedClaim = null
  let retainedLease = null
  let retainedRelease = null
  const claimSingleUse = async ({ request_sha256, scope_sha256, authority_reference, maximum_attempts }) => {
    const claimKeySha256 = sha256(canonicalBytes({ authority_reference, scope_sha256 }))
    const claimedAt = clock()
    const claim = {
      schema_version: "0.1-aegis-single-use-claim",
      request_sha256,
      scope_sha256,
      authority_reference,
      maximum_attempts,
      claim_key_sha256: claimKeySha256,
      claimed_at: claimedAt,
    }
    claim.claim_sha256 = sha256(canonicalBytes(claim))
    const claimPath = path.join(ledgerRoot, `claim-${claimKeySha256}.json`)
    try { writeExclusiveDurable(claimPath, claim, syncDirectory) } catch (error) {
      if (error?.code === "EEXIST") {
        retainedClaim = readPrivateLedgerJson(claimPath, uid, validateLedgerFile)
        const { claim_sha256: retainedClaimSha256, ...claimBody } = retainedClaim ?? {}
        if (!retainedClaim || retainedClaim.claim_key_sha256 !== claimKeySha256
          || retainedClaim.scope_sha256 !== scope_sha256
          || retainedClaim.authority_reference !== authority_reference
          || retainedClaimSha256 !== sha256(canonicalBytes(claimBody))) {
          fail("LEDGER_UNTRUSTED", "retained AEGIS claim does not match its single-use key")
        }
        return { claimed: false, claim_id: `claim-${claimKeySha256.slice(0, 24)}`, claimed_at: retainedClaim.claimed_at }
      }
      throw error
    }
    retainedClaim = claim
    return { claimed: true, claim_id: `claim-${claim.claim_sha256.slice(0, 24)}`, claimed_at: claimedAt }
  }
  const acquireExclusiveLease = async ({ claim_id }) => {
    const acquiredAt = clock()
    const leaseId = `lease-${sha256(canonicalBytes({ claim_id, acquired_at: acquiredAt })).slice(0, 24)}`
    const lease = {
        schema_version: "0.1-resident-aegis-runtime-lease",
        lease_id: leaseId,
        claim_id,
        acquired_at: acquiredAt,
    }
    lease.lease_sha256 = sha256(canonicalBytes(lease))
    try {
      writeExclusiveDurable(path.join(ledgerRoot, "resident-aegis-active.json"), lease, syncDirectory)
    } catch (error) {
      if (error?.code === "EEXIST") return { acquired: false, lease_id: leaseId, acquired_at: acquiredAt }
      throw error
    }
    retainedLease = lease
    return { acquired: true, lease_id: leaseId, acquired_at: acquiredAt }
  }
  const releaseExclusiveLease = async ({ lease_id, claim_id }) => {
    const leasePath = path.join(ledgerRoot, "resident-aegis-active.json")
    const retained = readPrivateLedgerJson(leasePath, uid, validateLedgerFile)
    if (!retained) return false
    const { lease_sha256: retainedLeaseSha256, ...leaseBody } = retained
    if (retained.lease_id !== lease_id || retained.claim_id !== claim_id
      || retainedLeaseSha256 !== sha256(canonicalBytes(leaseBody))) return false
    const release = {
      schema_version: "0.1-resident-aegis-runtime-lease-release",
      lease_id,
      claim_id,
      lease_sha256: retained.lease_sha256,
      released_at: clock(),
    }
    release.release_sha256 = sha256(canonicalBytes(release))
    const releasePath = path.join(ledgerRoot, `release-${lease_id}.json`)
    try {
      writeExclusiveDurable(releasePath, release, syncDirectory)
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
      const existing = readPrivateLedgerJson(releasePath, uid, validateLedgerFile)
      const { release_sha256: existingReleaseSha256, ...releaseBody } = existing ?? {}
      if (!existing || existing.lease_id !== lease_id || existing.claim_id !== claim_id
        || existing.lease_sha256 !== retained.lease_sha256
        || existingReleaseSha256 !== sha256(canonicalBytes(releaseBody))) {
        fail("LEDGER_UNTRUSTED", "retained AEGIS release record is invalid")
      }
      retainedRelease = existing
    }
    fs.unlinkSync(leasePath)
    syncDirectory(ledgerRoot)
    retainedLease = retained
    retainedRelease ??= release
    return true
  }
  const runtimeEvidence = () => ({
    claim_sha256: retainedClaim?.claim_sha256 ?? null,
    lease_sha256: retainedLease?.lease_sha256 ?? null,
    release_sha256: retainedRelease?.release_sha256 ?? null,
  })
  return { ledgerRoot, claimSingleUse, acquireExclusiveLease, releaseExclusiveLease, runtimeEvidence }
}

export async function runResidentAegis(argv = process.argv.slice(2)) {
  const args = parseArguments(argv)
  assertLinuxNonRoot()
  const requestBytes = readConfinedReport(args.request)
  const receiptBytes = readConfinedReport(args.receipt)
  const request = JSON.parse(requestBytes.toString("utf8").replace(/^\uFEFF/, ""))
  const proof = createTrustedProofProviders()
  const ledger = createLedgerProviders()
  const adapterResult = await executeAegisHashVerify({
    repositoryRoot: REPOSITORY_ROOT,
    request,
    receiptBytes,
    clock: () => new Date().toISOString(),
    trustedResidentIdentity,
    proveTrustedPlacement: proof.proveTrustedPlacement,
    proveTrustedForge: proof.proveTrustedForge,
    proveTrustedAuthority: proof.proveTrustedAuthority,
    claimSingleUse: ledger.claimSingleUse,
    acquireExclusiveLease: ledger.acquireExclusiveLease,
    releaseExclusiveLease: ledger.releaseExclusiveLease,
  })
  const evidence = {
    schema_version: "0.1-aegis-resident-runner-evidence",
    adapter_result: adapterResult,
    runtime_evidence: ledger.runtimeEvidence(),
  }
  return { ...evidence, runner_evidence_sha256: sha256(canonicalBytes(evidence)) }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  runResidentAegis().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schema_version: "0.1-aegis-resident-runner-error",
      status: "FAILED_CLOSED",
      code: error?.code ?? "AEGIS_RESIDENT_RUNNER_FAILED",
      detail: String(error?.message ?? error),
      claim_consumed: error?.claimConsumed === true,
      claim_id: error?.claimId ?? null,
      runtime_lease_id: error?.leaseId ?? null,
      operation_attempted: error?.operationAttempted === true,
      runtime_lease_released: error?.runtimeLeaseReleased === true,
      execution_authorized: false,
      network_accessed: false,
      remote_systems_modified: false,
      scheduler_activated: false,
      fallback_used: false,
    }, null, 2)}\n`)
    process.exitCode = 2
  })
}
