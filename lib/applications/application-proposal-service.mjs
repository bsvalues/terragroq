import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { ResidentModelExecutionBackend } from "../../scripts/hermes-bridge/execution-backend.mjs"
import {
  applicationManifestDigestValue,
  catalogApplicationBinding,
  isApplicationId,
  isCatalogApplication,
  parseApplicationManifestValue,
} from "./application-identity.mjs"
import { applicationCerebrasCapability, runCerebrasApplicationTurn } from "./cerebras-turn.mjs"
import { resolveApplicationExecutionRoute } from "./execution-routing.mjs"
import { createProposalEngine } from "./proposal-engine.mjs"
import { readBoundedRegularFile } from "./proposal-artifacts.mjs"
import {
  assertApplicationProposalCreateCapacity,
  bindApplicationProposalCreateCandidate,
  bindApplicationProposalCreatePublication,
  applicationProposalCreateIntentOwnerAlive,
  deactivateApplicationProposalCreateIntent,
  hasApplicationProposalCreateIntentEntries,
  listApplicationProposalCreateIntents,
  publishApplicationProposalCreateIntent,
  releaseApplicationProposalCreateIntent,
  removeApplicationProposalCreateArtifact,
  removeApplicationProposalCreateScratch,
  removeApplicationProposalCreateWriteResidues,
} from "./proposal-create-journal.mjs"
import { runGovernedResidentChangeTransaction } from "./proposal-resident-change.mjs"
import {
  deleteOwnedProposalBranch,
  runGovernedApplyLifecycle,
  runGovernedApplyTransaction,
  runGovernedCreateTransaction,
  runGovernedRejectLifecycle,
} from "./proposal-transaction-core.mjs"
import { assertApplicationProposalRuntimePath, resolveApplicationProposalRuntimeRoot } from "./proposal-runtime-root.mjs"
import {
  acquireApplicationRepositoryLock,
  applicationRepositoryLockIdentity,
  reconcileTerminalApplicationRepositoryLock,
  releaseApplicationRepositoryLock,
  withApplicationRepositoryRecoveryClaim,
} from "./proposal-repository-lock.mjs"
import { assertProposalSecretFree } from "./proposal-secrets.mjs"
import {
  assertResidentProposalRuntimePolicy,
  readResidentProposalEvidence,
  readResidentProposalPolicy,
} from "./resident-proposal-turn.mjs"
import {
  assertApplicationProposalWorkspace,
  validateApplicationProposalInContainer,
} from "./proposal-validation.mjs"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{40,64}$/
const SHA256 = /^[0-9a-f]{64}$/
const TURN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HEAD_REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,239}$/
const MAX_PATCH_BYTES = 256 * 1024
const MAX_FILE_BYTES = 262_144
const MAX_TOTAL_BYTES = 1024 * 1024
const MAX_MANIFEST_BYTES = 8 * 1024
const MAX_RECEIPT_BYTES = 128 * 1024
const MAX_REJECTION_REASON_LENGTH = 500
const VALIDATION_COMMAND = "node --test test/application.test.mjs"
const PROGRESS = Object.freeze([
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated application workspace ready"],
  ["resident_started", "HERMES AI is editing the isolated application workspace"],
  ["resident_finished", "HERMES AI editing finished"],
  ["validation_started", "Contained application validation started"],
  ["ready_for_review", "Application proposal ready for review"],
])
const EXTERNAL_PROGRESS = Object.freeze([
  ["accepted", "Request accepted"],
  ["workspace_ready", "Isolated application workspace ready"],
  ["resident_started", "HERMES sent the bounded application request to Cerebras"],
  ["resident_finished", "Cerebras returned a bounded application change"],
  ["validation_started", "Contained application validation started"],
  ["ready_for_review", "Application proposal ready for review"],
])

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex")
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const normalizedRoot = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value)
const samePath = (left, right) => normalizedRoot(left) === normalizedRoot(right)
const filePath = (root, relative) => path.join(root, ...relative.split("/"))
function assertUnlinkedPath(target, { allowMissing = false } = {}) {
  const absolute = path.resolve(target)
  const volume = path.parse(absolute).root
  let cursor = volume
  for (const segment of absolute.slice(volume.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error()
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") return
      throw new Error("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
    }
  }
}
function required(value, name) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new TypeError(`${name} is required`)
  return value.trim()
}

function requestedText(value) {
  if (typeof value !== "string") throw new Error("APPLICATION_PROPOSAL_REQUEST_INVALID")
  const result = value.trim()
  if (!result || result.length > 2_000 || result.includes("\0")) throw new Error("APPLICATION_PROPOSAL_REQUEST_INVALID")
  assertProposalSecretFree(result)
  return result
}

function rejectedBecause(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) {
    throw new Error("APPLICATION_PROPOSAL_REJECTION_INVALID")
  }
  const result = value.trim()
  if (!result || result.length > MAX_REJECTION_REASON_LENGTH) throw new Error("APPLICATION_PROPOSAL_REJECTION_INVALID")
  assertProposalSecretFree(result)
  return result
}

function assertFreshManifest(descriptor) {
  try {
    const target = regularFile(descriptor.repositoryRoot, ".williamos/application.json")
    const bytes = readBoundedRegularFile(target, {
      maxBytes: MAX_MANIFEST_BYTES,
      errorCode: "APPLICATION_PROPOSAL_MANIFEST_DRIFT",
    })
    if (!bytes.length) throw new Error()
    const fresh = parseApplicationManifestValue(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      descriptor.manifest.id,
    )
    if (JSON.stringify(fresh) !== JSON.stringify(descriptor.manifest)
      || applicationManifestDigestValue(fresh) !== descriptor.manifestDigest) throw new Error()
  } catch { throw new Error("APPLICATION_PROPOSAL_MANIFEST_DRIFT") }
}

function gitEnvironment(source = process.env, extra = {}) {
  const keys = ["PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
  const environment = Object.fromEntries(keys.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]))
  return {
    ...environment,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    ...extra,
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      cwd: options.cwd,
      env: options.env ?? gitEnvironment(),
      encoding: options.encoding ?? "utf8",
    windowsHide: true,
    shell: false,
    timeout: options.timeout ?? 60_000,
    maxBuffer: options.maxBuffer ?? 2_000_000,
    }, (error, stdout, stderr) => {
    if (error && !options.allowFailure) reject(new Error(options.errorCode ?? "APPLICATION_PROPOSAL_COMMAND_FAILED"))
    else {
      const numericCode = error && Number.isInteger(error.code) ? error.code : error ? -1 : 0
      resolve({ code: numericCode, executionFailure: !!error && numericCode === -1, stdout, stderr })
    }
    })
    if (options.input !== undefined) {
      child.stdin?.on("error", () => { /* process failure is reported by the exec callback */ })
      child.stdin?.end(options.input)
    }
  })
}

const git = (root, args, options = {}) => run("git", [
  "--no-replace-objects",
  "-c", "core.hooksPath=",
  "-c", "core.fsmonitor=false",
  "-C", root,
  ...args,
], options)

const validHeadRef = (value) => typeof value === "string" && HEAD_REF.test(value)
  && !value.includes("..") && !value.includes("//") && !value.includes("@{")
  && !value.endsWith(".") && !value.endsWith("/") && !value.endsWith(".lock")

async function symbolicHead(repository, errorCode = "APPLICATION_PROPOSAL_REPOSITORY_INVALID") {
  const result = await git(repository, ["symbolic-ref", "--quiet", "HEAD"], { allowFailure: true })
  const value = String(result.stdout).trim()
  if (result.code !== 0 || !validHeadRef(value)) {
    throw new Error(errorCode)
  }
  return value
}

async function assertRepositoryConfiguration(root) {
  const result = await git(root, ["config", "--show-origin", "--null", "--name-only", "--get-regexp", ".*"], { allowFailure: true })
  if (result.code !== 0) throw new Error("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
  const configured = result.stdout
  const fields = String(configured).split("\0").filter((entry) => entry.length > 0)
  if (fields.length % 2 !== 0) throw new Error("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
  for (let index = 0; index < fields.length; index += 2) {
    const origin = fields[index]
    const name = fields[index + 1]
    if (!name || /[\0\r\n]/.test(name)) throw new Error("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
    if (/^(?:alias\.|filter\.|diff\.|merge\.|include\.|includeif\.|gpg\.|credential\.|http\.|url\.|protocol\.|extensions\.|commit\.gpgsign$|tag\.gpgsign$|user\.signingkey$|core\.(?:attributesfile|excludesfile|fsmonitor|hookspath|sshcommand|worktree)$)/i.test(name)) {
      if (/^command line:/i.test(origin) && /^(?:core\.fsmonitor|core\.hookspath)$/i.test(name)) continue
      throw new Error("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
    }
  }
}

function assertGitAdminNode(target, kind, allowMissing = false) {
  try {
    assertUnlinkedPath(target, { allowMissing })
    const stat = fs.lstatSync(target, { bigint: true })
    if ((kind === "directory" ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink()
      || (kind === "file" && stat.nlink !== 1n) || !samePath(fs.realpathSync(target), target)) throw new Error()
    return true
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return false
    throw new Error("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
  }
}

function assertRepositoryReferenceTopology(descriptor, ref) {
  if (!validHeadRef(ref)) throw new Error("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
  const gitRoot = path.join(descriptor.repositoryRoot, ".git")
  const walk = (segments) => {
    let cursor = gitRoot
    for (let index = 0; index < segments.length; index++) {
      cursor = path.join(cursor, segments[index])
      const present = assertGitAdminNode(cursor, index === segments.length - 1 ? "file" : "directory", true)
      if (!present) return
    }
  }
  const refSegments = ref.split("/")
  walk(refSegments)
  if (fs.existsSync(path.join(gitRoot, "logs"))) walk(["logs", ...refSegments])
}

async function assertRepositoryTopology(descriptor, { verifyGitDirectories = true } = {}) {
  const root = descriptor.repositoryRoot
  const binding = catalogApplicationBinding(descriptor.application)
  try {
    assertUnlinkedPath(root)
    const rootStat = fs.lstatSync(root, { bigint: true })
    if (!binding || !rootStat.isDirectory() || !samePath(binding.repositoryRoot, root)
      || !samePath(fs.realpathSync(root), root)
      || (binding.dev !== undefined && binding.dev !== String(rootStat.dev))
      || (binding.ino !== undefined && binding.ino !== String(rootStat.ino))) throw new Error()
    const gitRoot = path.join(root, ".git")
    assertGitAdminNode(gitRoot, "directory")
    if (verifyGitDirectories) {
      const commonValue = (await git(root, ["rev-parse", "--git-common-dir"])).stdout.trim()
      const gitValue = (await git(root, ["rev-parse", "--git-dir"])).stdout.trim()
      const resolveAdmin = (value) => path.resolve(root, value)
      for (const admin of [resolveAdmin(commonValue), resolveAdmin(gitValue)]) {
        assertGitAdminNode(admin, "directory")
        if (!samePath(admin, gitRoot)) throw new Error()
      }
    }
    for (const directory of ["objects", "refs", "refs/heads"]) {
      assertGitAdminNode(path.join(gitRoot, ...directory.split("/")), "directory")
    }
    for (const optional of ["worktrees", "refs/tags", "logs", "logs/refs", "logs/refs/heads"]) {
      assertGitAdminNode(path.join(gitRoot, ...optional.split("/")), "directory", true)
    }
    for (const file of ["HEAD", "config", "index"]) assertGitAdminNode(path.join(gitRoot, file), "file")
    for (const optional of ["packed-refs", "config.worktree"]) {
      assertGitAdminNode(path.join(gitRoot, optional), "file", true)
    }
    for (const alternates of ["objects/info/alternates", "objects/info/http-alternates"]) {
      if (fs.existsSync(path.join(gitRoot, ...alternates.split("/")))) throw new Error()
    }
    for (const name of fs.readdirSync(path.join(gitRoot, "objects"))) {
      if (/^[0-9a-f]{2}$/.test(name) || ["info", "pack"].includes(name)) {
        assertGitAdminNode(path.join(gitRoot, "objects", name), "directory")
      }
    }
    // Proposal branches always live below this namespace. Guard its existing
    // parents before `worktree add -b` can ask Git to create the leaf ref.
    assertRepositoryReferenceTopology(descriptor, "refs/heads/codex/williamos-app-boundary")
  } catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_REPOSITORY_INVALID") throw error
    throw new Error("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
  }
}

function applicationDescriptor(application) {
  if (!isCatalogApplication(application)) {
    throw new Error("APPLICATION_PROPOSAL_MANIFEST_INVALID")
  }
  let manifest
  try { manifest = parseApplicationManifestValue(application.manifest, application.manifest?.id) }
  catch { throw new Error("APPLICATION_PROPOSAL_MANIFEST_INVALID") }
  if (typeof application.manifestDigest !== "string" || !SHA256.test(application.manifestDigest)
    || application.manifestDigest !== applicationManifestDigestValue(manifest)
    || typeof application.repositoryRoot !== "string" || !path.isAbsolute(application.repositoryRoot)
    || !SHA.test(application.head)) throw new Error("APPLICATION_PROPOSAL_MANIFEST_INVALID")
  let repositoryRoot
  try {
    const binding = catalogApplicationBinding(application)
    repositoryRoot = path.resolve(application.repositoryRoot)
    assertUnlinkedPath(repositoryRoot)
    const identity = fs.lstatSync(repositoryRoot, { bigint: true })
    if (!binding || !samePath(binding.repositoryRoot, repositoryRoot)
      || !samePath(fs.realpathSync(repositoryRoot), repositoryRoot) || !identity.isDirectory()
      || (binding.dev !== undefined && binding.dev !== String(identity.dev))
      || (binding.ino !== undefined && binding.ino !== String(identity.ino))) throw new Error()
  } catch { throw new Error("APPLICATION_PROPOSAL_REPOSITORY_INVALID") }
  const engine = createProposalEngine({
    applicationId: manifest.id,
    displayName: manifest.displayName,
    allowedPaths: manifest.ai.writablePaths,
    validationPaths: [...manifest.ai.writablePaths, manifest.source.test],
    validationCommand: VALIDATION_COMMAND,
    namespace: `application-proposals/${manifest.id}`,
    receiptSchemaVersion: 4,
  })
  const descriptor = Object.freeze({
    application,
    manifest,
    manifestDigest: application.manifestDigest,
    repositoryRoot,
    repositoryDigest: applicationRepositoryLockIdentity(repositoryRoot),
    head: application.head,
    engine,
    boundPaths: Object.freeze([".williamos/application.json", ...engine.validationPaths]),
  })
  assertFreshManifest(descriptor)
  return descriptor
}

async function canonicalRepository(descriptor) {
  try {
    const top = (await git(descriptor.repositoryRoot, ["rev-parse", "--show-toplevel"])).stdout.trim()
    if (!samePath(fs.realpathSync(top), descriptor.repositoryRoot)) throw new Error()
    await assertRepositoryConfiguration(descriptor.repositoryRoot)
    await assertRepositoryTopology(descriptor)
    return descriptor.repositoryRoot
  } catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_REPOSITORY_INVALID") throw error
    throw new Error("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
  }
}

async function assertCanonicalRepositoryBoundary(descriptor) {
  await canonicalRepository(descriptor)
}

function runtimePaths(runtimeRoot, applicationId, proposalId) {
  if (!path.isAbsolute(runtimeRoot) || !isApplicationId(applicationId) || !UUID.test(proposalId)) {
    throw new Error("APPLICATION_PROPOSAL_ID_INVALID")
  }
  const runtime = resolveApplicationProposalRuntimeRoot(runtimeRoot)
  const root = assertApplicationProposalRuntimePath(
    runtime,
    path.join(runtime, "application-proposals", applicationId),
    { allowMissing: true },
  )
  return {
    runtime,
    root,
    receipt: path.join(root, `${proposalId}.json`),
    patch: path.join(root, `${proposalId}.patch`),
    quarantine: path.join(root, `${proposalId}.quarantine.json`),
  }
}

function assertRuntimeRoot(runtimeRoot, repositoryRoot) {
  return resolveApplicationProposalRuntimeRoot(runtimeRoot, repositoryRoot)
}

function applicationProposalWorktreesRoot(runtimeRoot) {
  const root = resolveApplicationProposalRuntimeRoot(runtimeRoot)
  const worktrees = assertApplicationProposalRuntimePath(root, path.join(root, "worktrees"), { allowMissing: true })
  fs.mkdirSync(worktrees, { recursive: true })
  return assertApplicationProposalRuntimePath(root, worktrees)
}

function applicationProposalWorkspace(runtimeRoot, name) {
  const worktrees = applicationProposalWorktreesRoot(runtimeRoot)
  return assertApplicationProposalRuntimePath(runtimeRoot, path.join(worktrees, name), { allowMissing: true })
}

function atomicWrite(target, content, runtimeRoot, expectedBytes) {
  const directory = path.dirname(target)
  fs.mkdirSync(directory, { recursive: true })
  assertApplicationProposalRuntimePath(runtimeRoot, directory)
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, content, { flag: "wx" })
    const descriptor = fs.openSync(temporary, "r+")
    try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
    assertApplicationProposalRuntimePath(runtimeRoot, directory)
    if (expectedBytes !== undefined) {
      let actual
      try { actual = fs.readFileSync(target) } catch { throw new Error("APPLICATION_PROPOSAL_RECEIPT_CHANGED") }
      if (!Buffer.isBuffer(expectedBytes) || !actual.equals(expectedBytes)) {
        throw new Error("APPLICATION_PROPOSAL_RECEIPT_CHANGED")
      }
    }
    fs.renameSync(temporary, target)
  } finally { try { fs.rmSync(temporary, { force: true }) } catch { /* rename may have completed */ } }
}

const writeReceipt = (target, value, runtimeRoot, expectedBytes) => atomicWrite(
  target,
  `${JSON.stringify(value, null, 2)}\n`,
  runtimeRoot,
  expectedBytes,
)

function timestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function validationResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== ["command", "output", "status"].sort().join(",")
    || value.status !== "passed" || value.command !== VALIDATION_COMMAND
    || typeof value.output !== "string" || value.output.length > 12_000) {
    throw new Error("APPLICATION_PROPOSAL_VALIDATION_FAILED")
  }
  assertProposalSecretFree(value)
  return value
}

function validProviderExecution(value, model, executionNode) {
  const keys = ["route", "provider", "bridgeNode", "inferenceNode", "mode", "requestedModel", "actualModel",
    "externalEgress", "promptTokens", "completionTokens", "totalTokens", "calculatedCostUsd", "maxCostUsd",
    "contextDigest", "durationMs"]
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== keys.sort().join(",")
    || value.route !== "external" || value.provider !== "cerebras" || value.bridgeNode !== "hermes-node"
    || value.inferenceNode !== "cerebras-api" || value.mode !== "credential-bridge-one-shot"
    || value.requestedModel !== model || value.actualModel !== model || value.externalEgress !== true
    || executionNode !== value.inferenceNode || !Number.isSafeInteger(value.promptTokens) || value.promptTokens < 0
    || !Number.isSafeInteger(value.completionTokens) || value.completionTokens < 0
    || value.totalTokens !== value.promptTokens + value.completionTokens
    || typeof value.calculatedCostUsd !== "number" || !Number.isFinite(value.calculatedCostUsd) || value.calculatedCostUsd < 0
    || value.maxCostUsd !== 0.03 || value.calculatedCostUsd > value.maxCostUsd
    || typeof value.contextDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.contextDigest)
    || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0) throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
  assertProposalSecretFree(value)
  return value
}

function validReceipt(value, applicationId, proposalId) {
  const keys = [
    "schemaVersion", "proposalId", "applicationId", "manifestDigest", "repositoryDigest", "writablePaths",
    "status", "requestedBy", "requestText", "requestSha256", "executionRoute", "executionProvider",
    "executionNode", "model", "threadId", "turnId", "providerExecution", "progress", "createdAt", "baseSha", "candidateSha",
    "baseRef", "branch", "changedPaths", "patchSha256", "validation", "appliedAt", "appliedCommit", "rejectedAt",
    "rejectionReason", "applyStartedAt", "applyToken", "applyProcessId", "quarantinedAt", "quarantineReason",
  ]
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== keys.sort().join(",") || value.schemaVersion !== 4
    || value.proposalId !== proposalId || value.applicationId !== applicationId || !UUID.test(proposalId)
    || !isApplicationId(applicationId) || !SHA256.test(value.manifestDigest) || !SHA256.test(value.repositoryDigest)
    || !Array.isArray(value.writablePaths) || value.writablePaths.length !== 3 || new Set(value.writablePaths).size !== 3
    || !["READY_FOR_REVIEW", "APPLY_IN_PROGRESS", "APPLIED", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"].includes(value.status)
    || typeof value.requestedBy !== "string" || !value.requestedBy || requestedText(value.requestText) !== value.requestText
    || value.requestSha256 !== digest(value.requestText) || !timestamp(value.createdAt)
    || !["hermes-local", "cerebras-gpt-oss-120b", "cerebras-qwen-3-8-27b"].includes(value.executionRoute)
    || !["hermes-local", "cerebras"].includes(value.executionProvider) || typeof value.executionNode !== "string"
    || !value.executionNode || typeof value.model !== "string" || !value.model
    || !TURN_ID.test(value.threadId) || !TURN_ID.test(value.turnId)
    || !SHA.test(value.baseSha) || !SHA.test(value.candidateSha) || !validHeadRef(value.baseRef)
    || value.branch !== `codex/williamos-app-${applicationId}-${proposalId}`
    || !Array.isArray(value.changedPaths) || !value.changedPaths.length
    || !equal(value.changedPaths, [...new Set(value.changedPaths)].sort())
    || value.changedPaths.some((item) => !value.writablePaths.includes(item))
    || !SHA256.test(value.patchSha256)) throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
  validationResult(value.validation)
  let execution
  try {
    execution = resolveApplicationExecutionRoute(value.executionRoute, {
      externalEnabled: true,
      externalEgressApproved: true,
    })
  } catch { throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID") }
  const expectedNode = execution.external ? "cerebras-api" : "hermes-node"
  if (value.executionProvider !== execution.provider || value.model !== execution.model
    || value.executionNode !== expectedNode) throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
  const progressContract = execution.external ? EXTERNAL_PROGRESS : PROGRESS
  if (!Array.isArray(value.progress) || value.progress.length !== progressContract.length) throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
  let previous = value.createdAt
  for (const [index, entry] of value.progress.entries()) {
    if (!entry || Object.keys(entry).sort().join(",") !== ["at", "detail", "stage"].sort().join(",")
      || entry.stage !== progressContract[index][0] || entry.detail !== progressContract[index][1]
      || !timestamp(entry.at) || entry.at < previous) throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
    previous = entry.at
  }
  if (execution.external) validProviderExecution(value.providerExecution, value.model, value.executionNode)
  else if (value.providerExecution !== null) throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
  const terminalNull = (name) => value[name] === null
  if (value.status === "READY_FOR_REVIEW") {
    if (!["appliedAt", "appliedCommit", "rejectedAt", "rejectionReason", "applyStartedAt", "applyToken", "applyProcessId", "quarantinedAt", "quarantineReason"].every(terminalNull)) {
      throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
    }
  } else if (value.status === "APPLY_IN_PROGRESS") {
    if (!timestamp(value.applyStartedAt) || !UUID.test(value.applyToken) || !Number.isSafeInteger(value.applyProcessId)
      || !["appliedAt", "appliedCommit", "rejectedAt", "rejectionReason", "quarantinedAt", "quarantineReason"].every(terminalNull)) {
      throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
    }
  } else if (value.status === "APPLIED") {
    if (!timestamp(value.appliedAt) || !SHA.test(value.appliedCommit) || value.appliedCommit !== value.candidateSha
      || !["rejectedAt", "rejectionReason", "applyStartedAt", "applyToken", "applyProcessId", "quarantinedAt", "quarantineReason"].every(terminalNull)) {
      throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
    }
  } else if (value.status === "REJECTED") {
    if (!timestamp(value.rejectedAt) || rejectedBecause(value.rejectionReason) !== value.rejectionReason
      || !["appliedAt", "appliedCommit", "applyStartedAt", "applyToken", "applyProcessId", "quarantinedAt", "quarantineReason"].every(terminalNull)) {
      throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
    }
  } else if (!timestamp(value.quarantinedAt) || typeof value.quarantineReason !== "string"
    || !/^APPLICATION_PROPOSAL_[A-Z0-9_]{3,80}$/.test(value.quarantineReason)
    || !["appliedAt", "appliedCommit", "rejectedAt", "rejectionReason", "applyStartedAt", "applyToken", "applyProcessId"].every(terminalNull)) {
    throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
  }
  return value
}

function receipt(runtimeRoot, applicationId, proposalId) {
  const files = runtimePaths(runtimeRoot, applicationId, proposalId)
  let bytes
  const authoritative = fs.existsSync(files.quarantine) ? files.quarantine : files.receipt
  bytes = readBoundedRegularFile(authoritative, {
    maxBytes: MAX_RECEIPT_BYTES,
    errorCode: "APPLICATION_PROPOSAL_RECEIPT_INVALID",
    allowMissing: true,
  })
  if (bytes === null) throw new Error("APPLICATION_PROPOSAL_NOT_FOUND")
  try { return { value: validReceipt(JSON.parse(bytes), applicationId, proposalId), files, bytes } }
  catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_NOT_FOUND") throw error
    throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
  }
}

function reviewedPatchBytes(value, files) {
  const bytes = readBoundedRegularFile(files.patch, {
    maxBytes: MAX_PATCH_BYTES,
    errorCode: "APPLICATION_PROPOSAL_PATCH_MISMATCH",
  })
  if (!bytes.length || bytes.length > MAX_PATCH_BYTES || bytes.includes(0) || digest(bytes) !== value.patchSha256) {
    throw new Error("APPLICATION_PROPOSAL_PATCH_MISMATCH")
  }
  assertProposalSecretFree(bytes)
  return bytes
}

function review(value, files) {
  const bytes = reviewedPatchBytes(value, files)
  let reviewPatch
  try { reviewPatch = new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
  catch { throw new Error("APPLICATION_PROPOSAL_PATCH_MISMATCH") }
  assertProposalSecretFree(reviewPatch)
  return { ...value, reviewPatch }
}

function inspectReview(value, files) {
  try { return review(value, files) }
  catch (error) {
    if (["APPLIED", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"].includes(value.status)) {
      return { ...value, reviewPatch: null }
    }
    throw error
  }
}

function regularFile(root, relative) {
  let cursor = path.resolve(root)
  const parts = relative.split("/")
  for (const [index, segment] of parts.entries()) {
    cursor = path.join(cursor, segment)
    const stat = fs.lstatSync(cursor)
    if (stat.isSymbolicLink() || !samePath(fs.realpathSync(cursor), cursor)
      || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error("APPLICATION_PROPOSAL_WORKSPACE_FILE_INVALID")
    }
  }
  return cursor
}

function snapshot(root, paths) {
  let total = 0
  return new Map(paths.map((relative) => {
    const target = regularFile(root, relative)
    const before = fs.lstatSync(target, { bigint: true })
    const size = Number(before.size)
    total += size
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES || before.nlink !== 1n) {
      throw new Error("APPLICATION_PROPOSAL_SOURCE_SIZE_REFUSED")
    }
    const bytes = fs.readFileSync(target)
    const after = fs.lstatSync(target, { bigint: true })
    if (after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1n
      || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw new Error("APPLICATION_PROPOSAL_WORKSPACE_FILE_INVALID")
    }
    return [relative, {
      bytes,
      mode: Number(before.mode & 0o777n),
      identity: { dev: String(before.dev), ino: String(before.ino) },
    }]
  }))
}

const sameFile = (left, right) => !!left && !!right && left.mode === right.mode && left.bytes.equals(right.bytes)
function assertSnapshot(root, expected, code) {
  const actual = snapshot(root, [...expected.keys()])
  for (const [relative, state] of expected) if (!sameFile(state, actual.get(relative))) throw new Error(code)
}

function changed(status) {
  const result = []
  for (const entry of String(status).split("\0").filter(Boolean)) {
    const code = entry.slice(0, 2)
    const relative = entry.slice(3).replaceAll("\\", "/")
    if (code !== " M" || !relative) {
      throw new Error(code.includes("R") || code.includes("C") ? "APPLICATION_PROPOSAL_RENAME_REFUSED" : "APPLICATION_PROPOSAL_PATH_REFUSED")
    }
    result.push(relative)
  }
  return [...new Set(result)].sort()
}

async function treeEntries(repository, commit, paths) {
  const raw = (await git(repository, ["ls-tree", "-z", commit, "--", ...paths])).stdout
  const entries = new Map()
  for (const record of raw.split("\0").filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]+)\t(.+)$/.exec(record)
    if (!match || !SHA.test(match[2]) || !paths.includes(match[3])) throw new Error("APPLICATION_PROPOSAL_COMMIT_INVALID")
    entries.set(match[3], { mode: match[1], blob: match[2] })
  }
  if (entries.size !== paths.length) throw new Error("APPLICATION_PROPOSAL_COMMIT_INVALID")
  return entries
}

async function verifyCandidate(repository, base, candidate, paths) {
  if (!SHA.test(candidate) || (await git(repository, ["show", "-s", "--format=%P", candidate])).stdout.trim() !== base) {
    throw new Error("APPLICATION_PROPOSAL_COMMIT_INVALID")
  }
  const actual = (await git(repository, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", base, candidate])).stdout
    .split("\0").filter(Boolean).sort()
  if (!equal(actual, paths)) throw new Error("APPLICATION_PROPOSAL_COMMIT_INVALID")
  const before = await treeEntries(repository, base, paths)
  const after = await treeEntries(repository, candidate, paths)
  for (const relative of paths) if (before.get(relative).mode !== after.get(relative).mode) throw new Error("APPLICATION_PROPOSAL_COMMIT_INVALID")
  return after
}

async function patchPaths(repository, patchBytes, allowedPaths) {
  if (!Buffer.isBuffer(patchBytes) || !patchBytes.length || patchBytes.length > MAX_PATCH_BYTES
    || patchBytes.includes(0)) throw new Error("APPLICATION_PROPOSAL_PATCH_INVALID")
  let patchText
  try { patchText = new TextDecoder("utf-8", { fatal: true }).decode(patchBytes) }
  catch { throw new Error("APPLICATION_PROPOSAL_PATCH_INVALID") }
  const raw = await git(repository, ["apply", "--numstat", "-z", "-"], {
    encoding: "buffer",
    errorCode: "APPLICATION_PROPOSAL_PATCH_INVALID",
    input: patchBytes,
  })
  let header = false
  for (const line of patchText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) header = true
    else if (line.startsWith("@@ ")) header = false
    else if (header && /^(?:GIT binary patch$|Binary files |new file mode |deleted file mode |old mode |new mode |rename (?:from|to) |copy (?:from|to) )/.test(line)) {
      throw new Error("APPLICATION_PROPOSAL_PATCH_SCOPE_MISMATCH")
    }
  }
  const paths = Buffer.from(raw.stdout).toString("utf8").split("\0").filter(Boolean).map((line) => {
    const pieces = line.split("\t")
    if (pieces.length !== 3 || !/^\d+$/.test(pieces[0]) || !/^\d+$/.test(pieces[1])) {
      throw new Error("APPLICATION_PROPOSAL_PATCH_SCOPE_MISMATCH")
    }
    return pieces[2]
  })
  if (!paths.length || new Set(paths).size !== paths.length || paths.some((relative) => !allowedPaths.includes(relative))) {
    throw new Error("APPLICATION_PROPOSAL_PATCH_SCOPE_MISMATCH")
  }
  return paths.sort()
}

async function removeWorktree(repository, runtimeRoot, workspace) {
  const worktrees = assertApplicationProposalRuntimePath(runtimeRoot, path.resolve(runtimeRoot, "worktrees"))
  if (!samePath(path.dirname(path.resolve(workspace)), worktrees)) throw new Error("APPLICATION_PROPOSAL_WORKTREE_INVALID")
  assertApplicationProposalRuntimePath(runtimeRoot, path.resolve(workspace), { allowMissing: true })
  const removed = await git(repository, ["worktree", "remove", "--force", workspace], { allowFailure: true })
  const pruned = await git(repository, ["worktree", "prune"], { allowFailure: true })
  const listed = await git(repository, ["worktree", "list", "--porcelain", "-z"], { allowFailure: true })
  const registered = listed.stdout.split("\0").some((entry) => entry.startsWith("worktree ") && samePath(entry.slice(9), workspace))
  if (pruned.code || listed.code || fs.existsSync(workspace) || registered) {
    throw new Error("APPLICATION_PROPOSAL_WORKTREE_CLEANUP_FAILED")
  }
}

async function bestEffortRemoveWorktree(repository, runtimeRoot, workspace) {
  try { await removeWorktree(repository, runtimeRoot, workspace) } catch { /* original failure remains authoritative */ }
}

function creationWorktreeRecords(raw) {
  const records = []
  let current = null
  for (const field of String(raw).split("\0")) {
    if (!field) {
      if (current) records.push(current)
      current = null
    } else if (field.startsWith("worktree ")) {
      if (current) records.push(current)
      current = { path: field.slice(9), head: null, branch: null }
    } else if (current && field.startsWith("HEAD ")) current.head = field.slice(5)
    else if (current && field.startsWith("branch ")) current.branch = field.slice(7)
  }
  if (current) records.push(current)
  return records
}

async function creationBranchTarget(repository, branch) {
  const reference = `refs/heads/${branch}`
  const probe = await git(repository, ["show-ref", "--verify", "--quiet", reference], { allowFailure: true })
  if (probe.code === 1 && probe.executionFailure !== true && !String(probe.stderr ?? "").trim()) return null
  if (probe.code !== 0) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  const observed = await git(repository, ["show-ref", "--hash", "--verify", reference], { allowFailure: true })
  const value = String(observed.stdout ?? "").trim()
  if (observed.code !== 0 || !SHA.test(value)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  return value
}

function removeCreationScratch(runtimeRoot, target) {
  if (!fs.existsSync(target)) return
  removeApplicationProposalCreateScratch(runtimeRoot, target)
}

async function recoverDeadApplicationCreateIntent(descriptor, runtimeRoot, handle) {
  const intent = handle.value
  if (intent.applicationId !== descriptor.manifest.id || intent.repositoryDigest !== descriptor.repositoryDigest) {
    throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  }
  removeApplicationProposalCreateWriteResidues(runtimeRoot, handle)
  const repository = descriptor.repositoryRoot
  const files = runtimePaths(runtimeRoot, intent.applicationId, intent.proposalId)
  const workspace = applicationProposalWorkspace(runtimeRoot, intent.workspaceName)
  const stagedPatch = `${files.patch}.${intent.intentToken}.tmp`
  const patchPrivate = `${stagedPatch}.write`
  const stagedReceipt = `${files.receipt}.${intent.intentToken}.tmp`
  const receiptPrivate = `${stagedReceipt}.write`
  const temporaryIndex = `${workspace}.candidate-index-${intent.intentToken}`
  const temporaryIndexLock = `${temporaryIndex}.lock`
  const reference = `refs/heads/${intent.branch}`
  await assertCanonicalRepositoryBoundary(descriptor)
  assertRepositoryReferenceTopology(descriptor, reference)

  const listing = await git(repository, ["worktree", "list", "--porcelain", "-z"], { allowFailure: true })
  if (listing.code !== 0) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  const records = creationWorktreeRecords(listing.stdout)
  const workspaceRecords = records.filter((record) => samePath(record.path, workspace))
  const branchRecords = records.filter((record) => record.branch === reference)
  if (workspaceRecords.length > 1 || branchRecords.some((record) => !samePath(record.path, workspace))) {
    throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  }
  const candidateTargets = new Set([intent.baseSha])
  if (intent.candidateSha) candidateTargets.add(intent.candidateSha)
  if (intent.candidateSha) {
    const parent = (await git(repository, ["show", "-s", "--format=%P", intent.candidateSha])).stdout.trim()
    if (parent !== intent.baseSha) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  }
  const branchTarget = await creationBranchTarget(repository, intent.branch)
  if (branchTarget !== null && !candidateTargets.has(branchTarget)) {
    throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  }
  if (workspaceRecords.length === 1) {
    const record = workspaceRecords[0]
    if (record.branch !== reference || !candidateTargets.has(record.head) || branchTarget === null) {
      throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    }
  } else if (fs.existsSync(workspace)) {
    // An unregistered directory could have been replaced after the crash. Keep
    // the journal as the durable operator-visible account instead of guessing.
    throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  }

  removeCreationScratch(runtimeRoot, patchPrivate)
  removeCreationScratch(runtimeRoot, receiptPrivate)
  if (fs.existsSync(stagedReceipt)) {
    removeApplicationProposalCreateArtifact(runtimeRoot, stagedReceipt, intent.receiptSha256)
  }

  const hasReceiptArtifact = fs.existsSync(files.receipt) || fs.existsSync(files.quarantine)
  if (hasReceiptArtifact) {
    if (intent.phase !== "PUBLICATION_BOUND") throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    const stored = receipt(runtimeRoot, intent.applicationId, intent.proposalId)
    if (stored.value.repositoryDigest !== intent.repositoryDigest || stored.value.manifestDigest !== intent.manifestDigest
      || !equal(stored.value.writablePaths, intent.writablePaths) || stored.value.baseSha !== intent.baseSha
      || stored.value.candidateSha !== intent.candidateSha || stored.value.branch !== intent.branch
      || stored.value.patchSha256 !== intent.patchSha256 || !equal(stored.value.changedPaths, intent.changedPaths)) {
      throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    }
    const terminal = ["APPLIED", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"].includes(stored.value.status)
    const originalReady = digest(stored.bytes) === intent.receiptSha256 && stored.value.status === "READY_FOR_REVIEW"
    const terminalReadyBytes = terminal
      ? Buffer.from(`${JSON.stringify(readyReceipt(stored.value), null, 2)}\n`, "utf8")
      : null
    const terminalBound = terminalReadyBytes !== null && digest(terminalReadyBytes) === intent.receiptSha256
    if (!originalReady && !terminalBound) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    if (originalReady) {
      review(stored.value, stored.files)
      if (branchTarget !== intent.candidateSha) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    } else if (branchTarget !== null && branchTarget !== intent.candidateSha) {
      throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    }
    if (workspaceRecords.length) await removeWorktree(repository, runtimeRoot, workspace)
    if (terminal && branchTarget === intent.candidateSha) {
      await deleteOwnedProposalBranch({
        git, repository, branch: intent.branch, ownedTargets: new Set([intent.candidateSha]),
        errorCode: "APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN",
        assertReferenceBoundary: (ref) => assertRepositoryReferenceTopology(descriptor, ref),
      })
    }
    removeCreationScratch(runtimeRoot, temporaryIndex)
    removeCreationScratch(runtimeRoot, temporaryIndexLock)
    if (fs.existsSync(stagedPatch)) {
      removeApplicationProposalCreateArtifact(runtimeRoot, stagedPatch, intent.patchSha256)
    }
    releaseApplicationProposalCreateIntent(handle)
    return
  }

  let expectedPatch = null
  if (intent.phase === "PUBLICATION_BOUND") {
    if (branchTarget !== null && branchTarget !== intent.candidateSha) {
      throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    }
    const actualPaths = (await git(repository, [
      "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", intent.baseSha, intent.candidateSha,
    ])).stdout.split("\0").filter(Boolean).sort()
    if (!equal(actualPaths, intent.changedPaths)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    expectedPatch = Buffer.from((await git(repository, [
      "diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index",
      intent.baseSha, intent.candidateSha, "--", ...intent.changedPaths,
    ], { encoding: "buffer" })).stdout)
    if (!expectedPatch.length || digest(expectedPatch) !== intent.patchSha256) {
      throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    }
  } else if (fs.existsSync(files.patch) || fs.existsSync(stagedPatch)) {
    throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  }

  if (workspaceRecords.length) await removeWorktree(repository, runtimeRoot, workspace)
  if (branchTarget !== null) {
    await deleteOwnedProposalBranch({
      git, repository, branch: intent.branch, ownedTargets: candidateTargets,
      errorCode: "APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN",
      assertReferenceBoundary: (ref) => assertRepositoryReferenceTopology(descriptor, ref),
    })
  }
  for (const target of [files.patch, stagedPatch]) {
    if (fs.existsSync(target)) removeApplicationProposalCreateArtifact(runtimeRoot, target, intent.patchSha256)
  }
  removeCreationScratch(runtimeRoot, temporaryIndex)
  removeCreationScratch(runtimeRoot, temporaryIndexLock)
  if (fs.existsSync(workspace) || fs.existsSync(files.patch) || fs.existsSync(stagedPatch) || fs.existsSync(patchPrivate)
    || fs.existsSync(stagedReceipt) || fs.existsSync(receiptPrivate) || fs.existsSync(temporaryIndex)
    || fs.existsSync(temporaryIndexLock)
    || await creationBranchTarget(repository, intent.branch) !== null) {
    throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  }
  releaseApplicationProposalCreateIntent(handle)
}

async function reconcileApplicationCreateIntents(descriptor, runtimeRoot) {
  if (!hasApplicationProposalCreateIntentEntries(runtimeRoot, descriptor.manifest.id)) return
  return withApplicationRepositoryRecoveryClaim({
    runtimeRoot,
    repositoryRoot: descriptor.repositoryRoot,
    action: async () => {
      for (const handle of listApplicationProposalCreateIntents(runtimeRoot, descriptor.manifest.id)) {
        if (applicationProposalCreateIntentOwnerAlive(handle.value)) continue
        await recoverDeadApplicationCreateIntent(descriptor, runtimeRoot, handle)
      }
    },
  })
}

export async function reconcileApplicationProposalCreateIntents({ application, runtimeRoot: configuredRuntime }) {
  const descriptor = applicationDescriptor(application)
  const repository = await canonicalRepository(descriptor)
  const runtimeRoot = assertRuntimeRoot(configuredRuntime, repository)
  await reconcileApplicationCreateIntents(descriptor, runtimeRoot)
}

function notifyProgress(onProgress, entry) {
  try { Promise.resolve(onProgress?.({ ...entry })).catch(() => {}) } catch { /* observer has no authority */ }
}

async function defaultResident({ runtimeRoot, workspacePath, requestText, prompt, proposalEngine }) {
  const assetRoot = path.resolve(process.env.WILLIAMOS_APPLICATION_ASSET_ROOT ?? process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd())
  const reviewed = assertResidentProposalRuntimePolicy(readResidentProposalPolicy(assetRoot), runtimeRoot)
  const backend = new ResidentModelExecutionBackend({ repositoryRoot: assetRoot, runtimeRoot })
  const client = await backend.runCodexClient({ workspacePath, timeoutMs: 1_800_000 })
  try {
    await client.connect()
    const threadId = await client.startThread()
    const outcomes = []
    let evidence
    const result = await runGovernedResidentChangeTransaction({
      client,
      threadId,
      requestText,
      parseRequest: requestedText,
      promptForRequest: () => prompt,
      readChangedPaths: async () => changed((await git(workspacePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout),
      assertChangedPaths: proposalEngine.assertChangedPaths,
      errorPrefix: "APPLICATION_PROPOSAL",
      verifyAttempt: (outcome) => {
        outcomes.push(outcome)
        evidence = readResidentProposalEvidence({ runtimeRoot, workspacePath, threadId, outcomes, reviewed })
        return evidence
      },
    })
    return { threadId, turnId: result.turnId, ...evidence }
  } finally { client.close() }
}

const defaultCerebras = (input) => runCerebrasApplicationTurn(input)

function baseReceipt({ descriptor, proposalId, owner, requested, execution, turn, progress, createdAt, baseRef, baseSha, candidateSha, branch, changedPaths, patchBytes, validation }) {
  const value = {
    schemaVersion: 4,
    proposalId,
    applicationId: descriptor.manifest.id,
    manifestDigest: descriptor.manifestDigest,
    repositoryDigest: descriptor.repositoryDigest,
    writablePaths: [...descriptor.engine.allowedPaths],
    status: "READY_FOR_REVIEW",
    requestedBy: owner,
    requestText: requested,
    requestSha256: digest(requested),
    executionRoute: execution.id,
    executionProvider: execution.provider,
    executionNode: turn.executionNode,
    model: turn.model,
    threadId: turn.threadId,
    turnId: turn.turnId,
    providerExecution: execution.external ? turn.providerExecution : null,
    progress,
    createdAt,
    baseRef,
    baseSha,
    candidateSha,
    branch,
    changedPaths,
    patchSha256: digest(patchBytes),
    validation,
    appliedAt: null,
    appliedCommit: null,
    rejectedAt: null,
    rejectionReason: null,
    applyStartedAt: null,
    applyToken: null,
    applyProcessId: null,
    quarantinedAt: null,
    quarantineReason: null,
  }
  return validReceipt(value, value.applicationId, proposalId)
}

export async function createApplicationProposal({
  application,
  runtimeRoot: configuredRuntime,
  requestedBy,
  requestText,
  executionRoute = "hermes-local",
  externalEgressApproved = false,
  externalRoutingEnabled = process.env.WILLIAMOS_APPLICATION_CEREBRAS_ROUTING_ENABLED
    ?? process.env.WILLIAMOS_HELLO_CEREBRAS_ROUTING_ENABLED,
  onProgress,
  residentTurn = defaultResident,
  cerebrasTurn = defaultCerebras,
  validateWorkspace = validateApplicationProposalInContainer,
  transactionOperations = {},
}) {
  const descriptor = applicationDescriptor(application)
  const repository = await canonicalRepository(descriptor)
  const runtimeRoot = assertRuntimeRoot(configuredRuntime, repository)
  await reconcileApplicationCreateIntents(descriptor, runtimeRoot)
  const owner = required(requestedBy, "requestedBy")
  const requested = requestedText(requestText)
  const execution = resolveApplicationExecutionRoute(executionRoute, { externalEnabled: externalRoutingEnabled, externalEgressApproved })
  if (execution.external && !applicationCerebrasCapability(application).available) {
    throw new Error("APPLICATION_EXECUTION_ROUTE_UNAVAILABLE")
  }
  const proposalId = crypto.randomUUID()
  const intentToken = crypto.randomUUID()
  const branch = `codex/williamos-app-${descriptor.manifest.id}-${proposalId}`
  const workspaceName = `${descriptor.manifest.id}-${proposalId}`
  const workspace = applicationProposalWorkspace(runtimeRoot, workspaceName)
  const files = runtimePaths(runtimeRoot, descriptor.manifest.id, proposalId)
  const stagedPatch = `${files.patch}.${intentToken}.tmp`
  const patchPrivate = `${stagedPatch}.write`
  const stagedReceipt = `${files.receipt}.${intentToken}.tmp`
  const receiptPrivate = `${stagedReceipt}.write`
  const prompt = descriptor.engine.governedPrompt(requested)
  assertProposalSecretFree(prompt)
  const mutateCreateJournal = (action) => withApplicationRepositoryRecoveryClaim({
    runtimeRoot,
    repositoryRoot: repository,
    action,
  })
  const writeCreatePrivate = async (target, bytes, partialCheckpoint = null) => {
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
    assertApplicationProposalRuntimePath(runtimeRoot, target, { allowMissing: true })
    let descriptor
    try {
      descriptor = fs.openSync(target, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
      const split = partialCheckpoint ? Math.max(1, Math.floor(bytes.length / 2)) : bytes.length
      let offset = 0
      while (offset < split) {
        const count = fs.writeSync(descriptor, bytes, offset, split - offset, offset)
        if (count <= 0) throw new Error("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
        offset += count
      }
      if (partialCheckpoint) {
        await transactionOperations.checkpoint?.(partialCheckpoint, { proposalId })
      }
      while (offset < bytes.length) {
        const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset)
        if (count <= 0) throw new Error("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
        offset += count
      }
      fs.fsyncSync(descriptor)
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
    assertApplicationProposalRuntimePath(runtimeRoot, target)
    const stat = fs.lstatSync(target, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || !fs.readFileSync(target).equals(bytes)) {
      throw new Error("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
    }
  }
  const publishCreatePrivate = (privatePath, target, bytes) => {
    assertApplicationProposalRuntimePath(runtimeRoot, privatePath)
    assertApplicationProposalRuntimePath(runtimeRoot, target, { allowMissing: true })
    if (fs.existsSync(target)) throw new Error("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
    fs.renameSync(privatePath, target)
    assertApplicationProposalRuntimePath(runtimeRoot, target)
    const stat = fs.lstatSync(target, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || !fs.readFileSync(target).equals(bytes)) {
      throw new Error("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
    }
  }
  return runGovernedCreateTransaction({
    errorPrefix: "APPLICATION_PROPOSAL",
    repository,
    runtime: runtimeRoot,
    proposalId,
    branch,
    workspace,
    files,
    creationIntentToken: intentToken,
    transactionOperations,
    engine: descriptor.engine,
    boundPaths: descriptor.boundPaths,
    expectedHead: descriptor.head,
    progressContract: execution.external ? EXTERNAL_PROGRESS : PROGRESS,
    onProgress,
    git,
    gitIndexEnvironment: (index) => gitEnvironment(process.env, { GIT_INDEX_FILE: index }),
    prepareCandidateIndex: (target, lockTarget) => {
      const expected = `${workspace}.candidate-index-${intentToken}`
      const expectedLock = `${expected}.lock`
      if (!samePath(target, expected) || !samePath(lockTarget, expectedLock)) {
        throw new Error("APPLICATION_PROPOSAL_WORKTREE_INVALID")
      }
      assertApplicationProposalRuntimePath(runtimeRoot, target, { allowMissing: true })
      assertApplicationProposalRuntimePath(runtimeRoot, lockTarget, { allowMissing: true })
      if (fs.existsSync(target) || fs.existsSync(lockTarget)) throw new Error("APPLICATION_PROPOSAL_WORKTREE_INVALID")
    },
    assertCandidateIndex: (target, lockTarget) => {
      const expected = `${workspace}.candidate-index-${intentToken}`
      const expectedLock = `${expected}.lock`
      if (!samePath(target, expected) || !samePath(lockTarget, expectedLock)) {
        throw new Error("APPLICATION_PROPOSAL_WORKTREE_INVALID")
      }
      assertApplicationProposalRuntimePath(runtimeRoot, target)
      assertApplicationProposalRuntimePath(runtimeRoot, lockTarget, { allowMissing: true })
      const stat = fs.lstatSync(target, { bigint: true })
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || !samePath(fs.realpathSync(target), target)) {
        throw new Error("APPLICATION_PROPOSAL_WORKTREE_INVALID")
      }
      if (fs.existsSync(lockTarget)) throw new Error("APPLICATION_PROPOSAL_WORKTREE_INVALID")
    },
    cleanupCandidateIndex: (target, lockTarget) => {
      const expected = `${workspace}.candidate-index-${intentToken}`
      const expectedLock = `${expected}.lock`
      if (!samePath(target, expected) || !samePath(lockTarget, expectedLock)) {
        throw new Error("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
      }
      assertApplicationProposalRuntimePath(runtimeRoot, lockTarget, { allowMissing: true })
      if (fs.existsSync(lockTarget)) removeApplicationProposalCreateScratch(runtimeRoot, lockTarget)
      assertApplicationProposalRuntimePath(runtimeRoot, target, { allowMissing: true })
      if (fs.existsSync(target)) {
        const stat = fs.lstatSync(target)
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
        // Unlinking the exact private index name cannot mutate another hardlink;
        // the sidecar above is stricter because Git may still own its writer.
        fs.unlinkSync(target)
        if (fs.existsSync(target)) throw new Error("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
      }
    },
    readBaseRef: () => symbolicHead(repository, "APPLICATION_PROPOSAL_STALE_BASE"),
    ensureWorkspaceParent: async () => { applicationProposalWorkspace(runtimeRoot, `${descriptor.manifest.id}-${proposalId}`) },
    assertWorkspace: (target) => assertApplicationProposalWorkspace(runtimeRoot, target, application),
    executeTurn: () => execution.external
      ? cerebrasTurn({ application, repositoryRoot: repository, runtimeRoot, workspacePath: workspace, requestText: requested, model: execution.model })
      : residentTurn({ application, repositoryRoot: repository, runtimeRoot, workspacePath: workspace, requestText: requested, prompt, proposalEngine: descriptor.engine }),
    validateTurn: (turn) => {
      if (!turn || typeof turn.threadId !== "string" || typeof turn.turnId !== "string"
        || turn.model !== execution.model || typeof turn.executionNode !== "string") {
        throw new Error("APPLICATION_PROPOSAL_RESIDENT_EVIDENCE_INVALID")
      }
    },
    validateWorkspace: (target) => validateWorkspace({ application, repositoryRoot: repository, runtimeRoot, workspacePath: target }),
    validationResult,
    snapshot,
    assertSnapshot,
    changedPaths: changed,
    verifyCandidate,
    patchPaths,
    removeWorktree,
    bestEffortRemoveWorktree,
    createReceipt: ({ progress, createdAt, baseRef, baseSha, candidateSha, branch: receiptBranch, changedPaths, patchBytes, validation, turn }) => baseReceipt({
      descriptor, proposalId, owner, requested, execution, turn, progress, createdAt, baseRef, baseSha, candidateSha,
      branch: receiptBranch, changedPaths, patchBytes, validation,
    }),
    validateReceipt: (value, id) => validReceipt(value, descriptor.manifest.id, id),
    review,
    prepareStorage: async () => {
      fs.mkdirSync(files.root, { recursive: true })
      assertApplicationProposalRuntimePath(runtimeRoot, files.root)
      if ([files.receipt, files.patch, files.quarantine, stagedPatch, patchPrivate, stagedReceipt, receiptPrivate]
        .some((target) => fs.existsSync(target))) {
        throw new Error("APPLICATION_PROPOSAL_RECEIPT_INVALID")
      }
    },
    writePatch: async (_files, bytes) => {
      await writeCreatePrivate(patchPrivate, bytes, "patch_private_partial")
      publishCreatePrivate(patchPrivate, stagedPatch, bytes)
      return stagedPatch
    },
    publishPatch: async () => { fs.renameSync(stagedPatch, files.patch) },
    writeReceipt: async (_files, value) => {
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")
      await writeCreatePrivate(receiptPrivate, bytes)
      publishCreatePrivate(receiptPrivate, stagedReceipt, bytes)
      await transactionOperations.checkpoint?.("receipt_staged", { proposalId })
      publishCreatePrivate(stagedReceipt, files.receipt, bytes)
    },
    cleanupCreationArtifacts: async ({ value, bytes }) => {
      let clean = true
      for (const target of [patchPrivate, receiptPrivate]) {
        if (!fs.existsSync(target)) continue
        try { removeApplicationProposalCreateScratch(runtimeRoot, target) } catch { clean = false }
      }
      for (const target of [stagedPatch, files.patch]) {
        if (!fs.existsSync(target)) continue
        try {
          if (!Buffer.isBuffer(bytes)) throw new Error()
          removeApplicationProposalCreateArtifact(runtimeRoot, target, digest(bytes))
        } catch { clean = false }
      }
      if (fs.existsSync(stagedReceipt)) {
        try {
          const receiptBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")
          removeApplicationProposalCreateArtifact(runtimeRoot, stagedReceipt, digest(receiptBytes))
        } catch { clean = false }
      }
      if (fs.existsSync(files.receipt)) clean = false
      return clean
    },
    persistCreationQuarantine: async ({ value }) => { quarantineReceipt(value, files, "APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED") },
    deleteBranch: async (_repository, receiptBranch, ownedTargets) => deleteOwnedProposalBranch({
      git, repository, branch: receiptBranch, ownedTargets, errorCode: "APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
      assertReferenceBoundary: (ref) => assertRepositoryReferenceTopology(descriptor, ref),
    }),
    commitMessage: `proposal(${descriptor.manifest.id}): governed change ${proposalId}`,
    secretScan: ({ proposed, patchBytes }) => {
      if (proposed) for (const relative of descriptor.engine.allowedPaths) assertProposalSecretFree(proposed.get(relative).bytes)
      if (patchBytes) assertProposalSecretFree(patchBytes)
    },
    assertRepositoryBoundary: () => assertCanonicalRepositoryBoundary(descriptor),
    assertReferenceBoundary: (ref) => assertRepositoryReferenceTopology(descriptor, ref),
    publishCreationIntent: async ({ baseRef, baseSha, createdAt }) => {
      let published = null
      try {
        return await mutateCreateJournal(async () => {
          assertApplicationProposalCreateCapacity(runtimeRoot, descriptor.manifest.id)
          published = publishApplicationProposalCreateIntent({
            runtimeRoot,
            applicationId: descriptor.manifest.id,
            proposalId,
            manifestDigest: descriptor.manifestDigest,
            repositoryDigest: descriptor.repositoryDigest,
            writablePaths: descriptor.engine.allowedPaths,
            baseRef,
            baseSha,
            branch,
            workspaceName,
            intentToken,
            startedAt: createdAt,
          })
          return published
        })
      } catch (error) {
        if (published) {
          deactivateApplicationProposalCreateIntent(published)
          const retained = new Error(error?.message === "APPLICATION_PROPOSAL_LOCK_UNCERTAIN"
            ? "APPLICATION_PROPOSAL_LOCK_UNCERTAIN"
            : "APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
          retained.retainCreationIntent = true
          throw retained
        }
        throw error
      }
    },
    bindCreationCandidate: (handle, candidateSha) => mutateCreateJournal(async () => (
      bindApplicationProposalCreateCandidate(handle, candidateSha)
    )),
    bindCreationPublication: (handle, { candidateSha, changedPaths, patchBytes, receipt: value }) => mutateCreateJournal(async () => (
      bindApplicationProposalCreatePublication(handle, {
        candidateSha,
        changedPaths,
        patchBytes,
        receiptBytes: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
      })
    )),
    releaseCreationIntent: (handle) => mutateCreateJournal(async () => releaseApplicationProposalCreateIntent(handle)),
    deactivateCreationIntent: (handle) => deactivateApplicationProposalCreateIntent(handle),
    maxPatchBytes: MAX_PATCH_BYTES,
  })
}

export function getApplicationProposal({ applicationId, runtimeRoot, proposalId, requestedBy }) {
  const id = required(proposalId, "proposalId")
  const owner = required(requestedBy, "requestedBy")
  const { value, files } = receipt(runtimeRoot, required(applicationId, "applicationId"), id)
  if (value.requestedBy !== owner) throw new Error("APPLICATION_PROPOSAL_OWNER_MISMATCH")
  return inspectReview(value, files)
}

export function listApplicationProposals({ applicationId, runtimeRoot, requestedBy }) {
  const id = required(applicationId, "applicationId")
  if (!isApplicationId(id) || typeof runtimeRoot !== "string" || !path.isAbsolute(runtimeRoot)) {
    throw new Error("APPLICATION_PROPOSAL_ID_INVALID")
  }
  const runtime = resolveApplicationProposalRuntimeRoot(runtimeRoot)
  const root = assertApplicationProposalRuntimePath(runtime, path.join(runtime, "application-proposals", id), { allowMissing: true })
  if (!fs.existsSync(root)) return []
  assertApplicationProposalRuntimePath(runtime, root)
  const proposalIds = new Set()
  for (const name of fs.readdirSync(root)) {
    const matched = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\.quarantine)?\.json$/i.exec(name)
    if (matched && UUID.test(matched[1])) proposalIds.add(matched[1])
  }
  return [...proposalIds]
    .map((proposalId) => getApplicationProposal({ applicationId: id, runtimeRoot, proposalId, requestedBy }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function readyReceipt(value) {
  return validReceipt({
    ...value,
    status: "READY_FOR_REVIEW",
    appliedAt: null,
    appliedCommit: null,
    rejectedAt: null,
    rejectionReason: null,
    applyStartedAt: null,
    applyToken: null,
    applyProcessId: null,
    quarantinedAt: null,
    quarantineReason: null,
  }, value.applicationId, value.proposalId)
}

function appliedReceipt(value) {
  return validReceipt({
    ...value,
    status: "APPLIED",
    appliedAt: new Date().toISOString(),
    appliedCommit: value.candidateSha,
    applyStartedAt: null,
    applyToken: null,
    applyProcessId: null,
    quarantinedAt: null,
    quarantineReason: null,
  }, value.applicationId, value.proposalId)
}

function quarantineReceipt(value, files, reason = "APPLICATION_PROPOSAL_APPLY_RECOVERY_UNCERTAIN") {
  const quarantined = validReceipt({
    ...value,
    status: "QUARANTINED_ROLLBACK_FAILED",
    appliedAt: null,
    appliedCommit: null,
    rejectedAt: null,
    rejectionReason: null,
    applyStartedAt: null,
    applyToken: null,
    applyProcessId: null,
    quarantinedAt: new Date().toISOString(),
    quarantineReason: reason,
  }, value.applicationId, value.proposalId)
  const encoded = `${JSON.stringify(quarantined, null, 2)}\n`
  let markerDurable = false
  let receiptDurable = false
  try {
    atomicWrite(files.quarantine, encoded, files.runtime)
    markerDurable = fs.readFileSync(files.quarantine, "utf8") === encoded
  } catch { /* primary receipt remains the independent fallback */ }
  try {
    writeReceipt(files.receipt, quarantined, files.runtime)
    receiptDurable = fs.readFileSync(files.receipt, "utf8") === encoded
  } catch { /* the quarantine marker is authoritative on reads */ }
  if (!markerDurable && !receiptDurable) throw new Error("APPLICATION_PROPOSAL_ROLLBACK_FAILED")
  return quarantined
}

async function indexEntries(repository) {
  return (await git(repository, ["ls-files", "--stage", "-z"])).stdout.split("\0").filter(Boolean)
}

const entryPath = (entry) => entry.slice(entry.indexOf("\t") + 1)
const entryFor = (entries, relative) => entries.find((entry) => entryPath(entry) === relative)
const formatEntry = (relative, entry) => `${entry.mode} ${entry.blob} 0\t${relative}`

async function setIndexEntry(repository, relative, entry) {
  await git(repository, ["update-index", "--add", "--cacheinfo", `${entry.mode},${entry.blob},${relative}`])
}

async function exactRepositoryState(repository, commit, paths) {
  const expected = await treeEntries(repository, commit, paths)
  const index = await indexEntries(repository)
  for (const relative of paths) {
    const state = snapshot(repository, [relative]).get(relative)
    const blob = (await git(repository, ["hash-object", "--", relative])).stdout.trim()
    const mode = state.mode & 0o111 ? "100755" : "100644"
    if (blob !== expected.get(relative).blob || mode !== expected.get(relative).mode
      || entryFor(index, relative) !== formatEntry(relative, expected.get(relative))) return false
  }
  return true
}

async function recoverStaleApplicationApply(descriptor, runtimeRoot, stale) {
  let stored
  try { stored = receipt(runtimeRoot, descriptor.manifest.id, stale.proposalId) }
  catch { throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN") }
  const { value, files } = stored
  if (value.repositoryDigest !== descriptor.repositoryDigest || value.applicationId !== descriptor.manifest.id) {
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  const abandonedWorkspace = applicationProposalWorkspace(runtimeRoot, `${descriptor.manifest.id}-apply-${stale.token}`)
  if (["APPLIED", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"].includes(value.status)) {
    // A terminal receipt is the irreversible authority. Later legitimate commits
    // must not keep an unrelated future proposal behind this stale public lock.
    await bestEffortRemoveWorktree(descriptor.repositoryRoot, runtimeRoot, abandonedWorkspace)
    try {
      await deleteOwnedProposalBranch({
        git,
        repository: descriptor.repositoryRoot,
        branch: value.branch,
        ownedTargets: new Set([value.candidateSha]),
        errorCode: "APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
        assertReferenceBoundary: (ref) => assertRepositoryReferenceTopology(descriptor, ref),
      })
    } catch { /* terminal truth wins; retain an ambiguously changed branch */ }
    return
  }
  const boundAbandonedApply = value.status === "APPLY_IN_PROGRESS"
    && value.applyToken === stale.token && value.applyProcessId === stale.processId
  try { assertReceiptApplication(value, descriptor) }
  catch {
    if (boundAbandonedApply) {
      quarantineReceipt(value, files, "APPLICATION_PROPOSAL_MANIFEST_DRIFT")
      return new Error("APPLICATION_PROPOSAL_QUARANTINED")
    }
    throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  }
  if (boundAbandonedApply) {
    try {
      review(value, files)
      if (await symbolicHead(descriptor.repositoryRoot, "APPLICATION_PROPOSAL_LOCK_UNCERTAIN") !== value.baseRef) throw new Error()
      const head = (await git(descriptor.repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim()
      if (head === value.baseSha && await exactRepositoryState(descriptor.repositoryRoot, value.baseSha, descriptor.boundPaths)) {
        await removeWorktree(descriptor.repositoryRoot, runtimeRoot, abandonedWorkspace)
        writeReceipt(files.receipt, readyReceipt(value), runtimeRoot, stored.bytes)
        return
      }
      if (head === value.candidateSha && await exactRepositoryState(descriptor.repositoryRoot, value.candidateSha, descriptor.boundPaths)) {
        writeReceipt(files.receipt, appliedReceipt(value), runtimeRoot, stored.bytes)
        await bestEffortRemoveWorktree(descriptor.repositoryRoot, runtimeRoot, abandonedWorkspace)
        try {
          await deleteOwnedProposalBranch({
            git,
            repository: descriptor.repositoryRoot,
            branch: value.branch,
            ownedTargets: new Set([value.candidateSha]),
            errorCode: "APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
            assertReferenceBoundary: (ref) => assertRepositoryReferenceTopology(descriptor, ref),
          })
        } catch { /* APPLIED is already authoritative */ }
        return
      }
    } catch { /* token-bound Apply that cannot be proven is quarantined below */ }
    quarantineReceipt(value, files)
    return new Error("APPLICATION_PROPOSAL_QUARANTINED")
  }
  try {
    review(value, files)
    if (await symbolicHead(descriptor.repositoryRoot, "APPLICATION_PROPOSAL_LOCK_UNCERTAIN") !== value.baseRef) throw new Error()
    const head = (await git(descriptor.repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim()
    if (value.status === "READY_FOR_REVIEW" && head === value.baseSha
      && await exactRepositoryState(descriptor.repositoryRoot, value.baseSha, descriptor.boundPaths)) return
  } catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_QUARANTINED") throw error
  }
  throw new Error("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
}

function assertReceiptApplication(value, descriptor) {
  if (value.applicationId !== descriptor.manifest.id || value.manifestDigest !== descriptor.manifestDigest
    || value.repositoryDigest !== descriptor.repositoryDigest || !equal(value.writablePaths, descriptor.engine.allowedPaths)) {
    throw new Error("APPLICATION_PROPOSAL_MANIFEST_DRIFT")
  }
}

export async function rejectApplicationProposal({ application, runtimeRoot: configuredRuntime, proposalId, requestedBy, reason, transactionOperations = {} }) {
  const descriptor = applicationDescriptor(application)
  const repository = await canonicalRepository(descriptor)
  const runtimeRoot = assertRuntimeRoot(configuredRuntime, repository)
  const owner = required(requestedBy, "requestedBy")
  const rejectedReason = rejectedBecause(reason)
  const id = required(proposalId, "proposalId")
  const cleanupCandidate = (stored) => deleteOwnedProposalBranch({
    git,
    repository,
    branch: stored.value.branch,
    ownedTargets: new Set([stored.value.candidateSha]),
    errorCode: "APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
    assertReferenceBoundary: (ref) => assertRepositoryReferenceTopology(descriptor, ref),
  })
  return runGovernedRejectLifecycle({
    errorPrefix: "APPLICATION_PROPOSAL",
    proposalId: id,
    load: () => receipt(runtimeRoot, descriptor.manifest.id, id),
    assertOwner: (stored) => {
      if (stored.value.requestedBy !== owner) throw new Error("APPLICATION_PROPOSAL_OWNER_MISMATCH")
    },
    assertBinding: (stored) => {
      if (stored.value.applicationId !== descriptor.manifest.id
        || stored.value.repositoryDigest !== descriptor.repositoryDigest) {
        throw new Error("APPLICATION_PROPOSAL_MANIFEST_DRIFT")
      }
    },
    status: (stored) => stored.value.status,
    inspect: (stored) => review(stored.value, stored.files),
    onTerminal: async (stored) => {
      if (stored.value.rejectionReason !== rejectedReason) throw new Error("APPLICATION_PROPOSAL_NOT_APPLICABLE")
      await reconcileTerminalApplicationRepositoryLock({ runtimeRoot, repositoryRoot: repository, proposalId: id })
      await cleanupCandidate(stored)
      return inspectReview(stored.value, stored.files)
    },
    acquireRepositoryLock: (recoverStale) => acquireApplicationRepositoryLock({
      runtimeRoot, repositoryRoot: repository, proposalId: id, recoverStale,
    }),
    releaseRepositoryLock: (claim) => releaseApplicationRepositoryLock(claim),
    recoverStale: (stale) => recoverStaleApplicationApply(descriptor, runtimeRoot, stale),
    claimReject: async (stored) => ({ ...stored, rejectionReason: rejectedReason }),
    createRejectedReceipt: (claim) => ({
      ...claim.value,
      status: "REJECTED",
      rejectedAt: new Date().toISOString(),
      rejectionReason: claim.rejectionReason,
    }),
    validateReceipt: (updated, targetId) => validReceipt(updated, descriptor.manifest.id, targetId),
    cleanupCandidate,
    publishRejected: async (claim, updated) => { writeReceipt(claim.files.receipt, updated, runtimeRoot, claim.bytes) },
    review: (updated, claim) => review(updated, claim.files),
    checkpoint: transactionOperations.checkpoint,
  })
}

async function applyTransaction({ descriptor, runtimeRoot, stored, claim, validateWorkspace, transactionOperations = {} }) {
  const repository = descriptor.repositoryRoot
  const { value, files } = stored
  const patchBytes = reviewedPatchBytes(value, files)
  const workspaceName = `${descriptor.manifest.id}-apply-${claim.value.token}`
  const workspace = applicationProposalWorkspace(runtimeRoot, workspaceName)
  const assertClaimOwnership = () => {
    const current = receipt(runtimeRoot, value.applicationId, value.proposalId)
    if (current.value.status !== "APPLY_IN_PROGRESS" || current.value.applyToken !== claim.value.token
      || !current.bytes.equals(stored.bytes)) throw new Error("APPLICATION_PROPOSAL_RECEIPT_CHANGED")
  }
  try {
    return await runGovernedApplyTransaction({
    errorPrefix: "APPLICATION_PROPOSAL",
    repository,
    runtime: runtimeRoot,
    proposalId: value.proposalId,
    value,
    patchBytes,
    changedPaths: value.changedPaths,
    allowedPaths: descriptor.engine.allowedPaths,
    boundPaths: descriptor.boundPaths,
    baseSha: value.baseSha,
    candidateSha: value.candidateSha,
    configuredBaseRef: value.baseRef,
    workspace,
    git,
    readBaseRef: () => symbolicHead(repository, "APPLICATION_PROPOSAL_STALE_BASE"),
    patchPaths,
    snapshot,
    assertSnapshot,
    regularFile,
    indexEntries,
    setIndexEntry,
    treeEntries,
    verifyCandidate,
    assertWorkspace: (target) => assertApplicationProposalWorkspace(runtimeRoot, target, descriptor.application),
    validateWorkspace: (target) => validateWorkspace({ application: descriptor.application, repositoryRoot: repository, runtimeRoot, workspacePath: target }),
    validationResult,
    removeWorktree,
    createAppliedReceipt: () => validReceipt({
      ...value,
      status: "APPLIED",
      validation: value.validation,
      appliedAt: new Date().toISOString(),
      appliedCommit: value.candidateSha,
      applyStartedAt: null,
      applyToken: null,
      applyProcessId: null,
    }, value.applicationId, value.proposalId),
    validateReceipt: (updated, id) => validReceipt(updated, value.applicationId, id),
    publishAppliedReceipt: async (updated) => { writeReceipt(files.receipt, updated, runtimeRoot, stored.bytes) },
    restoreReadyReceipt: async () => {
      const current = receipt(runtimeRoot, value.applicationId, value.proposalId)
      if (!current.bytes.equals(stored.bytes)) throw new Error("APPLICATION_PROPOSAL_RECEIPT_CHANGED")
      writeReceipt(files.receipt, readyReceipt(current.value), runtimeRoot, current.bytes)
    },
    quarantine: async (reason) => { quarantineReceipt(value, files, reason) },
    assertClaimOwnership,
    releaseClaim: async () => {},
    deleteBranch: async () => deleteOwnedProposalBranch({
      git,
      repository,
      branch: value.branch,
      ownedTargets: new Set([value.candidateSha]),
      errorCode: "APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
      assertReferenceBoundary: (ref) => assertRepositoryReferenceTopology(descriptor, ref),
    }),
    review: (updated) => inspectReview(updated, files),
    transactionOperations,
    digest,
    patchDigest: value.patchSha256,
    maxPatchBytes: MAX_PATCH_BYTES,
    secretScan: assertProposalSecretFree,
    assertRepositoryBoundary: () => assertCanonicalRepositoryBoundary(descriptor),
    assertReferenceBoundary: (ref) => assertRepositoryReferenceTopology(descriptor, ref),
    })
  } catch (error) {
    try {
      const current = receipt(runtimeRoot, value.applicationId, value.proposalId)
      if (current.value.status === "APPLY_IN_PROGRESS" && current.value.applyToken === claim.value.token
        && current.bytes.equals(stored.bytes)) {
        writeReceipt(files.receipt, readyReceipt(current.value), runtimeRoot, current.bytes)
      }
    } catch {
      quarantineReceipt(value, files, "APPLICATION_PROPOSAL_ROLLBACK_FAILED")
      throw new Error("APPLICATION_PROPOSAL_ROLLBACK_FAILED")
    }
    throw error
  }
}

export async function applyApplicationProposal({
  application,
  runtimeRoot: configuredRuntime,
  proposalId,
  requestedBy,
  validateWorkspace = validateApplicationProposalInContainer,
  transactionOperations = {},
}) {
  const descriptor = applicationDescriptor(application)
  const repository = await canonicalRepository(descriptor)
  const runtimeRoot = assertRuntimeRoot(configuredRuntime, repository)
  const owner = required(requestedBy, "requestedBy")
  const id = required(proposalId, "proposalId")
  const cleanupTerminalCandidate = (stored) => deleteOwnedProposalBranch({
    git,
    repository,
    branch: stored.value.branch,
    ownedTargets: new Set([stored.value.candidateSha]),
    errorCode: "APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
    assertReferenceBoundary: (ref) => assertRepositoryReferenceTopology(descriptor, ref),
  })
  return runGovernedApplyLifecycle({
    errorPrefix: "APPLICATION_PROPOSAL",
    load: () => receipt(runtimeRoot, descriptor.manifest.id, id),
    assertOwner: (stored) => {
      if (stored.value.requestedBy !== owner) throw new Error("APPLICATION_PROPOSAL_OWNER_MISMATCH")
    },
    assertBinding: (stored) => assertReceiptApplication(stored.value, descriptor),
    assertTerminalBinding: (stored) => {
      if (stored.value.applicationId !== descriptor.manifest.id
        || stored.value.repositoryDigest !== descriptor.repositoryDigest) {
        throw new Error("APPLICATION_PROPOSAL_MANIFEST_DRIFT")
      }
    },
    status: (stored) => stored.value.status,
    inspect: (stored) => { if (stored.value.status === "READY_FOR_REVIEW") review(stored.value, stored.files) },
    onTerminal: async (stored) => {
      await reconcileTerminalApplicationRepositoryLock({ runtimeRoot, repositoryRoot: repository, proposalId: id })
      await cleanupTerminalCandidate(stored)
      return inspectReview(stored.value, stored.files)
    },
    canClaim: (state) => ["READY_FOR_REVIEW", "APPLY_IN_PROGRESS"].includes(state),
    acquireRepositoryLock: (recoverStale) => acquireApplicationRepositoryLock({
      runtimeRoot, repositoryRoot: repository, proposalId: id, recoverStale,
    }),
    releaseRepositoryLock: (claim) => releaseApplicationRepositoryLock(claim),
    recoverStale: (stale) => recoverStaleApplicationApply(descriptor, runtimeRoot, stale),
    reconcileLocked: async (stored) => {
      if (stored.value.status === "APPLY_IN_PROGRESS") {
        quarantineReceipt(stored.value, stored.files)
        throw new Error("APPLICATION_PROPOSAL_QUARANTINED")
      }
      throw new Error("APPLICATION_PROPOSAL_NOT_APPLICABLE")
    },
    claimApply: async (stored, claim) => {
      applicationProposalWorktreesRoot(runtimeRoot)
      const applying = validReceipt({
        ...stored.value,
        status: "APPLY_IN_PROGRESS",
        applyStartedAt: new Date().toISOString(),
        applyToken: claim.value.token,
        applyProcessId: claim.value.processId,
      }, descriptor.manifest.id, id)
      writeReceipt(stored.files.receipt, applying, runtimeRoot, stored.bytes)
      return { ...stored, value: applying, bytes: fs.readFileSync(stored.files.receipt) }
    },
    applyClaimed: (_stored, proposalClaim, claim) => applyTransaction({
      descriptor, runtimeRoot, stored: proposalClaim, claim, validateWorkspace, transactionOperations,
    }),
  })
}
