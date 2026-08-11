import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { executeAegisStandingHash } from "./aegis-standing-hash-runtime.mjs"

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

const GIT_BINARY = "/usr/bin/git"
const JOURNALCTL_BINARY = "/usr/bin/journalctl"
const SYSTEMD_CAT_BINARY = "/usr/bin/systemd-cat"
const TRUSTED_REF = "refs/heads/main"
const REPORT_ROOT = "docs/reports/standing-dispatch"
const INPUT_ROOT = `${REPORT_ROOT}/inputs`
const LEDGER_ROOT = "/var/lib/williamos/fabric/standing-hash-ledger"
const NODE_LEASE_PATH = "/var/lib/williamos/fabric/ledger/resident-aegis-active.json"
const REQUEST_ROOT = "/var/lib/williamos/fabric/standing-hash-requests"
const RELEASE_MANIFEST_PATH = "/etc/williamos/fabric/trusted-main-release.json"
const MACHINE_ID_PATH = "/etc/machine-id"
const JOURNAL_IDENTIFIER = "williamos-aegis-standing-hash"
const JOURNAL_EPOCH_ID = "aegis-standing-hash-replay-epoch-v1"
const MAX_ARTIFACT_BYTES = 1024 * 1024
const COMMIT = /^[a-f0-9]{40}$/
const DIGEST = /^[a-f0-9]{64}$/
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
export const STANDING_TRUSTED_FILES = [
  "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs",
  "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs",
  "scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs",
  "scripts/execution-fabric/bounded-dispatch/aegis-hash-core.mjs",
  "scripts/execution-fabric/bounded-dispatch/aegis-hash-verify.mjs",
  "scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs",
  "config/execution-fabric/aegis-standing-compute-authority.v1.json",
  "config/execution-fabric/aegis-standing-compute-authority.schema.v1.json",
  "config/execution-fabric/aegis-standing-hash-template.v1.json",
  "config/execution-fabric/aegis-bounded-dispatch-templates.json",
  "config/execution-fabric/aegis-bounded-operation-profiles.json",
  "config/execution-fabric/agent-forge-aegis-bounded-hash-verify-permission.json",
  "config/execution-fabric/aegis-resident-identity.json",
]

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value)
const canonicalBytes = (value) => Buffer.from(canonical(value), "utf8")

function fail(code, detail) {
  const error = new Error(`FABRIC_AEGIS_STANDING_RUNNER_INVALID: ${code}: ${detail}`)
  error.code = code
  throw error
}

function safeId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/.test(value)) {
    fail("IDENTIFIER_INVALID", `${label} is invalid`)
  }
  return value
}

function contained(root, candidate, label) {
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("PATH_ESCAPE", `${label} escaped its fixed root`)
}

export function parseStandingArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) fail("ARGUMENT_INVALID", "exactly --request and --admission are required")
  const parsed = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (!['--request', '--admission'].includes(key) || parsed[key]) fail("ARGUMENT_INVALID", "only one request and one admission are permitted")
    parsed[key] = argv[index + 1]
  }
  if (!parsed['--request'] || !parsed['--admission']) fail("ARGUMENT_INVALID", "request and admission are both required")
  safeId(parsed['--request'], "request")
  return { request: parsed['--request'], admission: parsed['--admission'] }
}

export function readPrivateStandingRequest(name, {
  requestRoot = REQUEST_ROOT,
  fsApi = fs,
  uid = process.getuid?.(),
} = {}) {
  safeId(name, "request")
  if (!Number.isSafeInteger(uid) || uid <= 0) fail("EXECUTION_IDENTITY_MISMATCH", "private request reader requires a non-root uid")
  const lexicalRoot = path.resolve(requestRoot)
  const rootStats = fsApi.lstatSync(lexicalRoot)
  const realRoot = fsApi.realpathSync(lexicalRoot)
  if (realRoot !== lexicalRoot || !rootStats.isDirectory() || rootStats.isSymbolicLink()
    || rootStats.uid !== uid || (rootStats.mode & 0o077) !== 0) {
    fail("REQUEST_ROOT_UNTRUSTED", "standing request root is not private")
  }
  const lexical = path.join(lexicalRoot, `${name}.json`)
  let descriptor
  try {
    const stats = fsApi.lstatSync(lexical)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.uid !== uid
      || (stats.mode & 0o077) !== 0 || stats.size > MAX_ARTIFACT_BYTES) {
      fail("REQUEST_UNTRUSTED", "standing request is not a private single-link file")
    }
    const real = fsApi.realpathSync(lexical)
    contained(realRoot, real, "request")
    descriptor = fsApi.openSync(lexical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fsApi.fstatSync(descriptor)
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== uid || (opened.mode & 0o077) !== 0
      || opened.dev !== stats.dev || opened.ino !== stats.ino || opened.size !== stats.size
      || opened.mtimeMs !== stats.mtimeMs || opened.ctimeMs !== stats.ctimeMs) {
      fail("REQUEST_UNTRUSTED", "standing request identity changed during acquisition")
    }
    return fsApi.readFileSync(descriptor)
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

export function readStandingArtifact(relativePath, options = {}) {
  const {
    repositoryRoot = REPOSITORY_ROOT,
    requiredRoot = REPORT_ROOT,
    fsApi = fs,
    runGit = null,
  } = typeof options === "string" ? { repositoryRoot: options } : options
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.includes("\0")) {
    fail("PATH_ESCAPE", "artifact path must be a normalized repository-relative path")
  }
  const normalized = relativePath.split("/").join(path.sep)
  const lexicalRoot = path.resolve(repositoryRoot, ...requiredRoot.split("/"))
  const lexical = path.resolve(repositoryRoot, normalized)
  contained(lexicalRoot, lexical, "artifact")
  let descriptor
  try {
    const lexicalStats = fsApi.lstatSync(lexical)
    if (lexicalStats.isSymbolicLink()) fail("PATH_ESCAPE", "artifact must not be a symbolic link")
    if (!lexicalStats.isFile() || lexicalStats.nlink !== 1 || lexicalStats.size > MAX_ARTIFACT_BYTES) {
      fail("PATH_INVALID", "artifact must be a bounded single-link regular file")
    }
    const realRoot = fsApi.realpathSync(lexicalRoot)
    const real = fsApi.realpathSync(lexical)
    contained(realRoot, real, "artifact")
    if (runGit) {
      try { runGit(["ls-files", "--error-unmatch", "--", relativePath]) } catch { fail("ARTIFACT_UNTRACKED", "artifact is not tracked by trusted main") }
    }
    descriptor = fsApi.openSync(lexical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fsApi.fstatSync(descriptor)
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== lexicalStats.dev || opened.ino !== lexicalStats.ino
      || opened.size !== lexicalStats.size || opened.mtimeMs !== lexicalStats.mtimeMs || opened.ctimeMs !== lexicalStats.ctimeMs) {
      fail("PATH_INVALID", "artifact identity changed during acquisition")
    }
    return fsApi.readFileSync(descriptor)
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

export function readStandingReleaseManifest({ manifestPath = RELEASE_MANIFEST_PATH, fsApi = fs } = {}) {
  const lexical = path.resolve(manifestPath)
  let descriptor
  try {
    const stats = fsApi.lstatSync(lexical)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.uid !== 0
      || (stats.mode & 0o022) !== 0 || stats.size > 65536) {
      fail("RELEASE_MANIFEST_UNTRUSTED", "trusted release manifest is not root-owned and immutable to the execution account")
    }
    const real = fsApi.realpathSync(lexical)
    if (real !== lexical) fail("RELEASE_MANIFEST_UNTRUSTED", "trusted release manifest path is indirect")
    descriptor = fsApi.openSync(lexical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fsApi.fstatSync(descriptor)
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== 0 || (opened.mode & 0o022) !== 0
      || opened.dev !== stats.dev || opened.ino !== stats.ino || opened.size !== stats.size
      || opened.mtimeMs !== stats.mtimeMs || opened.ctimeMs !== stats.ctimeMs) {
      fail("RELEASE_MANIFEST_UNTRUSTED", "trusted release manifest changed during acquisition")
    }
    return JSON.parse(fsApi.readFileSync(descriptor, "utf8"))
  } catch (error) {
    if (error?.code === "RELEASE_MANIFEST_UNTRUSTED") throw error
    fail("RELEASE_MANIFEST_UNTRUSTED", "trusted release manifest is unavailable or invalid")
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

function ledgerRecordPath(root, prefix, value, label) {
  const identifier = safeId(value, label)
  const key = sha256(canonicalBytes({ [label]: identifier }))
  const candidate = path.join(root, `${prefix}-${key}.json`)
  contained(root, candidate, `${label} ledger record`)
  return candidate
}

function exactRecordKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
}

function validateReleaseManifest(manifest, head) {
  const fields = ["schema_version", "repository", "trusted_ref", "head_commit", "release_root", "reviewed", "deployed_at", "file_sha256", "release_manifest_sha256"]
  const executableClosure = [
    "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs",
    "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs",
    "scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs",
    "scripts/execution-fabric/bounded-dispatch/aegis-hash-core.mjs",
    "scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs",
  ]
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(fields.sort())) {
    fail("RELEASE_MANIFEST_UNTRUSTED", "trusted release manifest shape is invalid")
  }
  const body = { ...manifest }
  delete body.release_manifest_sha256
  if (manifest.schema_version !== "1.0-williamos-trusted-main-release"
    || manifest.repository !== "bsvalues/terragroq" || manifest.trusted_ref !== TRUSTED_REF
    || manifest.head_commit !== head || manifest.reviewed !== true
    || manifest.release_root !== `/opt/williamos/releases/${head}`
    || !Number.isFinite(Date.parse(manifest.deployed_at))
    || !manifest.file_sha256 || JSON.stringify(Object.keys(manifest.file_sha256).sort()) !== JSON.stringify(executableClosure.sort())
    || Object.values(manifest.file_sha256 ?? {}).some((value) => !DIGEST.test(value))
    || manifest.release_manifest_sha256 !== sha256(canonicalBytes(body))) {
    fail("RELEASE_MANIFEST_UNTRUSTED", "trusted release manifest does not bind the reviewed deployed head")
  }
  return manifest
}

function defaultRunGit(args, repositoryRoot = REPOSITORY_ROOT) {
  const result = spawnSync(GIT_BINARY, ["--no-replace-objects", ...args], {
    cwd: repositoryRoot,
    encoding: null,
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
    env: TRUSTED_GIT_ENV,
  })
  if (result.error || result.status !== 0) fail("TRUSTED_MAIN_UNAVAILABLE", `fixed Git proof failed for ${args[0]}`)
  return Buffer.from(result.stdout ?? [])
}

export function readTrustedClosureFile(fsApi, repositoryRoot, relativePath) {
  const lexical = path.join(repositoryRoot, ...relativePath.split("/"))
  const repositoryReal = fsApi.realpathSync(repositoryRoot)
  const stats = fsApi.lstatSync(lexical)
  if (stats.isSymbolicLink()) fail("TRUSTED_MAIN_MISMATCH", `${relativePath} must not be a symbolic link`)
  if (!stats.isFile() || stats.nlink !== 1 || stats.size > MAX_ARTIFACT_BYTES) fail("TRUSTED_MAIN_MISMATCH", `${relativePath} is not a bounded single-link file`)
  const real = fsApi.realpathSync(lexical)
  contained(repositoryReal, real, relativePath)
  let descriptor
  try {
    descriptor = fsApi.openSync(lexical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fsApi.fstatSync(descriptor)
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== stats.dev || opened.ino !== stats.ino
      || opened.size !== stats.size || opened.mtimeMs !== stats.mtimeMs || opened.ctimeMs !== stats.ctimeMs) {
      fail("TRUSTED_MAIN_MISMATCH", `${relativePath} changed during trusted closure acquisition`)
    }
    return fsApi.readFileSync(descriptor)
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

export function readResidentMachineIdentity({ fsApi = fs, machineIdPath = MACHINE_ID_PATH } = {}) {
  const lexical = path.resolve(machineIdPath)
  let descriptor
  try {
    const stats = fsApi.lstatSync(lexical)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.uid !== 0
      || (stats.mode & 0o022) !== 0 || stats.size > 256 || fsApi.realpathSync(lexical) !== lexical) {
      fail("MACHINE_ID_UNTRUSTED", "AEGIS machine identity file is not immutable and root-owned")
    }
    descriptor = fsApi.openSync(lexical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fsApi.fstatSync(descriptor)
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== 0 || (opened.mode & 0o022) !== 0
      || opened.dev !== stats.dev || opened.ino !== stats.ino || opened.size !== stats.size
      || opened.mtimeMs !== stats.mtimeMs || opened.ctimeMs !== stats.ctimeMs) {
      fail("MACHINE_ID_UNTRUSTED", "AEGIS machine identity changed during acquisition")
    }
    const machineId = fsApi.readFileSync(descriptor).toString("utf8").trim()
    if (!/^[a-fA-F0-9]{32}$/.test(machineId)) fail("MACHINE_ID_UNTRUSTED", "AEGIS machine identity is invalid")
    return { node_id: "aegis", machine_id_sha256: sha256(Buffer.from(machineId, "utf8")) }
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

export function createStandingTrustedProof({ repositoryRoot = REPOSITORY_ROOT, admissionPath, inputPath, sourceCommit, authority = null, fsApi = fs, runGit = (args) => defaultRunGit(args, repositoryRoot), readReleaseManifest = () => readStandingReleaseManifest() } = {}) {
    if (runGit(["status", "--porcelain=v1", "--untracked-files=no"]).length !== 0) fail("TRUSTED_MAIN_MISMATCH", "resident checkout is dirty")
    const head = runGit(["rev-parse", "--verify", "HEAD"]).toString("utf8").trim()
    if (!COMMIT.test(head)) fail("TRUSTED_MAIN_MISMATCH", "resident main commit is invalid")
    const releaseManifest = validateReleaseManifest(readReleaseManifest(), head)
    if (!COMMIT.test(sourceCommit ?? "")) fail("SOURCE_COMMIT_MISMATCH", "request source commit is invalid")
    const paths = [...STANDING_TRUSTED_FILES, admissionPath, inputPath]
    if (new Set(paths).size !== paths.length) fail("TRUSTED_MAIN_MISMATCH", "trusted closure contains duplicate paths")
    const digests = {}
     for (const relativePath of paths) {
      const local = relativePath === admissionPath
        ? readStandingArtifact(relativePath, { repositoryRoot, fsApi, runGit })
        : relativePath === inputPath
          ? readStandingArtifact(relativePath, { repositoryRoot, requiredRoot: INPUT_ROOT, fsApi, runGit })
          : readTrustedClosureFile(fsApi, repositoryRoot, relativePath)
      try { runGit(["ls-files", "--error-unmatch", "--", relativePath]) } catch { fail("ARTIFACT_UNTRACKED", `${relativePath} is not tracked`) }
      const retained = runGit(["show", `${head}:${relativePath}`])
      if (!local.equals(retained)) fail("TRUSTED_MAIN_MISMATCH", `${relativePath} differs from trusted main`)
       digests[relativePath] = sha256(local)
     }
     for (const [relativePath, expectedSha256] of Object.entries(releaseManifest.file_sha256)) {
       if (digests[relativePath] !== expectedSha256) fail("RELEASE_MANIFEST_UNTRUSTED", `${relativePath} differs from the root-owned executable closure`)
     }
    try { runGit(["merge-base", "--is-ancestor", sourceCommit, head]) } catch { fail("SOURCE_COMMIT_MISMATCH", "request source is not an ancestor of trusted main") }
    const sourceInput = runGit(["show", `${sourceCommit}:${inputPath}`])
    const retainedInput = runGit(["show", `${head}:${inputPath}`])
    if (!sourceInput.equals(retainedInput)) fail("SOURCE_INPUT_MISMATCH", "approved input changed after the bound source commit")
    if (authority) {
      const active = authority.workload_adapters?.find((entry) => entry?.workload_class === "HASH_VERIFY")
       if (active?.status !== "ACTIVE" || active.adapter_id !== "resident-aegis-hash-verify-v1"
         || active.template_id !== "aegis.hash-verify.v1"
         || active.adapter_sha256 !== digests["scripts/execution-fabric/bounded-dispatch/aegis-hash-verify.mjs"]
         || active.template_sha256 !== digests["config/execution-fabric/aegis-bounded-dispatch-templates.json"]
         || active.profile_sha256 !== digests["config/execution-fabric/agent-forge-aegis-bounded-hash-verify-permission.json"]) {
         fail("ADAPTER_BINDING_MISMATCH", "active authority does not bind the exact standing adapter bytes")
       }
       const integration = authority.standing_integration
       if (integration?.status !== "ACTIVE" || integration.trusted_release_manifest_required !== true
         || integration.runtime_sha256 !== digests["scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs"]
         || integration.operation_core_sha256 !== digests["scripts/execution-fabric/bounded-dispatch/aegis-hash-core.mjs"]
         || integration.resident_runner_sha256 !== digests["scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs"]
         || integration.standing_contract_sha256 !== digests["config/execution-fabric/aegis-standing-hash-template.v1.json"]) {
         fail("INTEGRATION_BINDING_MISMATCH", "active authority does not bind the exact standing integration bytes")
       }
    }
    if (runGit(["rev-parse", "HEAD"]).toString("utf8").trim() !== head) fail("TRUSTED_MAIN_MISMATCH", "trusted main changed during proof")
    return { schema_version: "1.0-aegis-standing-trusted-proof", trusted_ref: TRUSTED_REF, head_commit: head, release_manifest_sha256: releaseManifest.release_manifest_sha256, source_commit: sourceCommit, source_is_ancestor: true, clean: true, exact_file_count: paths.length, file_sha256: digests, verified: true }
}

function requirePrivateRoot(root, uid, validateDirectory) {
  const lexical = path.resolve(root)
  const stats = fs.lstatSync(lexical)
  const real = fs.realpathSync(lexical)
  if (real !== lexical || !validateDirectory(stats, uid)) fail("LEDGER_UNTRUSTED", "standing ledger root is not private")
  return real
}

function syncDirectory(directoryPath) {
  const descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY)
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function writeExclusiveWith(fsApi, filePath, value, sync = syncDirectory) {
  let descriptor
  try {
    descriptor = fsApi.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
    fsApi.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8")
    fsApi.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
  sync(path.dirname(filePath))
}

function readLedgerWith(fsApi, filePath, uid, validateFile) {
  let descriptor
  try {
    descriptor = fsApi.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const stats = fsApi.fstatSync(descriptor)
    if (!validateFile(stats, uid) || stats.size > 65536) fail("LEDGER_UNTRUSTED", "standing ledger record is not private")
    return JSON.parse(fsApi.readFileSync(descriptor, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  } finally {
    if (descriptor !== undefined) fsApi.closeSync(descriptor)
  }
}

function recordDigestValid(record, field) {
  if (!record || !DIGEST.test(record[field] ?? "")) return false
  const body = { ...record }
  delete body[field]
  return record[field] === sha256(canonicalBytes(body))
}

function processStartTicks(pid, fsApi = fs) {
  const stat = fsApi.readFileSync(`/proc/${pid}/stat`, "utf8")
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)
  if (!/^\d+$/.test(fields[19] ?? "")) fail("HOLDER_IDENTITY_INVALID", "process start ticks are unavailable")
  return fields[19]
}

function fixedProcess(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    ...options,
  })
  if (result.error || result.status !== 0) fail("JOURNAL_UNAVAILABLE", `${path.basename(binary)} failed closed`)
  return result.stdout ?? ""
}

function defaultReadJournal() {
  const output = fixedProcess(JOURNALCTL_BINARY, ["--no-pager", "--output=json", `--identifier=${JOURNAL_IDENTIFIER}`])
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    let envelope
    let record
    try {
      envelope = JSON.parse(line)
      record = JSON.parse(envelope.MESSAGE)
    } catch {
      fail("JOURNAL_UNTRUSTED", "standing journal contains malformed evidence")
    }
    const realtime = Number(envelope.__REALTIME_TIMESTAMP)
    if (!Number.isSafeInteger(realtime) || realtime <= 0) fail("JOURNAL_UNTRUSTED", "standing journal timestamp is invalid")
    return {
      record,
      realtime_ms: Math.floor(realtime / 1000),
      uid: Number(envelope._UID),
      identifier: envelope.SYSLOG_IDENTIFIER,
    }
  })
}

function defaultAppendJournal(record) {
  fixedProcess(SYSTEMD_CAT_BINARY, [`--identifier=${JOURNAL_IDENTIFIER}`, "--priority=info", "--level-prefix=false"], {
    input: `${JSON.stringify(record)}\n`,
  })
  fixedProcess(JOURNALCTL_BINARY, ["--sync"])
}

function defaultHolder() {
  return {
    pid: process.pid,
    boot_id: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    process_start_ticks: processStartTicks(process.pid),
  }
}

function defaultHolderIsAlive(holder) {
  try {
    return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() === holder?.boot_id
      && processStartTicks(holder?.pid) === holder?.process_start_ticks
  } catch {
    return false
  }
}

export function createStandingLedgerProviders({
  ledgerRoot: requestedRoot = LEDGER_ROOT,
  nodeLeasePath: requestedNodeLeasePath = NODE_LEASE_PATH,
  fsApi = fs,
  platform = process.platform,
  getuid = process.getuid,
  username = () => os.userInfo().username,
  clock = () => new Date().toISOString(),
  holderIdentity = defaultHolder,
  holderIsAlive = defaultHolderIsAlive,
  validateDirectory = (stats, uid) => stats.isDirectory() && !stats.isSymbolicLink() && stats.uid === uid && (stats.mode & 0o077) === 0,
  validateFile = (stats, uid) => stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1 && stats.uid === uid && (stats.mode & 0o077) === 0,
  syncDirectory: sync = syncDirectory,
  readJournal = defaultReadJournal,
  appendJournal = defaultAppendJournal,
} = {}) {
  if (platform !== "linux" || typeof getuid !== "function") fail("PLATFORM_MISMATCH", "standing AEGIS ledger requires Linux")
  const uid = getuid()
  if (!Number.isSafeInteger(uid) || uid <= 0 || username() !== "williamos-fabric") fail("EXECUTION_IDENTITY_MISMATCH", "standing AEGIS ledger requires its non-root account")
  const lexicalRoot = path.resolve(requestedRoot)
  const rootStats = fsApi.lstatSync(lexicalRoot)
  const root = fsApi.realpathSync(lexicalRoot)
  if (root !== lexicalRoot || !validateDirectory(rootStats, uid)) fail("LEDGER_UNTRUSTED", "standing ledger root is not private")
  const nodeLeasePath = path.resolve(requestedNodeLeasePath)
  const nodeLeaseRoot = path.dirname(nodeLeasePath)
  const nodeLeaseRootStats = fsApi.lstatSync(nodeLeaseRoot)
  if (path.basename(nodeLeasePath) !== "resident-aegis-active.json"
    || fsApi.realpathSync(nodeLeaseRoot) !== nodeLeaseRoot
    || !validateDirectory(nodeLeaseRootStats, uid)) {
    fail("LEDGER_UNTRUSTED", "shared AEGIS node lease root is not private")
  }
  let lastClaim = null
  let lastClaimFailure = null
  let lastLease = null
  let lastResult = null
  let lastRelease = null

  const mutationLockPath = path.join(root, "standing-hash-mutation.lock")
  const mutationHolderPath = path.join(mutationLockPath, "holder.json")
  const withMutationLock = async (action) => {
    let acquired = false
    for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
      const candidateLockPath = path.join(root, `mutation-lock-candidate-${crypto.randomUUID()}`)
      const candidateHolderPath = path.join(candidateLockPath, "holder.json")
      try {
        fsApi.mkdirSync(candidateLockPath, { mode: 0o700 })
        writeExclusiveWith(fsApi, candidateHolderPath, holderIdentity(), sync)
        sync(candidateLockPath)
        fsApi.renameSync(candidateLockPath, mutationLockPath)
        sync(root)
        acquired = true
      } catch (error) {
        if (fsApi.existsSync(candidateHolderPath)) fsApi.unlinkSync(candidateHolderPath)
        if (fsApi.existsSync(candidateLockPath)) fsApi.rmdirSync(candidateLockPath)
        if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error
        if (!fsApi.existsSync(mutationLockPath)) throw error
        const lockStats = fsApi.lstatSync(mutationLockPath)
        if (!validateDirectory(lockStats, uid)) fail("LEDGER_UNTRUSTED", "standing mutation lock is not private")
        const retainedHolder = readLedgerWith(fsApi, mutationHolderPath, uid, validateFile)
        const retainedEntries = fsApi.readdirSync(mutationLockPath)
        if (!retainedHolder && retainedEntries.length === 0) {
          const emptyRecoveryPath = path.join(root, `mutation-recovery-${crypto.randomUUID()}`)
          try {
            fsApi.renameSync(mutationLockPath, emptyRecoveryPath)
          } catch (renameError) {
            if (renameError?.code === "ENOENT") continue
            throw renameError
          }
          if (fsApi.readdirSync(emptyRecoveryPath).length !== 0) fail("LEDGER_UNTRUSTED", "empty mutation lock changed during recovery")
          fsApi.rmdirSync(emptyRecoveryPath)
          sync(root)
          continue
        }
        if (!retainedHolder || retainedEntries.length !== 1 || retainedEntries[0] !== "holder.json" || holderIsAlive(retainedHolder)) {
          fail("LEDGER_MUTATION_LOCKED", "standing ledger mutation is already in progress")
        }
        const recoveryPath = path.join(root, `mutation-recovery-${crypto.randomUUID()}`)
        try {
          fsApi.renameSync(mutationLockPath, recoveryPath)
        } catch (renameError) {
          if (renameError?.code === "ENOENT") continue
          throw renameError
        }
        fsApi.unlinkSync(path.join(recoveryPath, "holder.json"))
        fsApi.rmdirSync(recoveryPath)
        sync(root)
      }
    }
    if (!acquired) fail("LEDGER_MUTATION_LOCKED", "standing ledger mutation lock could not be acquired")
    try {
      return await action()
    } finally {
      const releasePath = path.join(root, `mutation-release-${crypto.randomUUID()}`)
      fsApi.renameSync(mutationLockPath, releasePath)
      sync(root)
      fsApi.unlinkSync(path.join(releasePath, "holder.json"))
      fsApi.rmdirSync(releasePath)
      sync(root)
    }
  }

  const nodeMutationLockPath = path.join(nodeLeaseRoot, "resident-aegis-mutation.lock")
  const nodeMutationHolderPath = path.join(nodeMutationLockPath, "holder.json")
  const withNodeMutationLock = async (action, occupiedValue) => {
    let acquired = false
    for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
      const candidatePath = path.join(nodeLeaseRoot, `node-mutation-candidate-${crypto.randomUUID()}`)
      const candidateHolderPath = path.join(candidatePath, "holder.json")
      try {
        fsApi.mkdirSync(candidatePath, { mode: 0o700 })
        writeExclusiveWith(fsApi, candidateHolderPath, holderIdentity(), sync)
        sync(candidatePath)
        fsApi.renameSync(candidatePath, nodeMutationLockPath)
        sync(nodeLeaseRoot)
        acquired = true
      } catch (error) {
        if (fsApi.existsSync(candidateHolderPath)) fsApi.unlinkSync(candidateHolderPath)
        if (fsApi.existsSync(candidatePath)) fsApi.rmdirSync(candidatePath)
        if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error
        if (!fsApi.existsSync(nodeMutationLockPath)) continue
        const lockStats = fsApi.lstatSync(nodeMutationLockPath)
        if (!validateDirectory(lockStats, uid)) fail("LEDGER_UNTRUSTED", "shared AEGIS mutation lock is not private")
        const retainedHolder = readLedgerWith(fsApi, nodeMutationHolderPath, uid, validateFile)
        const entries = fsApi.readdirSync(nodeMutationLockPath)
        if (!retainedHolder && entries.length === 0) {
          const emptyRecoveryPath = path.join(nodeLeaseRoot, `node-mutation-recovery-${crypto.randomUUID()}`)
          try { fsApi.renameSync(nodeMutationLockPath, emptyRecoveryPath) } catch (renameError) {
            if (renameError?.code === "ENOENT") continue
            throw renameError
          }
          if (fsApi.readdirSync(emptyRecoveryPath).length !== 0) fail("LEDGER_UNTRUSTED", "empty shared mutation lock changed during recovery")
          fsApi.rmdirSync(emptyRecoveryPath)
          sync(nodeLeaseRoot)
          continue
        }
        if (!retainedHolder || entries.length !== 1 || entries[0] !== "holder.json") {
          fail("LEDGER_UNTRUSTED", "shared AEGIS mutation lock is invalid")
        }
        if (holderIsAlive(retainedHolder)) return occupiedValue
        const recoveryPath = path.join(nodeLeaseRoot, `node-mutation-recovery-${crypto.randomUUID()}`)
        try { fsApi.renameSync(nodeMutationLockPath, recoveryPath) } catch (renameError) {
          if (renameError?.code === "ENOENT") continue
          throw renameError
        }
        const movedHolder = readLedgerWith(fsApi, path.join(recoveryPath, "holder.json"), uid, validateFile)
        if (canonical(movedHolder) !== canonical(retainedHolder)) fail("LEDGER_UNTRUSTED", "shared AEGIS mutation holder changed during recovery")
        fsApi.unlinkSync(path.join(recoveryPath, "holder.json"))
        fsApi.rmdirSync(recoveryPath)
        sync(nodeLeaseRoot)
      }
    }
    if (!acquired) return occupiedValue
    try {
      return await action()
    } finally {
      const releasePath = path.join(nodeLeaseRoot, `node-mutation-release-${crypto.randomUUID()}`)
      fsApi.renameSync(nodeMutationLockPath, releasePath)
      sync(nodeLeaseRoot)
      fsApi.unlinkSync(path.join(releasePath, "holder.json"))
      fsApi.rmdirSync(releasePath)
      sync(nodeLeaseRoot)
    }
  }

  const journalEntries = () => {
    const entries = readJournal()
    if (!Array.isArray(entries)) fail("JOURNAL_UNTRUSTED", "standing journal response is invalid")
    return entries.map((entry) => {
      if (!entry || typeof entry !== "object" || !entry.record || !Number.isSafeInteger(entry.realtime_ms) || entry.realtime_ms <= 0
        || entry.uid !== uid || entry.identifier !== JOURNAL_IDENTIFIER) {
        fail("JOURNAL_UNTRUSTED", "standing journal entry is invalid")
      }
      return entry
    })
  }

  const ensureJournalEpoch = (admissionIssuedAt) => {
    const issuedAtMs = Date.parse(admissionIssuedAt)
    if (!Number.isFinite(issuedAtMs)) fail("ADMISSION_TIME_INVALID", "standing admission issue time is invalid")
    let entries = journalEntries()
    let epochs = entries.filter(({ record }) => record.record_type === "EPOCH" && record.epoch_id === JOURNAL_EPOCH_ID)
    if (epochs.length === 0) {
      const body = { record_type: "EPOCH", epoch_id: JOURNAL_EPOCH_ID, initialized_at: clock() }
      body.journal_record_sha256 = sha256(canonicalBytes(body))
      appendJournal(body)
      entries = journalEntries()
      epochs = entries.filter(({ record }) => record.record_type === "EPOCH" && record.epoch_id === JOURNAL_EPOCH_ID)
    }
    for (const { record } of epochs) {
      if (!recordDigestValid(record, "journal_record_sha256")) fail("JOURNAL_UNTRUSTED", "standing journal epoch is invalid")
    }
    if (!epochs.some(({ realtime_ms }) => realtime_ms < issuedAtMs)) {
      fail("JOURNAL_EPOCH_NOT_ESTABLISHED", "a retained replay epoch must predate the reviewed admission")
    }
    return entries
  }

  const claimAdmission = async (binding) => withMutationLock(async () => {
    const key = sha256(canonicalBytes({ authority_id: binding.authority_id, admission_id: binding.admission_id, admission_sha256: binding.admission_sha256 }))
    const body = { schema_version: "1.0-aegis-standing-claim", ...binding, claim_key_sha256: key, claimed_at: clock() }
    body.claim_record_sha256 = sha256(canonicalBytes(body))
    const filePath = path.join(root, `claim-${key}.json`)
    const journalClaims = ensureJournalEpoch(binding.admission_issued_at)
      .map(({ record }) => record)
      .filter((record) => record?.record_type === "CLAIM" && record.claim_key_sha256 === key)
    for (const retained of journalClaims) {
      if (!recordDigestValid(retained, "journal_record_sha256")
        || retained.admission_sha256 !== binding.admission_sha256
        || retained.request_binding_sha256 !== binding.request_binding_sha256) {
        fail("JOURNAL_UNTRUSTED", "retained journal claim is invalid")
      }
    }
    if (journalClaims.length > 0) {
      const local = readLedgerWith(fsApi, filePath, uid, validateFile)
      if (local && (!recordDigestValid(local, "claim_record_sha256")
        || local.claim_key_sha256 !== key
        || local.admission_sha256 !== binding.admission_sha256
        || local.request_binding_sha256 !== binding.request_binding_sha256)) {
        fail("LEDGER_UNTRUSTED", "local claim conflicts with the privileged journal")
      }
      return { claimed: false, ...binding, claimed_at: journalClaims[0].claimed_at }
    }
    try { writeExclusiveWith(fsApi, filePath, body, sync) } catch (error) {
      if (error?.code !== "EEXIST") throw error
      const retained = readLedgerWith(fsApi, filePath, uid, validateFile)
      if (!recordDigestValid(retained, "claim_record_sha256") || retained.claim_key_sha256 !== key
        || retained.claim_id !== binding.claim_id || retained.request_binding_sha256 !== binding.request_binding_sha256) {
        fail("LEDGER_UNTRUSTED", "retained standing claim is invalid")
      }
      lastClaim = retained
      fail("JOURNAL_UNTRUSTED", "local claim exists without its independently retained journal claim")
    }
    const journalBody = { record_type: "CLAIM", claim_key_sha256: key, admission_sha256: binding.admission_sha256, request_binding_sha256: binding.request_binding_sha256, claimed_at: body.claimed_at }
    journalBody.journal_record_sha256 = sha256(canonicalBytes(journalBody))
    appendJournal(journalBody)
    const confirmed = journalEntries().map(({ record }) => record)
      .filter((record) => record?.record_type === "CLAIM" && record.claim_key_sha256 === key)
    if (confirmed.length !== 1 || !recordDigestValid(confirmed[0], "journal_record_sha256")
      || confirmed[0].admission_sha256 !== binding.admission_sha256
      || confirmed[0].request_binding_sha256 !== binding.request_binding_sha256) {
      fail("JOURNAL_UNTRUSTED", "standing claim was not durably retained by the privileged journal")
    }
    lastClaim = body
    return { claimed: true, ...binding, claimed_at: body.claimed_at }
  })

  const activePath = nodeLeasePath
  const remoteLeaseValid = (lease) => {
    const { lease_sha256: retainedLeaseSha256, ...leaseBody } = lease ?? {}
    return lease?.schema_version === "0.1-resident-aegis-runtime-lease"
      && exactRecordKeys(lease, ["schema_version", "lease_id", "claim_id", "acquired_at", "holder", "lease_sha256"])
      && /^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/.test(lease.lease_id ?? "")
      && /^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/.test(lease.claim_id ?? "")
      && exactRecordKeys(lease.holder, ["pid", "boot_id", "process_start_ticks"])
      && typeof lease.holder === "object" && Number.isSafeInteger(lease.holder.pid) && lease.holder.pid > 0
      && typeof lease.holder.boot_id === "string" && typeof lease.holder.process_start_ticks === "string"
      && retainedLeaseSha256 === sha256(canonicalBytes(leaseBody))
  }
  const retireActiveLease = (active, label) => {
    safeId(active.lease_id, "lease_id")
    const retiredPath = path.join(nodeLeaseRoot, `retired-${active.lease_id}-${crypto.randomUUID()}.json`)
    fsApi.renameSync(activePath, retiredPath)
    const retired = readLedgerWith(fsApi, retiredPath, uid, validateFile)
    if (canonical(retired) !== canonical(active)) fail("LEDGER_UNTRUSTED", `active AEGIS lease changed before ${label}`)
    fsApi.unlinkSync(retiredPath)
    sync(nodeLeaseRoot)
  }
  const recoverRemoteLease = (active) => {
    if (holderIsAlive(active.holder)) return false
    const acquiredAtMs = Date.parse(active.acquired_at)
    const recoveredAt = clock()
    const recoveredAtMs = Date.parse(recoveredAt)
    if (!Number.isFinite(acquiredAtMs) || new Date(acquiredAtMs).toISOString() !== active.acquired_at
      || !Number.isFinite(recoveredAtMs) || new Date(recoveredAtMs).toISOString() !== recoveredAt
      || recoveredAtMs < acquiredAtMs) {
      fail("LEDGER_UNTRUSTED", "dead remote lease chronology is invalid")
    }
    const body = {
      schema_version: "1.0-aegis-shared-remote-lease-recovery",
      lease_id: active.lease_id,
      claim_id: active.claim_id,
      lease_sha256: active.lease_sha256,
      recovered_at: recoveredAt,
      reason: "PROVEN_DEAD_REMOTE_HOLDER",
      execution_authority_created: false,
    }
    body.recovery_sha256 = sha256(canonicalBytes(body))
    const recoveryPath = path.join(nodeLeaseRoot, `remote-recovery-${active.lease_id}.json`)
    try { writeExclusiveWith(fsApi, recoveryPath, body, sync) } catch (error) {
      if (error?.code !== "EEXIST") throw error
      const retained = readLedgerWith(fsApi, recoveryPath, uid, validateFile)
      const retainedAtMs = Date.parse(retained?.recovered_at)
      if (!exactRecordKeys(retained, ["schema_version", "lease_id", "claim_id", "lease_sha256", "recovered_at", "reason", "execution_authority_created", "recovery_sha256"])
        || retained.schema_version !== body.schema_version || !recordDigestValid(retained, "recovery_sha256")
        || retained.lease_id !== body.lease_id || retained.claim_id !== body.claim_id
        || retained.lease_sha256 !== body.lease_sha256 || retained.reason !== body.reason
        || retained.execution_authority_created !== false || !Number.isFinite(retainedAtMs)
        || new Date(retainedAtMs).toISOString() !== retained.recovered_at
        || retainedAtMs < acquiredAtMs || retainedAtMs > recoveredAtMs) {
        fail("LEDGER_UNTRUSTED", "retained remote recovery does not bind the exact dead lease")
      }
    }
    retireActiveLease(active, "remote recovery")
    return true
  }
  const reconcile = () => {
    const active = readLedgerWith(fsApi, activePath, uid, validateFile)
    if (!active) return true
    if (active.schema_version === "0.1-resident-aegis-runtime-lease") {
      if (!remoteLeaseValid(active)) fail("LEDGER_UNTRUSTED", "active remote-development lease is invalid")
      return recoverRemoteLease(active)
    }
    if (!recordDigestValid(active, "lease_record_sha256")) fail("LEDGER_UNTRUSTED", "active standing lease is invalid")
    if (holderIsAlive(active.holder)) return false
    const acquiredAt = Date.parse(active.acquired_at)
    const recoveredAt = clock()
    const recoveredAtMs = Date.parse(recoveredAt)
    if (!Number.isFinite(acquiredAt) || new Date(acquiredAt).toISOString() !== active.acquired_at
      || !Number.isFinite(recoveredAtMs) || new Date(recoveredAtMs).toISOString() !== recoveredAt
      || recoveredAtMs < acquiredAt) {
      fail("LEDGER_UNTRUSTED", "dead lease chronology is invalid")
    }
    const recovery = { schema_version: "1.0-aegis-standing-lease-recovery", lease_id: active.lease_id, fencing_token: active.fencing_token, lease_record_sha256: active.lease_record_sha256, recovered_at: recoveredAt, reason: "PROVEN_DEAD_HOLDER" }
    recovery.recovery_sha256 = sha256(canonicalBytes(recovery))
    const recoveryPath = ledgerRecordPath(root, "recovery", active.lease_id, "lease_id")
    try {
      writeExclusiveWith(fsApi, recoveryPath, recovery, sync)
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
      const retainedRecovery = readLedgerWith(fsApi, recoveryPath, uid, validateFile)
      const retainedRecoveredAt = Date.parse(retainedRecovery?.recovered_at)
      if (!exactRecordKeys(retainedRecovery, ["schema_version", "lease_id", "fencing_token", "lease_record_sha256", "recovered_at", "reason", "recovery_sha256"])
        || retainedRecovery.schema_version !== "1.0-aegis-standing-lease-recovery"
        || !recordDigestValid(retainedRecovery, "recovery_sha256")
        || retainedRecovery.lease_id !== recovery.lease_id
        || retainedRecovery.fencing_token !== recovery.fencing_token
        || retainedRecovery.lease_record_sha256 !== recovery.lease_record_sha256
        || retainedRecovery.reason !== recovery.reason
        || !Number.isFinite(retainedRecoveredAt) || new Date(retainedRecoveredAt).toISOString() !== retainedRecovery.recovered_at
        || retainedRecoveredAt < acquiredAt || retainedRecoveredAt > recoveredAtMs) {
        fail("LEDGER_UNTRUSTED", "retained recovery does not bind the exact dead lease")
      }
    }
    retireActiveLease(active, "standing recovery")
    return true
  }

  const reconcileNodeLease = async () => withMutationLock(async () => withNodeMutationLock(async () => ({
    available: reconcile(),
  }), { available: false }))

  const acquireLease = async (binding) => withMutationLock(async () => {
    safeId(binding.lease_id, "lease_id")
    safeId(binding.admission_id, "admission_id")
    const acquiredAt = clock()
    const body = { schema_version: "1.0-aegis-standing-lease", ...binding, acquired_at: acquiredAt, holder: holderIdentity() }
    body.lease_record_sha256 = sha256(canonicalBytes(body))
    const acquired = await withNodeMutationLock(async () => {
      if (!reconcile()) return false
      try { writeExclusiveWith(fsApi, activePath, body, sync) } catch (error) {
        if (error?.code === "EEXIST") return false
        throw error
      }
      const usedFences = fsApi.readdirSync(root)
        .map((name) => /^fence-(\d+)\.json$/.exec(name))
        .filter(Boolean)
        .map((match) => Number(match[1]))
      const highestFence = usedFences.length ? Math.max(...usedFences) : 0
      if (!Number.isSafeInteger(binding.fencing_token) || binding.fencing_token <= highestFence) {
        retireActiveLease(body, "fencing rejection")
        fail("FENCING_REPLAY", "standing lease fencing token is not strictly increasing")
      }
      const fence = {
        schema_version: "1.0-aegis-standing-fence",
        fencing_token: binding.fencing_token,
        lease_id: binding.lease_id,
        admission_id: binding.admission_id,
        recorded_at: acquiredAt,
      }
      fence.fence_sha256 = sha256(canonicalBytes(fence))
      try {
        writeExclusiveWith(fsApi, path.join(root, `fence-${binding.fencing_token}.json`), fence, sync)
      } catch (error) {
        retireActiveLease(body, "fencing failure")
        if (error?.code === "EEXIST") fail("FENCING_REPLAY", "standing lease fencing token was already used")
        throw error
      }
      return true
    }, false)
    if (!acquired) return { acquired: false, ...binding, acquired_at: acquiredAt }
    lastLease = body
    return { acquired: true, ...binding, acquired_at: acquiredAt }
  })

  const persistClaimFailure = async (evidence) => withMutationLock(async () => {
    if (!DIGEST.test(evidence?.evidence_sha256 ?? "") || evidence?.status !== "FAILED_CLOSED" || evidence?.lease !== null) {
      fail("EVIDENCE_INVALID", "claim-only failure evidence is invalid")
    }
    if (!recordDigestValid(evidence, "evidence_sha256")) {
      fail("EVIDENCE_INVALID", "claim-only failure evidence digest does not match its payload")
    }
    const key = sha256(canonicalBytes({
      authority_id: evidence.authority_id,
      admission_id: evidence.admission?.admission_id,
      admission_sha256: evidence.admission?.admission_sha256,
    }))
    const claimPath = path.join(root, `claim-${key}.json`)
    const retainedClaim = readLedgerWith(fsApi, claimPath, uid, validateFile)
    if (!recordDigestValid(retainedClaim, "claim_record_sha256")
      || retainedClaim.claim_id !== evidence.claim?.claim_id
      || retainedClaim.claimed_at !== evidence.claim?.claimed_at
      || retainedClaim.request_binding_sha256 !== evidence.request_binding_sha256) {
      fail("LEDGER_UNTRUSTED", "claim-only failure does not bind a durable admission claim")
    }
    const filePath = ledgerRecordPath(root, "result", evidence.admission.admission_id, "admission_id")
    try { writeExclusiveWith(fsApi, filePath, evidence, sync) } catch (error) {
      if (error?.code !== "EEXIST") throw error
      const retained = readLedgerWith(fsApi, filePath, uid, validateFile)
      if (retained?.evidence_sha256 !== evidence.evidence_sha256 || canonical(retained) !== canonical(evidence)) {
        fail("LEDGER_UNTRUSTED", "retained claim-only failure evidence differs")
      }
      lastClaimFailure = retained
      return { persisted: true, evidence_sha256: retained.evidence_sha256 }
    }
    lastClaimFailure = evidence
    return { persisted: true, evidence_sha256: evidence.evidence_sha256 }
  })

  const persistResult = async (evidence) => withMutationLock(async () => {
    if (!DIGEST.test(evidence?.evidence_sha256 ?? "") || !recordDigestValid(evidence, "evidence_sha256")) {
      fail("EVIDENCE_INVALID", "completion evidence digest is invalid")
    }
    const active = readLedgerWith(fsApi, activePath, uid, validateFile)
    if (!recordDigestValid(active, "lease_record_sha256")) fail("LEDGER_UNTRUSTED", "completion has no valid active lease")
    if (evidence.authority_sha256 !== active.authority_sha256
      || evidence.admission?.admission_id !== active.admission_id
      || evidence.admission?.admission_sha256 !== active.admission_sha256
      || evidence.claim?.claim_id !== active.claim_id
      || evidence.lease?.lease_id !== active.lease_id
      || evidence.lease?.fencing_token !== active.fencing_token
      || evidence.request_binding_sha256 !== active.request_binding_sha256) {
      fail("EVIDENCE_BINDING_MISMATCH", "completion evidence does not bind the active standing lease")
    }
    const filePath = ledgerRecordPath(root, "result", evidence.admission.admission_id, "admission_id")
    try { writeExclusiveWith(fsApi, filePath, evidence, sync) } catch (error) {
      if (error?.code !== "EEXIST") throw error
      const retained = readLedgerWith(fsApi, filePath, uid, validateFile)
      if (retained?.evidence_sha256 !== evidence.evidence_sha256 || canonical(retained) !== canonical(evidence)) fail("LEDGER_UNTRUSTED", "retained completion evidence differs")
      lastResult = retained
      return { persisted: true, evidence_sha256: retained.evidence_sha256 }
    }
    lastResult = evidence
    return { persisted: true, evidence_sha256: evidence.evidence_sha256 }
  })

  const releaseLease = async (binding) => withMutationLock(async () => withNodeMutationLock(async () => {
    const active = readLedgerWith(fsApi, activePath, uid, validateFile)
    if (!recordDigestValid(active, "lease_record_sha256")) fail("LEDGER_UNTRUSTED", "active standing lease is invalid")
    if (active.lease_id !== binding.lease_id || active.claim_id !== binding.claim_id) fail("LEASE_BINDING_MISMATCH", "release does not match the active lease")
    if (active.fencing_token !== binding.fencing_token) fail("LEASE_FENCE_MISMATCH", "release fencing token does not match the active lease")
    const retainedResult = readLedgerWith(fsApi, ledgerRecordPath(root, "result", active.admission_id, "admission_id"), uid, validateFile)
    if (!retainedResult) fail("RESULT_REQUIRED", "immutable completion evidence is required before lease release")
    if (!recordDigestValid(retainedResult, "evidence_sha256") || retainedResult.authority_sha256 !== active.authority_sha256
      || retainedResult.admission?.admission_id !== active.admission_id
      || retainedResult.admission?.admission_sha256 !== active.admission_sha256
      || retainedResult.claim?.claim_id !== active.claim_id
      || retainedResult.lease?.lease_id !== active.lease_id
      || retainedResult.lease?.fencing_token !== active.fencing_token
      || retainedResult.request_binding_sha256 !== active.request_binding_sha256) {
      fail("LEDGER_UNTRUSTED", "retained completion evidence does not bind the active lease")
    }
    const body = { schema_version: "1.0-aegis-standing-lease-release", lease_id: binding.lease_id, fencing_token: binding.fencing_token, claim_id: binding.claim_id, lease_record_sha256: active.lease_record_sha256, released_at: clock() }
    body.release_sha256 = sha256(canonicalBytes(body))
    const releasePath = ledgerRecordPath(root, "release", binding.lease_id, "lease_id")
    try { writeExclusiveWith(fsApi, releasePath, body, sync) } catch (error) {
      if (error?.code !== "EEXIST") throw error
      const retainedRelease = readLedgerWith(fsApi, releasePath, uid, validateFile)
      if (!recordDigestValid(retainedRelease, "release_sha256")
        || retainedRelease.lease_id !== body.lease_id
        || retainedRelease.fencing_token !== body.fencing_token
        || retainedRelease.claim_id !== body.claim_id
        || retainedRelease.lease_record_sha256 !== body.lease_record_sha256) {
        fail("LEDGER_UNTRUSTED", "retained release does not bind the exact lease")
      }
    }
    retireActiveLease(active, "standing release")
    lastRelease = body
    return { released: true, ...binding }
  }, { released: false, ...binding }))

  return {
    ledgerRoot: root,
    claimAdmission,
    persistClaimFailure,
    reconcileNodeLease,
    acquireLease,
    persistResult,
    releaseLease,
    runtimeEvidence: () => ({ claim_sha256: lastClaim?.claim_record_sha256 ?? null, lease_sha256: lastLease?.lease_record_sha256 ?? null, result_sha256: lastResult?.evidence_sha256 ?? lastClaimFailure?.evidence_sha256 ?? null, release_sha256: lastRelease?.release_sha256 ?? null }),
  }
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) } catch { fail("ARTIFACT_INVALID", `${label} is not valid JSON`) }
}

export async function runResidentAegisStandingHash(argv = process.argv.slice(2)) {
  const args = parseStandingArguments(argv)
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() <= 0
    || os.userInfo().username !== "williamos-fabric" || os.hostname().toLowerCase() !== "aegis") {
    fail("EXECUTION_IDENTITY_MISMATCH", "resident standing adapter requires the reviewed AEGIS non-root identity")
  }
  const requestBytes = readPrivateStandingRequest(args.request)
  const admissionBytes = readStandingArtifact(args.admission)
  const request = parseJson(requestBytes, "request")
  const candidateAdmission = parseJson(admissionBytes, "admission")
  const authority = parseJson(readTrustedClosureFile(fs, REPOSITORY_ROOT, "config/execution-fabric/aegis-standing-compute-authority.v1.json"), "authority")
  const residentIdentity = readResidentMachineIdentity()
  if (residentIdentity.machine_id_sha256 !== authority.node_identity?.machine_id_sha256) {
    fail("EXECUTION_IDENTITY_MISMATCH", "resident machine identity does not match the standing AEGIS authority")
  }
  const inputPath = `${REPORT_ROOT}/${request.input?.relative_path ?? ""}`
  if (!inputPath.startsWith(`${INPUT_ROOT}/`)) fail("PATH_ESCAPE", "request input is outside the fixed standing input root")
  const trusted = createStandingTrustedProof({ admissionPath: args.admission, inputPath, sourceCommit: request.source?.commit_sha, authority })
  const ledger = createStandingLedgerProviders()
  const completion = await executeAegisStandingHash({
    authority,
    request,
    candidateAdmission,
    now: () => Date.now(),
    claimAdmission: ledger.claimAdmission,
    persistClaimFailure: ledger.persistClaimFailure,
    acquireLease: ledger.acquireLease,
    releaseLease: ledger.releaseLease,
    persistResult: ledger.persistResult,
    readInput: async () => readStandingArtifact(inputPath, { repositoryRoot: REPOSITORY_ROOT, requiredRoot: INPUT_ROOT }),
  })
  const evidence = { schema_version: "1.0-aegis-standing-resident-evidence", resident_identity: residentIdentity, trusted_main: trusted, completion, runtime_evidence: ledger.runtimeEvidence(), scheduler_activated: false, autonomous_selection: false }
  return { ...evidence, runner_evidence_sha256: sha256(canonicalBytes(evidence)) }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  runResidentAegisStandingHash().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ schema_version: "1.0-aegis-standing-runner-error", status: "FAILED_CLOSED", code: error?.code ?? "AEGIS_STANDING_RUNNER_FAILED", detail: String(error?.message ?? error), execution_authorized: false, scheduler_activated: false, autonomous_selection: false, network_accessed: false }, null, 2)}\n`)
    process.exitCode = 2
  })
}
