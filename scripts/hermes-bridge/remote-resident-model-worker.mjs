import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createHermesKernelClient, kernelThreadsRoot, kernelQuarantinePath, HERMES_KERNEL_QUARANTINE_MARKER } from "./hermes-kernel-client.mjs"
import { createCommandRunner } from "./repository-lifecycle.mjs"

const MAX_BYTES = 8 * 1024 * 1024
const METHODS = new Set(["health", "connect", "startThread", "resumeThread", "runTurn"])
const uuid = (value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)

export async function handleResidentRequest(request, { clientFactory = createHermesKernelClient, commandRunner = createCommandRunner() } = {}) {
  // This is an SSH account tool for the trusted controller, not a network-facing
  // agent API. The account can already execute commands; requests do not mint authority.
  if (request?.schemaVersion !== 1 || !METHODS.has(request.method)) throw new Error("REMOTE_RESIDENT_REQUEST_INVALID")
  const { config, method, params = {} } = request
  for (const key of ["runtimeRoot", "repositoryRoot", "policyPath", "invokerPath"]) {
    if (typeof config?.[key] !== "string" || !path.isAbsolute(config[key]) || config[key].includes("\0")) throw new Error(`REMOTE_RESIDENT_CONFIG_INVALID:${key}`)
  }
  if (!/^[a-z][a-z0-9-]*$/.test(config.nodeId ?? "")) throw new Error("REMOTE_RESIDENT_NODE_INVALID")
  const policy = JSON.parse(fs.readFileSync(config.policyPath, "utf8"))
  // A HERMES policy must never silently authorize a different machine/model.
  if (policy?.placement?.executionNode !== config.nodeId || policy?.model?.id !== config.modelId) throw new Error("REMOTE_RESIDENT_PLACEMENT_MISMATCH")
  if (method === "health") {
    const quarantined = [kernelQuarantinePath(config.runtimeRoot), path.join(path.dirname(config.policyPath), HERMES_KERNEL_QUARANTINE_MARKER)].some((file) => fs.existsSync(file))
    return { nodeId: config.nodeId, observedAt: new Date().toISOString(), transport: "ssh", reachable: true,
      invokerPresent: fs.existsSync(config.invokerPath), quarantined,
      models: [{ id: policy.model.id, policyStatus: policy.promotion?.status ?? "UNKNOWN", runtimeState: "UNKNOWN" }],
      ready: false, readinessReason: "Health reports installation only; a successful bounded kernel turn is required to prove execution." }
  }
  const client = clientFactory({ workspacePath: params.workspacePath, runtimeRoot: config.runtimeRoot,
    policyPath: config.policyPath, invokerPath: config.invokerPath, commandRunner, timeoutMs: params.timeoutMs })
  try {
    await client.connect()
    if (method === "connect") return { connected: true }
    if (method === "startThread") return await client.startThread()
    if (method === "resumeThread") return await client.resumeThread(params.threadId)
    const result = await client.runTurn(params)
    if (!uuid(result.threadId) || !uuid(result.turnId)) throw new Error("REMOTE_RESIDENT_RESULT_INVALID")
    const threadRoot = path.join(kernelThreadsRoot(config.runtimeRoot), result.threadId)
    const sessionBytes = fs.readFileSync(path.join(threadRoot, "session.json"), "utf8")
    const session = JSON.parse(sessionBytes)
    const turnIndex = session.turns.findIndex((entry) => entry.turnId === result.turnId)
    if (turnIndex < 0) throw new Error("REMOTE_RESIDENT_EVIDENCE_MISSING")
    const turnRoot = path.join(threadRoot, "turns", String(turnIndex + 1))
    const files = { "session.json": sessionBytes }
    for (const file of ["packet.json", "stdout.txt"]) {
      const source = path.join(turnRoot, file)
      if (fs.statSync(source).size > MAX_BYTES) throw new Error("REMOTE_RESIDENT_EVIDENCE_TOO_LARGE")
      files[file] = fs.readFileSync(source, "utf8")
    }
    if (Buffer.byteLength(JSON.stringify(files)) > MAX_BYTES) throw new Error("REMOTE_RESIDENT_EVIDENCE_TOO_LARGE")
    return { ...result, evidence: { nodeId: config.nodeId, files } }
  } finally { client.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const chunks = []
    let size = 0
    for await (const chunk of process.stdin) {
      size += chunk.length
      if (size > 1024 * 1024) throw new Error("REMOTE_RESIDENT_REQUEST_TOO_LARGE")
      chunks.push(chunk)
    }
    const result = await handleResidentRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, result }))
  } catch (error) {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error: { name: error.name, message: error.message, code: error.code, method: error.method, status: error.status, timeoutMs: error.timeoutMs, detail: error.detail } }))
    process.exitCode = 1
  }
}
