import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { AppServerWallError, AppServerTimeoutError, AppServerTurnEndedError } from "./app-server-client.mjs"
import { validateAgainstTurnSchema } from "./hermes-kernel-output.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "./prompt.mjs"

const quote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`
const uuid = (value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)

// SSH carries request bytes on stdin, never in a shell argument or a process listing.
export function residentSshTransport({ host, workerPath, request, timeoutMs = 45 * 60 * 1000 }) {
  if (typeof host !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(host)) throw new TypeError("host must be a safe SSH destination")
  if (typeof workerPath !== "string" || !workerPath.startsWith("/") || workerPath.includes("\0")) throw new TypeError("workerPath must be absolute")
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 24 * 60 * 60 * 1000) throw new TypeError("timeoutMs must be a bounded positive integer")
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
      host, `exec node ${quote(workerPath)}`], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = "", stderr = "", size = 0, failed = false
    const fail = (error) => { if (failed) return; failed = true; clearTimeout(timer); child.kill(); reject(error) }
    // The kernel owns cleanup at its policy deadline; allow transport time after its budget.
    const timer = setTimeout(() => fail(new AppServerTimeoutError(timeoutMs)), timeoutMs + 30_000)
    child.on("error", fail)
    child.stdin.on("error", fail)
    for (const [stream, append] of [[child.stdout, (s) => { stdout += s }], [child.stderr, (s) => { stderr += s }]]) {
      stream.setEncoding("utf8").on("data", (chunk) => {
        size += Buffer.byteLength(chunk)
        if (size > 12 * 1024 * 1024) fail(new Error("REMOTE_RESIDENT_RESPONSE_TOO_LARGE"))
        else append(chunk)
      })
    }
    child.on("close", (code) => {
      clearTimeout(timer)
      if (failed) return
      let response
      try { response = JSON.parse(stdout) } catch { reject(new Error(`REMOTE_RESIDENT_TRANSPORT_FAILED:${code}`)); return }
      if (response?.schemaVersion !== 1 || typeof response.ok !== "boolean" || (code !== 0 && response.ok)) {
        reject(new Error("REMOTE_RESIDENT_RESPONSE_INVALID")); return
      }
      resolve(response)
    })
    child.stdin.end(JSON.stringify(request))
  })
}

export function createRemoteResidentClient({ host, workerPath, config, workspacePath, timeoutMs, evidenceRoot, transport = residentSshTransport }) {
  let connected = false
  const call = async (method, params = {}) => {
    const response = await transport({ host, workerPath, timeoutMs: params.timeoutMs ?? timeoutMs,
      request: { schemaVersion: 1, config, method, params: { ...(timeoutMs === undefined ? {} : { timeoutMs }), ...params, workspacePath } } })
    if (response?.schemaVersion !== 1 || typeof response.ok !== "boolean") throw new Error("REMOTE_RESIDENT_RESPONSE_INVALID")
    if (!response.ok) {
      const error = response.error ?? {}
      if (error.name === "AppServerWallError") throw new AppServerWallError(error.code, error.method)
      if (error.name === "AppServerTimeoutError") throw new AppServerTimeoutError(error.timeoutMs)
      if (error.name === "AppServerTurnEndedError") throw new AppServerTurnEndedError(error.status ?? "failed", error.detail)
      throw new Error(error.message ?? "REMOTE_RESIDENT_FAILED")
    }
    return response.result
  }
  return Object.freeze({
    async connect() { await call("connect"); connected = true },
    async startThread() {
      if (!connected) throw new Error("REMOTE_RESIDENT_NOT_CONNECTED")
      const id = await call("startThread")
      if (!uuid(id)) throw new Error("REMOTE_RESIDENT_THREAD_INVALID")
      return id
    },
    async resumeThread(threadId) {
      if (!connected || !uuid(threadId)) throw new Error("REMOTE_RESIDENT_THREAD_INVALID")
      const id = await call("resumeThread", { threadId })
      if (id !== threadId) throw new Error("REMOTE_RESIDENT_THREAD_INVALID")
      return id
    },
    async runTurn(params) {
      if (!connected || !uuid(params?.threadId)) throw new Error("REMOTE_RESIDENT_THREAD_INVALID")
      const result = await call("runTurn", params)
      if (result?.threadId !== params.threadId || !uuid(result?.turnId) || result?.status !== "completed"
        || result?.evidence?.nodeId !== config.nodeId) throw new Error("REMOTE_RESIDENT_RESULT_INVALID")
      let output
      try { output = JSON.parse(result.finalText) } catch { throw new Error("REMOTE_RESIDENT_RESULT_INVALID") }
      if (!validateAgainstTurnSchema(output, HERMES_TURN_OUTPUT_SCHEMA).ok) throw new Error("REMOTE_RESIDENT_RESULT_INVALID")
      const files = result.evidence.files
      if (!files || Object.keys(files).sort().join(",") !== "packet.json,session.json,stdout.txt"
        || Object.values(files).some((value) => typeof value !== "string")
        || Buffer.byteLength(JSON.stringify(files)) > 8 * 1024 * 1024) throw new Error("REMOTE_RESIDENT_EVIDENCE_INVALID")
      let packet, session
      try { packet = JSON.parse(files["packet.json"]); session = JSON.parse(files["session.json"]) } catch { throw new Error("REMOTE_RESIDENT_EVIDENCE_INVALID") }
      const record = session.turns?.find((entry) => entry.turnId === result.turnId)
      const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
      if (packet.runId !== result.turnId || packet.model !== config.modelId || session.threadId !== result.threadId
        || session.workspacePath !== workspacePath || record?.harvested !== true
        || record.packetSha256 !== digest(files["packet.json"]) || record.stdoutSha256 !== digest(files["stdout.txt"])) {
        throw new Error("REMOTE_RESIDENT_EVIDENCE_INVALID")
      }
      const destination = path.resolve(evidenceRoot, config.nodeId, result.threadId, result.turnId)
      // Do not follow pre-existing links while writing returned evidence.
      const parsedRoot = path.parse(destination).root
      let cursor = parsedRoot
      for (const segment of destination.slice(parsedRoot.length).split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, segment)
        if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("REMOTE_RESIDENT_EVIDENCE_PATH_INVALID")
      }
      fs.mkdirSync(destination, { recursive: true })
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(destination, name), content, { flag: "wx", mode: 0o600 })
      return { threadId: result.threadId, turnId: result.turnId, status: result.status, finalText: result.finalText, evidencePath: destination }
    },
    close() { connected = false },
  })
}
