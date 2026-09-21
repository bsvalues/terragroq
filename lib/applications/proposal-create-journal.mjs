import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { isApplicationId } from "./application-identity.mjs"
import { readBoundedRegularFile } from "./proposal-artifacts.mjs"
import {
  applicationProposalProcessAlive,
  applicationProposalProcessIdentity,
} from "./proposal-repository-lock.mjs"
import { assertApplicationProposalRuntimePath, resolveApplicationProposalRuntimeRoot } from "./proposal-runtime-root.mjs"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{40,64}$/
const SHA256 = /^[0-9a-f]{64}$/
const PROCESS_IDENTITY = /^(?:win|linux|posix):[A-Za-z0-9 .:+-]{1,120}$/
const HEAD_REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,239}$/
const MAX_INTENT_BYTES = 32 * 1024
const MAX_CREATE_JOURNAL_ENTRIES = 128
const MAX_CREATE_INTENTS = 32
const activeCreateIntents = new Set()

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex")

function intentDirectory(runtimeRoot, applicationId) {
  if (!isApplicationId(applicationId)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  const runtime = resolveApplicationProposalRuntimeRoot(runtimeRoot)
  return assertApplicationProposalRuntimePath(
    runtime,
    path.join(runtime, "application-proposal-create-intents", applicationId),
    { allowMissing: true },
  )
}

function boundedDirectoryNames(runtimeRoot, directory) {
  assertApplicationProposalRuntimePath(runtimeRoot, directory)
  const names = []
  const handle = fs.opendirSync(directory)
  try {
    for (;;) {
      const entry = handle.readSync()
      if (entry === null) break
      names.push(entry.name)
      if (names.length > MAX_CREATE_JOURNAL_ENTRIES) {
        throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
      }
    }
  } catch {
    throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  } finally {
    try { handle.closeSync() } catch { /* the bounded scan already failed closed */ }
  }
  return names.sort()
}

function baseIntentPath(runtimeRoot, applicationId, proposalId) {
  if (!UUID.test(proposalId)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  return path.join(intentDirectory(runtimeRoot, applicationId), `${proposalId}.json`)
}

function phaseIntentPath(base, token, phase) {
  if (!UUID.test(token) || !["candidate", "publication"].includes(phase)) {
    throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  }
  return `${base}.${token}.${phase}.json`
}

function validPathList(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= 4
    && value.every((entry) => typeof entry === "string" && entry.length >= 3 && entry.length <= 160
      && !entry.includes("\\") && !entry.startsWith("/") && !entry.includes(".."))
    && new Set(value).size === value.length
}

function parseIntent(bytes, applicationId, proposalId, expectedPhase) {
  let value
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }
  catch { throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN") }
  const keys = [
    "schemaVersion", "applicationId", "proposalId", "manifestDigest", "repositoryDigest", "writablePaths",
    "baseRef", "baseSha", "branch", "workspaceName", "intentToken", "processId", "processIdentity",
    "startedAt", "phase", "candidateSha", "changedPaths", "patchSha256", "receiptSha256",
  ]
  const phaseShape = value?.phase === "WORKTREE_PENDING"
    ? value.candidateSha === null && value.changedPaths === null && value.patchSha256 === null && value.receiptSha256 === null
    : value?.phase === "CANDIDATE_BOUND"
      ? SHA.test(value.candidateSha) && value.changedPaths === null && value.patchSha256 === null && value.receiptSha256 === null
      : value?.phase === "PUBLICATION_BOUND"
        ? SHA.test(value.candidateSha) && validPathList(value.changedPaths) && SHA256.test(value.patchSha256)
          && SHA256.test(value.receiptSha256)
        : false
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== keys.sort().join(",") || value.schemaVersion !== 2
    || value.phase !== expectedPhase || value.applicationId !== applicationId || value.proposalId !== proposalId
    || !SHA256.test(value.manifestDigest) || !SHA256.test(value.repositoryDigest)
    || !validPathList(value.writablePaths) || !HEAD_REF.test(value.baseRef) || !SHA.test(value.baseSha)
    || value.branch !== `codex/williamos-app-${applicationId}-${proposalId}`
    || value.workspaceName !== `${applicationId}-${proposalId}` || !UUID.test(value.intentToken)
    || !Number.isSafeInteger(value.processId) || value.processId < 1
    || typeof value.processIdentity !== "string" || !PROCESS_IDENTITY.test(value.processIdentity)
    || typeof value.startedAt !== "string" || new Date(value.startedAt).toISOString() !== value.startedAt
    || !phaseShape
    || (Array.isArray(value.changedPaths) && value.changedPaths.some((entry) => !value.writablePaths.includes(entry)))) {
    throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  }
  return value
}

function readExact(target, applicationId, proposalId, phase, runtimeRoot) {
  try {
    if (runtimeRoot) assertApplicationProposalRuntimePath(runtimeRoot, target)
    const bytes = readBoundedRegularFile(target, {
      maxBytes: MAX_INTENT_BYTES,
      errorCode: "APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN",
    })
    return { value: parseIntent(bytes, applicationId, proposalId, phase), bytes }
  } catch { throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN") }
}

const encoded = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")

function publishExclusive(target, value, runtimeRoot) {
  const bytes = encoded(value)
  parseIntent(bytes, value.applicationId, value.proposalId, value.phase)
  const privatePath = `${target}.${value.intentToken}.${value.phase.toLowerCase()}.write`
  let descriptor
  let opened = false
  let linked = false
  let failure = null
  try {
    assertApplicationProposalRuntimePath(runtimeRoot, path.dirname(target))
    assertApplicationProposalRuntimePath(runtimeRoot, privatePath, { allowMissing: true })
    assertApplicationProposalRuntimePath(runtimeRoot, target, { allowMissing: true })
    descriptor = fs.openSync(privatePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
    opened = true
    let offset = 0
    while (offset < bytes.length) {
      const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) throw new Error()
      offset += count
    }
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    assertApplicationProposalRuntimePath(runtimeRoot, path.dirname(target))
    assertApplicationProposalRuntimePath(runtimeRoot, privatePath)
    assertApplicationProposalRuntimePath(runtimeRoot, target, { allowMissing: true })
    fs.linkSync(privatePath, target)
    linked = true
    // Do not let later phases accumulate additional private links. Retaining
    // this phase and stopping the transaction keeps the worst-case journal at
    // four entries per intent, within the scanner's 128-entry recovery bound.
    fs.unlinkSync(privatePath)
  } catch (error) {
    failure = error
  } finally { if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch { /* readback decides */ } }
  if (failure) {
    let cleaned = !opened || linked
    if (opened && !linked) {
      try {
        if (fs.existsSync(privatePath)) removeApplicationProposalCreateScratch(runtimeRoot, privatePath)
        cleaned = !fs.existsSync(privatePath)
      } catch { cleaned = false }
    }
    const error = new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    if (linked || !cleaned || failure?.code === "EEXIST") error.retainCreationIntent = true
    throw error
  }
  try {
    let observedBytes
    if (fs.existsSync(privatePath)) {
      assertApplicationProposalRuntimePath(runtimeRoot, privatePath)
      assertApplicationProposalRuntimePath(runtimeRoot, target)
      const privateStat = fs.lstatSync(privatePath, { bigint: true })
      const targetStat = fs.lstatSync(target, { bigint: true })
      if (privateStat.dev !== targetStat.dev || privateStat.ino !== targetStat.ino || privateStat.nlink < 2n) throw new Error()
      observedBytes = fs.readFileSync(target)
    } else {
      observedBytes = readExact(target, value.applicationId, value.proposalId, value.phase, runtimeRoot).bytes
    }
    if (!observedBytes.equals(bytes)) throw new Error()
    return { target, value: Object.freeze(value), bytes: observedBytes }
  } catch {
    const error = new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    error.retainCreationIntent = true
    throw error
  }
}

function sameBinding(left, right) {
  const keys = [
    "schemaVersion", "applicationId", "proposalId", "manifestDigest", "repositoryDigest", "writablePaths",
    "baseRef", "baseSha", "branch", "workspaceName", "intentToken", "processId", "processIdentity", "startedAt",
  ]
  return keys.every((key) => equal(left[key], right[key]))
}

function unlinkExact(record, runtimeRoot) {
  assertApplicationProposalRuntimePath(runtimeRoot, record.target)
  const observed = readExact(record.target, record.value.applicationId, record.value.proposalId, record.value.phase, runtimeRoot)
  if (!observed.bytes.equals(record.bytes)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  assertApplicationProposalRuntimePath(runtimeRoot, record.target)
  fs.unlinkSync(record.target)
  if (fs.existsSync(record.target)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
}

function handleFor(records, runtimeRoot) {
  const latest = records[records.length - 1]
  return Object.freeze({
    target: records[0].target,
    value: latest.value,
    bytes: latest.bytes,
    records: Object.freeze(records.map((record) => Object.freeze(record))),
    runtimeRoot,
  })
}

export function publishApplicationProposalCreateIntent({
  runtimeRoot, applicationId, proposalId, manifestDigest, repositoryDigest, writablePaths,
  baseRef, baseSha, branch, workspaceName, intentToken, startedAt,
}) {
  const target = baseIntentPath(runtimeRoot, applicationId, proposalId)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  assertApplicationProposalRuntimePath(runtimeRoot, path.dirname(target))
  const value = {
    schemaVersion: 2, applicationId, proposalId, manifestDigest, repositoryDigest,
    writablePaths: [...writablePaths], baseRef, baseSha, branch, workspaceName, intentToken,
    processId: process.pid, processIdentity: applicationProposalProcessIdentity(), startedAt,
    phase: "WORKTREE_PENDING", candidateSha: null, changedPaths: null, patchSha256: null, receiptSha256: null,
  }
  const record = publishExclusive(target, value, runtimeRoot)
  activeCreateIntents.add(intentToken)
  return handleFor([record], runtimeRoot)
}

export function bindApplicationProposalCreateCandidate(handle, candidateSha) {
  const value = { ...handle.value, phase: "CANDIDATE_BOUND", candidateSha }
  if (!sameBinding(handle.records[0].value, value)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  const target = phaseIntentPath(handle.target, value.intentToken, "candidate")
  return handleFor([...handle.records, publishExclusive(target, value, handle.runtimeRoot)], handle.runtimeRoot)
}

export function bindApplicationProposalCreatePublication(handle, { candidateSha, changedPaths, patchBytes, receiptBytes }) {
  if (!Buffer.isBuffer(patchBytes) || !Buffer.isBuffer(receiptBytes) || handle.value.phase !== "CANDIDATE_BOUND"
    || handle.value.candidateSha !== candidateSha) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  const value = {
    ...handle.value,
    phase: "PUBLICATION_BOUND",
    changedPaths: [...changedPaths],
    patchSha256: digest(patchBytes),
    receiptSha256: digest(receiptBytes),
  }
  if (!sameBinding(handle.records[0].value, value)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  const target = phaseIntentPath(handle.target, value.intentToken, "publication")
  return handleFor([...handle.records, publishExclusive(target, value, handle.runtimeRoot)], handle.runtimeRoot)
}

export function deactivateApplicationProposalCreateIntent(handle) {
  if (handle?.value?.intentToken) activeCreateIntents.delete(handle.value.intentToken)
}

export function releaseApplicationProposalCreateIntent(handle) {
  try {
    // The publication record is deleted last. A crash during release therefore
    // always leaves the exact receipt/patch digests needed to prove completion.
    for (const record of handle.records) unlinkExact(record, handle.runtimeRoot)
  } finally { deactivateApplicationProposalCreateIntent(handle) }
}

export function applicationProposalCreateIntentOwnerAlive(value) {
  if (!applicationProposalProcessAlive(value)) return false
  return value.processId !== process.pid || activeCreateIntents.has(value.intentToken)
}

export function hasApplicationProposalCreateIntentEntries(runtimeRoot, applicationId) {
  const directory = intentDirectory(runtimeRoot, applicationId)
  if (!fs.existsSync(directory)) return false
  assertApplicationProposalRuntimePath(runtimeRoot, directory)
  const handle = fs.opendirSync(directory)
  try { return handle.readSync() !== null }
  catch { throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN") }
  finally { try { handle.closeSync() } catch { /* an existence probe has no retained handle */ } }
}

export function listApplicationProposalCreateIntents(runtimeRoot, applicationId) {
  const directory = intentDirectory(runtimeRoot, applicationId)
  if (!fs.existsSync(directory)) return []
  let names = boundedDirectoryNames(runtimeRoot, directory)
  const pendingWrites = []
  for (const name of names.filter((entry) => entry.endsWith(".write"))) {
    const match = /^(.*\.json)\.([0-9a-f-]{36})\.(worktree_pending|candidate_bound|publication_bound)\.write$/i.exec(name)
    if (!match || !UUID.test(match[2])) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    const writePath = path.join(directory, name)
    const target = path.join(directory, match[1])
    if (fs.existsSync(target)) {
      const writeStat = fs.lstatSync(writePath, { bigint: true })
      const targetStat = fs.lstatSync(target, { bigint: true })
      if (!writeStat.isFile() || writeStat.isSymbolicLink() || !targetStat.isFile() || targetStat.isSymbolicLink()
        || writeStat.dev !== targetStat.dev || writeStat.ino !== targetStat.ino || writeStat.nlink < 2n) {
        throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
      }
      fs.unlinkSync(writePath)
    } else if (match[3].toLowerCase() === "worktree_pending") {
      // beginCreate has not returned, so no Git mutation can yet be owned by
      // this partial base publication.
      removeApplicationProposalCreateScratch(runtimeRoot, writePath)
    } else {
      pendingWrites.push({ name, targetName: match[1], token: match[2] })
    }
  }
  names = boundedDirectoryNames(runtimeRoot, directory)
  const groups = new Map()
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    const base = /^([0-9a-f-]{36})\.json$/i.exec(name)
    const phase = /^([0-9a-f-]{36})\.json\.([0-9a-f-]{36})\.(candidate|publication)\.json$/i.exec(name)
    const proposalId = base?.[1] ?? phase?.[1]
    if (!proposalId || !UUID.test(proposalId) || (phase && !UUID.test(phase[2]))) {
      throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    }
    if (!groups.has(proposalId)) groups.set(proposalId, { proposalId, base: null, candidate: null, publication: null })
    if (groups.size > MAX_CREATE_INTENTS) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    const group = groups.get(proposalId)
    if (base) group.base = name
    else group[phase[3].toLowerCase()] = name
  }
  const consumed = new Set()
  const handles = [...groups.values()].map((group) => {
    const { proposalId } = group
    const base = baseIntentPath(runtimeRoot, applicationId, proposalId)
    const records = []
    for (const [key, phase] of [["base", "WORKTREE_PENDING"], ["candidate", "CANDIDATE_BOUND"], ["publication", "PUBLICATION_BOUND"]]) {
      const name = group[key]
      if (!name) continue
      const target = path.join(directory, name)
      const record = readExact(target, applicationId, proposalId, phase, runtimeRoot)
      if (records.length && !sameBinding(records[0].value, record.value)) {
        throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
      }
      if ((key === "candidate" || key === "publication")
        && name !== path.basename(phaseIntentPath(base, record.value.intentToken, key))) {
        throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
      }
      records.push({ target, ...record })
      consumed.add(name)
    }
    if (!records.length) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    const writes = pendingWrites.filter((entry) => entry.name.startsWith(`${proposalId}.json.`))
    for (const entry of writes) {
      if (entry.token !== records[0].value.intentToken) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
      consumed.add(entry.name)
    }
    return Object.freeze({ ...handleFor(records, runtimeRoot), writeResidues: Object.freeze(writes.map((entry) => path.join(directory, entry.name))) })
  })
  if (consumed.size !== names.length) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  return handles
}

/** Admission is checked while the caller holds the repository recovery claim,
 * so concurrent Creates cannot publish a state that the bounded scanner could
 * no longer enumerate after a process death. */
export function assertApplicationProposalCreateCapacity(runtimeRoot, applicationId) {
  if (listApplicationProposalCreateIntents(runtimeRoot, applicationId).length >= MAX_CREATE_INTENTS) {
    throw new Error("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
  }
}

export function removeApplicationProposalCreateWriteResidues(runtimeRoot, handle) {
  for (const target of handle.writeResidues ?? []) removeApplicationProposalCreateScratch(runtimeRoot, target)
}

export function removeApplicationProposalCreateArtifact(runtimeRoot, target, expectedSha256) {
  if (!SHA256.test(expectedSha256)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  assertApplicationProposalRuntimePath(runtimeRoot, target)
  const before = fs.lstatSync(target, { bigint: true })
  const bytes = readBoundedRegularFile(target, {
    maxBytes: 256 * 1024,
    errorCode: "APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN",
  })
  const after = fs.lstatSync(target, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
    || String(before.dev) !== String(after.dev) || String(before.ino) !== String(after.ino)
    || digest(bytes) !== expectedSha256) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  fs.unlinkSync(target)
  if (fs.existsSync(target)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
}

export function removeApplicationProposalCreateScratch(runtimeRoot, target) {
  assertApplicationProposalRuntimePath(runtimeRoot, target)
  const before = fs.lstatSync(target, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  }
  fs.unlinkSync(target)
  if (fs.existsSync(target)) throw new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
}
