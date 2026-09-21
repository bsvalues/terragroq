import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const MAX_EVIDENCE_BYTES = 128 * 1024

const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const text = (value) => typeof value === "string" && value.trim() === value && value.length > 0 && !/[\0\r\n]/.test(value)
const samePath = (left, right) => process.platform === "win32"
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  : path.resolve(left) === path.resolve(right)

function boundedFile(root, relative, code) {
  try {
    let cursor = path.resolve(root)
    for (const [index, segment] of relative.split("/").entries()) {
      cursor = path.join(cursor, segment)
      const stat = fs.lstatSync(cursor, { bigint: true })
      if (stat.isSymbolicLink() || !samePath(fs.realpathSync(cursor), cursor)
        || (index === relative.split("/").length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error()
    }
    const before = fs.lstatSync(cursor, { bigint: true })
    const size = Number(before.size)
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_EVIDENCE_BYTES || before.nlink !== 1n) throw new Error()
    const bytes = fs.readFileSync(cursor)
    const after = fs.lstatSync(cursor, { bigint: true })
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs) throw new Error()
    return bytes
  } catch { throw new Error(code) }
}

function json(bytes, code) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }
  catch { throw new Error(code) }
}

export function readResidentProposalPolicy(repositoryRoot, errorPrefix = "APPLICATION_PROPOSAL") {
  const code = `${errorPrefix}_POLICY_INVALID`
  try {
    const bytes = boundedFile(repositoryRoot, "config/execution-fabric/hermes-free-dev-agent-v2.policy.json", code)
    const value = json(bytes, code)
    if (value.schemaVersion !== 2 || value.packetSchemaVersion !== 3 || value.placement?.workspaceMode !== "OWNED_WORKTREE"
      || !text(value.placement.executionNode) || !text(value.model?.id)) throw new Error()
    return value
  } catch { throw new Error(code) }
}

/** Mirror the production invoker's workspace/state-root coupling before starting a costly turn. */
export function assertResidentProposalRuntimePolicy(reviewed, runtimeRoot, errorPrefix = "APPLICATION_PROPOSAL") {
  const code = `${errorPrefix}_POLICY_INVALID`
  try {
    if (typeof runtimeRoot !== "string" || !path.isAbsolute(runtimeRoot) || runtimeRoot.includes("\0")
      || !Array.isArray(reviewed?.placement?.allowedWorkspaceRoots)
      || reviewed.placement.allowedWorkspaceRoots.length !== 1
      || typeof reviewed.placement.allowedWorkspaceRoots[0] !== "string"
      || !path.isAbsolute(reviewed.placement.allowedWorkspaceRoots[0])
      || !samePath(reviewed.placement.allowedWorkspaceRoots[0], path.join(runtimeRoot, "worktrees"))
      || reviewed?.containment?.agentStatePersistence !== "PER_THREAD_STATE_DIR") throw new Error()
    return reviewed
  } catch { throw new Error(code) }
}

export function readResidentProposalEvidence({
  runtimeRoot,
  workspacePath,
  threadId,
  outcomes,
  reviewed,
  errorPrefix = "APPLICATION_PROPOSAL",
}) {
  const invalid = `${errorPrefix}_RESIDENT_EVIDENCE_INVALID`
  const ignoredRefused = `${errorPrefix}_IGNORED_PATH_REFUSED`
  try {
    if (!UUID.test(threadId) || !Array.isArray(outcomes) || !outcomes.length || !text(reviewed?.placement?.executionNode)) throw new Error()
    const prefix = `hermes-kernel/threads/${threadId}`
    const session = json(boundedFile(runtimeRoot, `${prefix}/session.json`, invalid), invalid)
    if (session.schemaVersion !== 1 || session.threadId !== threadId || !samePath(session.workspacePath, workspacePath)
      || !Array.isArray(session.turns) || session.turns.length !== outcomes.length) throw new Error()
    const ignored = []
    const seen = new Set()
    let finalPacket
    let finalTurnId
    for (const [index, outcome] of outcomes.entries()) {
      const record = session.turns[index]
      if (!UUID.test(record?.turnId) || seen.has(record.turnId) || record.exitCode !== 0 || record.failure !== undefined
        || record.harvested !== !outcome.failure || !SHA256.test(record.packetSha256)) throw new Error()
      seen.add(record.turnId)
      if (outcome.turn && (outcome.turn.turnId !== record.turnId || outcome.turn.threadId !== threadId || outcome.turn.status !== "completed")) throw new Error()
      if (outcome.recordId && outcome.recordId !== record.turnId) throw new Error()
      const packetBytes = boundedFile(runtimeRoot, `${prefix}/turns/${index + 1}/packet.json`, invalid)
      if (digest(packetBytes) !== record.packetSha256 || (outcome.packetSha256 && outcome.packetSha256 !== record.packetSha256)) throw new Error()
      const packet = json(packetBytes, invalid)
      if (packet.schemaVersion !== 3 || packet.runId !== record.turnId || packet.workspaceMode !== "OWNED_WORKTREE"
        || !samePath(packet.workspacePath, workspacePath) || !text(packet.model)) throw new Error()
      if (packet.placement !== undefined && !text(packet.placement?.computeId)) throw new Error()
      if (record.ignoredPathsCreated !== undefined) {
        if (!Array.isArray(record.ignoredPathsCreated) || record.ignoredPathsCreated.some((item) => !text(item))) throw new Error(ignoredRefused)
        ignored.push(...record.ignoredPathsCreated)
      }
      outcome.recordId = record.turnId
      outcome.packetSha256 = record.packetSha256
      finalPacket = packet
      finalTurnId = record.turnId
    }
    if (ignored.length) throw new Error(ignoredRefused)
    return {
      turnId: finalTurnId,
      model: finalPacket.model,
      executionNode: finalPacket.placement?.computeId ?? reviewed.placement.executionNode,
      ignoredPathsCreated: [...new Set(ignored)],
    }
  } catch (error) {
    if (error?.message === ignoredRefused) throw error
    throw new Error(invalid)
  }
}
