import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { AppServerTimeoutError, AppServerTurnEndedError, AppServerWallError, sanitizeAppServerText } from "./app-server-client.mjs"
import { harvestTurnOutput, HERMES_FREE_AGENT_COMPLETE_PATTERN, validateAgainstTurnSchema } from "./hermes-kernel-output.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "./prompt.mjs"

export const HERMES_KERNEL_POLICY_RELATIVE = "config/execution-fabric/hermes-free-dev-agent-v2.policy.json"
export const HERMES_KERNEL_INVOKER_RELATIVE = "scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1"
export const HERMES_KERNEL_QUARANTINE_MARKER = "HERMES_FREE_AGENT_QUARANTINED"
const SESSION_SCHEMA_VERSION = 1

export function kernelThreadsRoot(runtimeRoot) {
  return path.join(path.resolve(runtimeRoot), "hermes-kernel", "threads")
}

export function kernelQuarantinePath(runtimeRoot) {
  return path.join(path.resolve(runtimeRoot), "hermes-kernel", HERMES_KERNEL_QUARANTINE_MARKER)
}

function wall(code, method = "hermes-kernel") { return new AppServerWallError(code, method) }

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) throw new TypeError(`${name} must be a non-empty string`)
  return value
}

function realNoSymlink(target) {
  const resolved = path.resolve(target)
  const root = path.parse(resolved).root
  let cursor = root
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    if (fs.lstatSync(cursor).isSymbolicLink()) throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect")
  }
  return fs.realpathSync(resolved)
}

function isInside(child, parent) {
  const relative = path.relative(parent, child)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

export function buildKernelPromptEpilogue() {
  return [
    "Finish by printing exactly one fenced ```json block that satisfies the following JSON schema, and print nothing after it.",
    "Do not commit, push, open PRs, or touch paths outside the reservations named above.",
    JSON.stringify(HERMES_TURN_OUTPUT_SCHEMA),
  ].join("\n")
}

export const KERNEL_STATE_DIR = "kernel-state"
export const KERNEL_SESSION_ID_PATTERN = /^Session:[ \t]+([A-Za-z0-9_-]{4,64})[ \t]*$/m

export function buildKernelPacket({ policy, prompt, workspacePath, runId, statePath, kernelSessionId = null }) {
  return {
    schemaVersion: 3,
    workOrderId: policy.workOrderId,
    model: policy.model.id,
    prompt: `${prompt}\n\n${buildKernelPromptEpilogue()}`,
    maximumTurns: policy.execution.maximumTurns,
    toolsets: [...policy.execution.allowedToolsets],
    workspaceMode: "OWNED_WORKTREE",
    workspacePath,
    runId,
    statePath,
    kernelSessionId,
  }
}

// Wall tokens are only believed at the start of a line: the model's own stdout is
// interleaved with the invoker's, and a model that merely *mentions* a wall token
// mid-sentence must not be able to forge a lane verdict.
const WALL_TOKEN = /^HERMES_FREE_AGENT_[A-Z_]+_WALL/m
const TIMEOUT_WALL = /^HERMES_FREE_AGENT_TIMEOUT_WALL/m
const EXECUTION_WALL = /^HERMES_FREE_AGENT_EXECUTION_WALL/m
const GIT_COMMON_DIR_ARGS = ["rev-parse", "--path-format=absolute", "--git-common-dir"]
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex")

export function createHermesKernelClient({
  workspacePath,
  runtimeRoot,
  commandRunner,
  policyPath = path.resolve(HERMES_KERNEL_POLICY_RELATIVE),
  invokerPath = path.resolve(HERMES_KERNEL_INVOKER_RELATIVE),
  timeoutMs = 45 * 60 * 1000,
  now = () => new Date(),
  powershellCommand = process.platform === "win32" ? "powershell" : "pwsh",
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  requiredString(workspacePath, "workspacePath"); requiredString(runtimeRoot, "runtimeRoot")
  if (typeof commandRunner !== "function") throw new TypeError("commandRunner must be a function")
  const threadsRoot = kernelThreadsRoot(runtimeRoot)
  const worktreesRoot = path.join(path.resolve(runtimeRoot), "worktrees")
  const quarantinePath = kernelQuarantinePath(runtimeRoot)
  let connected = false

  const readPolicy = () => {
    let policy
    try { policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) } catch { throw wall("RESIDENT_MODEL_LANE_POLICY_UNREADABLE", "connect") }
    if (!["PILOT_AUTHORIZED", "PROMOTED"].includes(policy?.promotion?.status)) throw wall("RESIDENT_MODEL_LANE_NOT_AUTHORIZED", "connect")
    if (policy?.placement?.workspaceMode !== "OWNED_WORKTREE") throw wall("RESIDENT_MODEL_LANE_WORKSPACE_MODE", "connect")
    if (policy?.containment?.agentStatePersistence !== "PER_THREAD_STATE_DIR") throw wall("RESIDENT_MODEL_LANE_STATE_MODE", "connect")
    // The lane is closed until every declared evidence line is actually satisfied;
    // a declared-but-null entry is an unproven control, not a formality.
    const satisfied = policy?.promotion?.satisfiedEvidence ?? {}
    for (const key of Array.isArray(policy?.promotion?.requiredEvidence) ? policy.promotion.requiredEvidence : []) {
      const value = satisfied?.[key]
      if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
        throw wall("RESIDENT_MODEL_LANE_EVIDENCE_UNPROVEN", "connect")
      }
    }
    return policy
  }
  const assertUnquarantined = () => {
    for (const marker of [path.join(path.dirname(policyPath), HERMES_KERNEL_QUARANTINE_MARKER), quarantinePath]) {
      if (fs.existsSync(marker)) throw wall("RESIDENT_MODEL_LANE_QUARANTINED", "connect")
    }
  }
  const assertOwnedWorkspace = () => {
    let real
    try { real = realNoSymlink(workspacePath) } catch (error) { if (error instanceof AppServerWallError) throw error; throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect") }
    let worktreesReal
    try { worktreesReal = fs.realpathSync(worktreesRoot) } catch { throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect") }
    if (!isInside(real, worktreesReal) || !fs.statSync(real).isDirectory()) throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect")
    // Intra-worktree escape hatches: a top-level reparse point re-points the mount out of
    // the worktree, and node_modules is a bin/symlink farm the kernel must never inherit.
    if (fs.existsSync(path.join(real, "node_modules"))) throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect")
    let entries
    try { entries = fs.readdirSync(real) } catch { throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect") }
    for (const entry of entries) {
      let stats
      try { stats = fs.lstatSync(path.join(real, entry)) } catch { continue }
      if (stats.isSymbolicLink()) throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect")
    }
    return real
  }
  const assertInvokerPresent = () => {
    if (!fs.existsSync(invokerPath)) throw wall("RESIDENT_MODEL_LANE_INVOKER_MISSING", "connect")
  }

  const gitCommonDir = async (cwd, turnTimeoutMs) => {
    let result
    try {
      result = await commandRunner({
        command: "git", args: ["-C", cwd, ...GIT_COMMON_DIR_ARGS], cwd, timeoutMs: turnTimeoutMs, credentialAccess: false,
      })
    } catch { return null }
    const exitCode = result?.exitCode ?? result?.code ?? result?.status ?? 0
    const value = String(result?.stdout ?? "").trim()
    if (exitCode !== 0 || value.length === 0) return null
    return path.resolve(value)
  }

  const sessionPath = (threadId) => path.join(threadsRoot, threadId, "session.json")
  const readSession = (threadId) => {
    if (typeof threadId !== "string" || !/^[0-9a-f-]{36}$/i.test(threadId)) throw wall("RESIDENT_MODEL_THREAD_UNKNOWN", "resumeThread")
    let session
    try { session = JSON.parse(fs.readFileSync(sessionPath(threadId), "utf8")) } catch { throw wall("RESIDENT_MODEL_THREAD_UNKNOWN", "resumeThread") }
    if (session?.schemaVersion !== SESSION_SCHEMA_VERSION || session.threadId !== threadId) throw wall("RESIDENT_MODEL_THREAD_UNKNOWN", "resumeThread")
    return session
  }
  const writeSession = (session) => {
    fs.mkdirSync(path.dirname(sessionPath(session.threadId)), { recursive: true })
    fs.writeFileSync(sessionPath(session.threadId), `${JSON.stringify(session, null, 2)}\n`)
  }

  const client = {
    async connect() {
      const policy = readPolicy(); assertUnquarantined(); assertOwnedWorkspace(); assertInvokerPresent()
      // Spec §4 item 6: the kernel's own deadline must fit inside the orchestrator's turn budget.
      const kernelTimeoutMs = Number(policy?.execution?.timeoutSeconds ?? 0) * 1000
      if (!(timeoutMs >= kernelTimeoutMs)) throw wall("RESIDENT_MODEL_LANE_TIMEOUT", "connect")
      connected = true
    },
    async startThread() {
      if (!connected) throw wall("RESIDENT_MODEL_LANE_NOT_CONNECTED", "startThread")
      const threadId = randomUUID()
      fs.mkdirSync(path.join(threadsRoot, threadId, KERNEL_STATE_DIR), { recursive: true })
      writeSession({ schemaVersion: SESSION_SCHEMA_VERSION, threadId, workspacePath, createdAt: now().toISOString(), kernelSessionId: null, turns: [] })
      return threadId
    },
    async resumeThread(threadId) {
      const session = readSession(threadId)
      if (path.resolve(session.workspacePath) !== path.resolve(workspacePath)) throw wall("RESIDENT_MODEL_THREAD_WORKSPACE_MISMATCH", "resumeThread")
      if (readPolicy()?.execution?.sessionResumeProven !== true) throw wall("RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE", "resumeThread")
      if (typeof session.kernelSessionId !== "string" || session.kernelSessionId.length === 0
        || !fs.existsSync(path.join(threadsRoot, threadId, KERNEL_STATE_DIR))) throw wall("RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE", "resumeThread")
      return threadId
    },
    async runTurn({ threadId, prompt, turn, timeoutMs: turnTimeoutMs = timeoutMs } = {}) {
      if (!connected) throw wall("RESIDENT_MODEL_LANE_NOT_CONNECTED", "runTurn")
      const session = readSession(threadId)
      const policy = readPolicy(); assertUnquarantined(); const workspaceReal = assertOwnedWorkspace(); assertInvokerPresent()
      const text = requiredString(prompt, "prompt")
      const runId = randomUUID()
      const statePath = path.join(threadsRoot, threadId, KERNEL_STATE_DIR)
      fs.mkdirSync(statePath, { recursive: true })
      const kernelSessionId = typeof session.kernelSessionId === "string" && session.kernelSessionId.length > 0 ? session.kernelSessionId : null
      const packet = buildKernelPacket({ policy, prompt: text, workspacePath: workspaceReal, runId, statePath, kernelSessionId })
      if (packet.prompt.length > (policy.execution?.promptMaxChars ?? 16000)) throw wall("RESIDENT_MODEL_PROMPT_TOO_LONG", "runTurn")
      const turnIndex = session.turns.length + 1
      const turnDir = path.join(threadsRoot, threadId, "turns", String(turnIndex))
      fs.mkdirSync(turnDir, { recursive: true })
      const packetPath = path.join(turnDir, "packet.json")
      const packetBytes = `${JSON.stringify(packet, null, 2)}\n`
      fs.writeFileSync(packetPath, packetBytes, { mode: 0o600 })
      const stdoutPath = path.join(turnDir, "stdout.txt")
      const commonDirBefore = await gitCommonDir(workspaceReal, turnTimeoutMs)
      if (commonDirBefore === null) throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "runTurn")
      let result
      try {
        result = await commandRunner({
          command: powershellCommand,
          args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", invokerPath,
            "-PacketPath", packetPath, "-PolicyPath", policyPath, "-WorkspacePath", workspaceReal, "-RunId", runId,
            "-QuarantinePath", quarantinePath, "-StatePath", statePath],
          cwd: workspaceReal, timeoutMs: turnTimeoutMs, credentialAccess: false,
        })
      } catch (error) {
        // A transport rejection is still a turn that happened: record it before throwing.
        const failure = sanitizeAppServerText(String(error?.message ?? error)).slice(0, 256)
        fs.writeFileSync(stdoutPath, failure, { mode: 0o600 })
        session.turns.push({ turnId: runId, at: now().toISOString(), exitCode: null, packetSha256: sha256(packetBytes), stdoutSha256: sha256(failure), harvested: false, failure })
        writeSession(session)
        throw new AppServerTurnEndedError("interrupted")
      }
      const exitCode = result?.exitCode ?? result?.code ?? result?.status ?? 0
      const stdout = String(result?.stdout ?? ""); const stderr = String(result?.stderr ?? "")
      const combined = `${stdout}\n${stderr}`
      const persistedStdout = sanitizeAppServerText(combined)
      const kernelSession = stdout.match(KERNEL_SESSION_ID_PATTERN)?.[1] ?? null
      if (kernelSession) session.kernelSessionId = kernelSession
      const record = { turnId: runId, at: now().toISOString(), exitCode, packetSha256: sha256(packetBytes), stdoutSha256: sha256(persistedStdout), harvested: false, kernelSessionId: kernelSession, resumedKernelSessionId: kernelSessionId }
      fs.writeFileSync(stdoutPath, persistedStdout, { mode: 0o600 })
      const finish = (error) => { session.turns.push(record); writeSession(session); if (error) throw error }
      if (result?.timedOut === true || TIMEOUT_WALL.test(combined)) finish(new AppServerTimeoutError(turnTimeoutMs))
      if (EXECUTION_WALL.test(combined)) finish(new AppServerTurnEndedError("failed"))
      const token = combined.match(WALL_TOKEN)?.[0]
      if (token) finish(wall(token, "runTurn"))
      const completion = stdout.match(HERMES_FREE_AGENT_COMPLETE_PATTERN)
      if (exitCode !== 0 || !completion || completion[1] !== runId) finish(new AppServerTurnEndedError("interrupted"))
      const commonDirAfter = await gitCommonDir(workspaceReal, turnTimeoutMs)
      if (commonDirAfter === null || commonDirAfter !== commonDirBefore) finish(wall("RESIDENT_MODEL_LANE_WORKSPACE_TAMPERED", "runTurn"))
      const harvested = harvestTurnOutput(stdout)
      if (!harvested.ok) {
        const error = new AppServerTurnEndedError("failed"); error.detail = `RESIDENT_MODEL_TURN_OUTPUT_INVALID:${harvested.reason}`
        finish(error)
      }
      const structural = validateAgainstTurnSchema(JSON.parse(harvested.finalText), turn?.outputSchema ?? HERMES_TURN_OUTPUT_SCHEMA)
      if (!structural.ok) {
        const error = new AppServerTurnEndedError("failed"); error.detail = `RESIDENT_MODEL_TURN_OUTPUT_INVALID:${structural.reason}`
        finish(error)
      }
      record.harvested = true
      finish(null)
      return { threadId, turnId: runId, status: "completed", finalText: harvested.finalText }
    },
    close() { connected = false },
  }
  // Keep the surface exactly the five members the orchestrator uses.
  return Object.freeze(client)
}
