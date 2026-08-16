import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { AppServerTimeoutError, AppServerTurnEndedError, AppServerWallError, sanitizeAppServerText } from "./app-server-client.mjs"
import { harvestTurnOutput, HERMES_FREE_AGENT_COMPLETE_PATTERN } from "./hermes-kernel-output.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "./prompt.mjs"

export const HERMES_KERNEL_POLICY_RELATIVE = "config/execution-fabric/hermes-free-dev-agent-v2.policy.json"
export const HERMES_KERNEL_INVOKER_RELATIVE = "scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1"
export const HERMES_KERNEL_QUARANTINE_MARKER = "HERMES_FREE_AGENT_QUARANTINED"
const SESSION_SCHEMA_VERSION = 1

export function kernelThreadsRoot(runtimeRoot) {
  return path.join(path.resolve(runtimeRoot), "hermes-kernel", "threads")
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

export function buildKernelPacket({ policy, prompt, workspacePath, runId }) {
  return {
    schemaVersion: 2,
    workOrderId: policy.workOrderId,
    model: policy.model.id,
    prompt: `${prompt}\n\n${buildKernelPromptEpilogue()}`,
    maximumTurns: policy.execution.maximumTurns,
    toolsets: [...policy.execution.allowedToolsets],
    workspaceMode: "OWNED_WORKTREE",
    workspacePath,
    runId,
  }
}

const WALL_TOKEN = /HERMES_FREE_AGENT_[A-Z_]+_WALL/
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
  let connected = false

  const readPolicy = () => {
    let policy
    try { policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) } catch { throw wall("RESIDENT_MODEL_LANE_POLICY_UNREADABLE", "connect") }
    if (!["PILOT_AUTHORIZED", "PROMOTED"].includes(policy?.promotion?.status)) throw wall("RESIDENT_MODEL_LANE_NOT_AUTHORIZED", "connect")
    if (policy?.placement?.workspaceMode !== "OWNED_WORKTREE") throw wall("RESIDENT_MODEL_LANE_WORKSPACE_MODE", "connect")
    return policy
  }
  const assertUnquarantined = () => {
    if (fs.existsSync(path.join(path.dirname(policyPath), HERMES_KERNEL_QUARANTINE_MARKER))) throw wall("RESIDENT_MODEL_LANE_QUARANTINED", "connect")
  }
  const assertOwnedWorkspace = () => {
    let real
    try { real = realNoSymlink(workspacePath) } catch (error) { if (error instanceof AppServerWallError) throw error; throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect") }
    let worktreesReal
    try { worktreesReal = fs.realpathSync(worktreesRoot) } catch { throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect") }
    if (!isInside(real, worktreesReal) || !fs.statSync(real).isDirectory()) throw wall("RESIDENT_MODEL_LANE_WORKSPACE", "connect")
    return real
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
      readPolicy(); assertUnquarantined(); assertOwnedWorkspace()
      connected = true
    },
    async startThread() {
      const threadId = randomUUID()
      writeSession({ schemaVersion: SESSION_SCHEMA_VERSION, threadId, workspacePath, createdAt: now().toISOString(), turns: [] })
      return threadId
    },
    async resumeThread(threadId) {
      const session = readSession(threadId)
      if (path.resolve(session.workspacePath) !== path.resolve(workspacePath)) throw wall("RESIDENT_MODEL_THREAD_WORKSPACE_MISMATCH", "resumeThread")
      if (readPolicy()?.execution?.sessionResumeProven !== true) throw wall("RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE", "resumeThread")
      return threadId
    },
    async runTurn({ threadId, prompt, timeoutMs: turnTimeoutMs = timeoutMs } = {}) {
      if (!connected) throw wall("RESIDENT_MODEL_LANE_NOT_CONNECTED", "runTurn")
      const session = readSession(threadId)
      const policy = readPolicy(); assertUnquarantined(); const workspaceReal = assertOwnedWorkspace()
      const text = requiredString(prompt, "prompt")
      const runId = randomUUID()
      const packet = buildKernelPacket({ policy, prompt: text, workspacePath: workspaceReal, runId })
      if (packet.prompt.length > (policy.execution?.promptMaxChars ?? 16000)) throw wall("RESIDENT_MODEL_PROMPT_TOO_LONG", "runTurn")
      const turnIndex = session.turns.length + 1
      const turnDir = path.join(threadsRoot, threadId, "turns", String(turnIndex))
      fs.mkdirSync(turnDir, { recursive: true })
      const packetPath = path.join(turnDir, "packet.json")
      const packetBytes = `${JSON.stringify(packet, null, 2)}\n`
      fs.writeFileSync(packetPath, packetBytes, { mode: 0o600 })
      const result = await commandRunner({
        command: powershellCommand,
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", invokerPath,
          "-PacketPath", packetPath, "-PolicyPath", policyPath, "-WorkspacePath", workspaceReal, "-RunId", runId],
        cwd: workspaceReal, timeoutMs: turnTimeoutMs, credentialAccess: false,
      })
      const exitCode = result?.exitCode ?? result?.code ?? result?.status ?? 0
      const stdout = String(result?.stdout ?? ""); const stderr = String(result?.stderr ?? "")
      const combined = `${stdout}\n${stderr}`
      const record = { turnId: runId, at: now().toISOString(), exitCode, packetSha256: sha256(packetBytes), stdoutSha256: sha256(stdout), harvested: false }
      fs.writeFileSync(path.join(turnDir, "stdout.txt"), sanitizeAppServerText(combined))
      const finish = (error) => { session.turns.push(record); writeSession(session); if (error) throw error }
      if (result?.timedOut === true || /HERMES_FREE_AGENT_TIMEOUT_WALL/.test(combined)) finish(new AppServerTimeoutError(turnTimeoutMs))
      if (/HERMES_FREE_AGENT_EXECUTION_WALL/.test(combined)) finish(new AppServerTurnEndedError("failed"))
      const token = combined.match(WALL_TOKEN)?.[0]
      if (token) finish(wall(token, "runTurn"))
      if (exitCode !== 0 || !HERMES_FREE_AGENT_COMPLETE_PATTERN.test(stdout)) finish(new AppServerTurnEndedError("interrupted"))
      const harvested = harvestTurnOutput(stdout)
      if (!harvested.ok) {
        const error = new AppServerTurnEndedError("failed"); error.detail = `RESIDENT_MODEL_TURN_OUTPUT_INVALID:${harvested.reason}`
        finish(error)
      }
      record.harvested = true
      finish(null)
      return { threadId, turnId: runId, status: "completed", finalText: harvested.finalText }
    },
    close() {},
  }
  // Keep the surface exactly the five members the orchestrator uses.
  return Object.freeze(client)
}
