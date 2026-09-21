import fs from "node:fs"
import path from "node:path"

import { isApplicationId } from "./application-identity.mjs"
import { assertApplicationProposalRuntimePath, resolveApplicationProposalRuntimeRoot } from "./proposal-runtime-root.mjs"

export const APPLICATION_PROPOSAL_LIST_LIMIT = 32

const INDEX_NAME = ".listing.v1.json"
const MAX_INDEX_BYTES = 8 * 1024
const MAX_BOOTSTRAP_ENTRIES = 128
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPERATION_TOKEN = /^(?:bootstrap|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

// Index publication uses captured intrinsics after its one supported test
// checkpoint. This matches the repository-lock portable boundary: after the
// final parent identity check there is no callback, await, or mutable fs
// lookup before the path operation.
const closeSync = fs.closeSync.bind(fs)
const fstatSync = fs.fstatSync.bind(fs)
const fsyncSync = fs.fsyncSync.bind(fs)
const lstatSync = fs.lstatSync.bind(fs)
const mkdirSync = fs.mkdirSync.bind(fs)
const openSync = fs.openSync.bind(fs)
const opendirSync = fs.opendirSync.bind(fs)
const readSync = fs.readSync.bind(fs)
const realpathSync = fs.realpathSync.bind(fs)
const renameSync = fs.renameSync.bind(fs)
const unlinkSync = fs.unlinkSync.bind(fs)
const writeSync = fs.writeSync.bind(fs)

const fail = () => { throw new Error("APPLICATION_PROPOSAL_LISTING_UNCERTAIN") }
const sameIdentity = (left, right) => !!left && !!right
  && String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino)
const samePath = (left, right) => process.platform === "win32"
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  : path.resolve(left) === path.resolve(right)
const compareProposalEntries = (left, right) => left.createdAt.localeCompare(right.createdAt)
  || left.proposalId.localeCompare(right.proposalId)

function capturedExists(target) {
  try { lstatSync(target); return true }
  catch (error) {
    if (error?.code === "ENOENT") return false
    return fail()
  }
}

function indexPaths(runtimeRoot, applicationId) {
  if (!isApplicationId(applicationId)) fail()
  let runtime
  try { runtime = resolveApplicationProposalRuntimeRoot(runtimeRoot) } catch { return fail() }
  const directory = assertApplicationProposalRuntimePath(
    runtime,
    path.join(runtime, "application-proposals", applicationId),
    { allowMissing: true },
  )
  return Object.freeze({ runtime, directory, index: path.join(directory, INDEX_NAME) })
}

function observedDirectoryIdentity(directory) {
  try {
    const stat = lstatSync(directory, { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(realpathSync(directory), directory)) fail()
    return Object.freeze({ dev: stat.dev, ino: stat.ino })
  } catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_LISTING_UNCERTAIN") throw error
    return fail()
  }
}

function directoryIdentity(runtimeRoot, directory) {
  try { assertApplicationProposalRuntimePath(runtimeRoot, directory) }
  catch { return fail() }
  return observedDirectoryIdentity(directory)
}

function assertSameDirectory(directory, identity) {
  if (!sameIdentity(observedDirectoryIdentity(directory), identity)) fail()
}

function parseIndex(bytes, applicationId) {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    const keys = ["applicationId", "limit", "proposals", "schemaVersion", "truncated"]
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== keys.sort().join(",")
      || value.schemaVersion !== 1 || value.applicationId !== applicationId
      || value.limit !== APPLICATION_PROPOSAL_LIST_LIMIT || typeof value.truncated !== "boolean"
      || !Array.isArray(value.proposals) || value.proposals.length > APPLICATION_PROPOSAL_LIST_LIMIT
      || value.proposals.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry)
        || Object.keys(entry).sort().join(",") !== "createdAt,proposalId"
        || typeof entry.proposalId !== "string" || !UUID.test(entry.proposalId)
        || typeof entry.createdAt !== "string" || !Number.isFinite(Date.parse(entry.createdAt))
        || new Date(entry.createdAt).toISOString() !== entry.createdAt)
      || new Set(value.proposals.map((entry) => entry.proposalId.toLowerCase())).size !== value.proposals.length) fail()
    const proposals = value.proposals.map((entry) => Object.freeze({
      proposalId: entry.proposalId,
      createdAt: entry.createdAt,
    }))
    if (JSON.stringify(proposals) !== JSON.stringify([...proposals].sort(compareProposalEntries))) fail()
    return Object.freeze({
      schemaVersion: 1,
      applicationId,
      limit: APPLICATION_PROPOSAL_LIST_LIMIT,
      truncated: value.truncated,
      proposals: Object.freeze(proposals),
      proposalIds: Object.freeze(proposals.map((entry) => entry.proposalId)),
    })
  } catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_LISTING_UNCERTAIN") throw error
    return fail()
  }
}

function readExactFile(paths, target, parentIdentity, { allowMissing = false } = {}) {
  let descriptor
  try {
    assertSameDirectory(paths.directory, parentIdentity)
    let before
    try { before = lstatSync(target, { bigint: true }) }
    catch (error) {
      if (allowMissing && error?.code === "ENOENT") {
        assertSameDirectory(paths.directory, parentIdentity)
        return null
      }
      return fail()
    }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
      || before.size < 0n || before.size > BigInt(MAX_INDEX_BYTES)) fail()
    const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)
    descriptor = openSync(target, fs.constants.O_RDONLY | noFollow)
    const opened = fstatSync(descriptor, { bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n || opened.size !== before.size || !sameIdentity(opened, before)) fail()
    const bytes = Buffer.alloc(Number(opened.size))
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) fail()
      offset += count
    }
    const probe = Buffer.alloc(1)
    if (readSync(descriptor, probe, 0, 1, bytes.length) !== 0) fail()
    const afterDescriptor = fstatSync(descriptor, { bigint: true })
    const afterPath = lstatSync(target, { bigint: true })
    if (!afterDescriptor.isFile() || !afterPath.isFile() || afterPath.isSymbolicLink()
      || afterDescriptor.nlink !== 1n || afterPath.nlink !== 1n
      || afterDescriptor.size !== opened.size || afterPath.size !== opened.size
      || !sameIdentity(opened, afterDescriptor) || !sameIdentity(afterDescriptor, afterPath)
      || afterDescriptor.mtimeNs !== opened.mtimeNs || afterDescriptor.ctimeNs !== opened.ctimeNs) fail()
    assertSameDirectory(paths.directory, parentIdentity)
    return Object.freeze({
      bytes,
      identity: Object.freeze({ dev: afterPath.dev, ino: afterPath.ino }),
    })
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") {
      assertSameDirectory(paths.directory, parentIdentity)
      return null
    }
    if (error?.message === "APPLICATION_PROPOSAL_LISTING_UNCERTAIN") throw error
    return fail()
  } finally { if (descriptor !== undefined) try { closeSync(descriptor) } catch { /* read result already decided */ } }
}

function readRecordAtPaths(paths, applicationId, { allowMissing = false, parentIdentity } = {}) {
  const parent = parentIdentity ?? directoryIdentity(paths.runtime, paths.directory)
  const observed = readExactFile(paths, paths.index, parent, { allowMissing })
  if (observed === null) return null
  return Object.freeze({
    paths,
    parentIdentity: parent,
    bytes: observed.bytes,
    identity: observed.identity,
    value: parseIndex(observed.bytes, applicationId),
  })
}

function readRecord(runtimeRoot, applicationId, { allowMissing = false } = {}) {
  const paths = indexPaths(runtimeRoot, applicationId)
  if (!capturedExists(paths.directory)) {
    if (allowMissing) return null
    return fail()
  }
  return readRecordAtPaths(paths, applicationId, { allowMissing })
}

function encodedIndex(applicationId, proposals, truncated) {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    applicationId,
    limit: APPLICATION_PROPOSAL_LIST_LIMIT,
    truncated,
    proposals,
  }, null, 2)}\n`, "utf8")
}

function removeOwnedWriteResidue(paths, target, parentIdentity) {
  let before
  try { before = lstatSync(target, { bigint: true }) }
  catch (error) {
    if (error?.code === "ENOENT") return
    return fail()
  }
  try {
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) fail()
    assertSameDirectory(paths.directory, parentIdentity)
    const immediatelyBefore = lstatSync(target, { bigint: true })
    if (!immediatelyBefore.isFile() || immediatelyBefore.isSymbolicLink() || immediatelyBefore.nlink !== 1n
      || !sameIdentity(before, immediatelyBefore)) fail()
    unlinkSync(target)
    assertSameDirectory(paths.directory, parentIdentity)
    if (capturedExists(target)) fail()
  } catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_LISTING_UNCERTAIN") throw error
    return fail()
  }
}

function syncDirectory(directory) {
  let descriptor
  try {
    descriptor = openSync(directory, fs.constants.O_RDONLY)
    fsyncSync(descriptor)
  } catch (error) {
    // Windows commonly refuses directory fsync. The file itself is fsynced,
    // and atomic same-directory rename remains the portable durability edge.
    if (!(["EINVAL", "EPERM", "EACCES", "EBADF"].includes(error?.code))) fail()
  } finally { if (descriptor !== undefined) try { closeSync(descriptor) } catch { /* durability attempt is complete */ } }
}

function sameRecord(actual, expected) {
  if (actual === null || expected === null) return actual === expected
  return actual.bytes.equals(expected.bytes) && sameIdentity(actual.identity, expected.identity)
}

function writeIndex({
  runtimeRoot,
  applicationId,
  operationToken,
  expectedRecord,
  proposals,
  truncated,
  transactionOperations = {},
}) {
  if (!OPERATION_TOKEN.test(operationToken) || !Array.isArray(proposals)
    || proposals.length > APPLICATION_PROPOSAL_LIST_LIMIT || typeof truncated !== "boolean"
    || !transactionOperations || typeof transactionOperations !== "object"
    || (transactionOperations.checkpoint !== undefined && typeof transactionOperations.checkpoint !== "function")) fail()
  const bytes = encodedIndex(applicationId, proposals, truncated)
  parseIndex(bytes, applicationId)
  const paths = indexPaths(runtimeRoot, applicationId)
  let cleanupParent = null
  let temporary = null
  try {
    mkdirSync(paths.directory, { recursive: true })
    const parentIdentity = directoryIdentity(paths.runtime, paths.directory)
    cleanupParent = parentIdentity
    temporary = `${paths.index}.${operationToken}.write`
    removeOwnedWriteResidue(paths, temporary, parentIdentity)

    const current = readRecordAtPaths(paths, applicationId, { allowMissing: true, parentIdentity })
    if (!sameRecord(current, expectedRecord)) fail()
    if (current?.bytes.equals(bytes)) return current.value

    const checkpointResult = transactionOperations.checkpoint?.("before_index_private_open", {
      applicationId,
      operationToken,
    })
    if (checkpointResult !== undefined) fail()
    // No callback, await, or mutable fs lookup occurs between this identity
    // check and the captured path open.
    assertSameDirectory(paths.directory, parentIdentity)
    let descriptor
    let temporaryIdentity
    try {
      const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)
      descriptor = openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow, 0o600)
      let offset = 0
      while (offset < bytes.length) {
        const count = writeSync(descriptor, bytes, offset, bytes.length - offset, offset)
        if (count <= 0) fail()
        offset += count
      }
      fsyncSync(descriptor)
      const opened = fstatSync(descriptor, { bigint: true })
      if (!opened.isFile() || opened.nlink !== 1n || opened.size !== BigInt(bytes.length)) fail()
      temporaryIdentity = Object.freeze({ dev: opened.dev, ino: opened.ino })
    } finally { if (descriptor !== undefined) closeSync(descriptor) }

    assertSameDirectory(paths.directory, parentIdentity)
    const staged = readExactFile(paths, temporary, parentIdentity)
    if (!sameIdentity(staged.identity, temporaryIdentity) || !staged.bytes.equals(bytes)) fail()
    const unchanged = readRecordAtPaths(paths, applicationId, { allowMissing: true, parentIdentity })
    if (!sameRecord(unchanged, expectedRecord)) fail()
    assertSameDirectory(paths.directory, parentIdentity)
    const immediatelyBefore = lstatSync(temporary, { bigint: true })
    if (!immediatelyBefore.isFile() || immediatelyBefore.isSymbolicLink() || immediatelyBefore.nlink !== 1n
      || !sameIdentity(immediatelyBefore, temporaryIdentity)) fail()
    renameSync(temporary, paths.index)
    assertSameDirectory(paths.directory, parentIdentity)
    const published = readRecordAtPaths(paths, applicationId, { parentIdentity })
    if (!published.bytes.equals(bytes)) fail()
    syncDirectory(paths.directory)
    return published.value
  } catch (error) {
    if (error?.message === "APPLICATION_PROPOSAL_LISTING_UNCERTAIN") throw error
    return fail()
  } finally {
    if (cleanupParent && temporary) {
      try {
        assertSameDirectory(paths.directory, cleanupParent)
        removeOwnedWriteResidue(paths, temporary, cleanupParent)
      } catch (error) {
        if (error?.message === "APPLICATION_PROPOSAL_LISTING_UNCERTAIN") throw error
        fail()
      }
    }
  }
}

export function readApplicationProposalListIndex({ runtimeRoot, applicationId, allowMissing = false }) {
  const record = readRecord(runtimeRoot, applicationId, { allowMissing })
  return record?.value ?? null
}

export function addApplicationProposalToListIndex({
  runtimeRoot,
  applicationId,
  proposalId,
  createdAt,
  operationToken,
  transactionOperations,
}) {
  if (typeof proposalId !== "string" || !UUID.test(proposalId) || typeof createdAt !== "string"
    || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) fail()
  const record = readRecord(runtimeRoot, applicationId)
  const existing = record.value.proposals.find((entry) => entry.proposalId.toLowerCase() === proposalId.toLowerCase())
  if (existing && existing.createdAt !== createdAt) fail()
  const accumulated = [
    ...record.value.proposals.filter((entry) => entry.proposalId.toLowerCase() !== proposalId.toLowerCase()),
    { proposalId, createdAt },
  ].sort(compareProposalEntries)
  const overflowed = accumulated.length > APPLICATION_PROPOSAL_LIST_LIMIT
  return writeIndex({
    runtimeRoot,
    applicationId,
    operationToken,
    expectedRecord: record,
    proposals: accumulated.slice(-APPLICATION_PROPOSAL_LIST_LIMIT),
    truncated: record.value.truncated || overflowed,
    transactionOperations,
  })
}

export function bootstrapApplicationProposalListIndex({
  runtimeRoot,
  applicationId,
  describeProposal,
  transactionOperations,
}) {
  if (typeof describeProposal !== "function") fail()
  const existing = readRecord(runtimeRoot, applicationId, { allowMissing: true })
  if (existing) return existing.value
  const paths = indexPaths(runtimeRoot, applicationId)
  const proposalIds = new Set()
  if (capturedExists(paths.directory)) {
    const before = directoryIdentity(paths.runtime, paths.directory)
    let handle
    try {
      handle = opendirSync(paths.directory)
      let count = 0
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        count += 1
        if (count > MAX_BOOTSTRAP_ENTRIES) fail()
        const matched = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\.quarantine)?\.json$/i.exec(entry.name)
        if (matched) proposalIds.add(matched[1])
      }
    } catch (error) {
      if (error?.message === "APPLICATION_PROPOSAL_LISTING_UNCERTAIN") throw error
      return fail()
    } finally { if (handle) try { handle.closeSync() } catch { /* identity validation follows */ } }
    assertSameDirectory(paths.directory, before)
  }
  const described = [...proposalIds].map((proposalId) => {
    let value
    try { value = describeProposal(proposalId) } catch { return fail() }
    if (!value || typeof value !== "object" || typeof value.createdAt !== "string"
      || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) fail()
    return { proposalId, createdAt: value.createdAt }
  }).sort(compareProposalEntries)
  return writeIndex({
    runtimeRoot,
    applicationId,
    operationToken: "bootstrap",
    expectedRecord: null,
    proposals: described.slice(-APPLICATION_PROPOSAL_LIST_LIMIT),
    truncated: described.length > APPLICATION_PROPOSAL_LIST_LIMIT,
    transactionOperations,
  })
}
