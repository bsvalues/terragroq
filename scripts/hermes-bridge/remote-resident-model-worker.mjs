import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { pathToFileURL } from "node:url"
import { createHermesKernelClient, kernelThreadsRoot, kernelQuarantinePath, HERMES_KERNEL_QUARANTINE_MARKER } from "./hermes-kernel-client.mjs"
import { createCommandRunner } from "./repository-lifecycle.mjs"

const MAX_BYTES = 8 * 1024 * 1024
const METHODS = new Set(["health", "connect", "startThread", "resumeThread", "runTurn"])
const uuid = (value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex")

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
    let ready = false, accepted = null, gpu = null
    // A worker is only "ready" as a resident inference node when the lane is actually qualified:
    // no model tools, single concurrency, and no cloud fallback. This mirrors the executionMode /
    // agentToolsEnabled predicates so health can never report ready on an unqualified lane.
    const laneQualified = config.invokerKind === "python" && Array.isArray(policy.execution?.allowedToolsets)
      && policy.execution.allowedToolsets.length === 0 && policy.execution.maximumConcurrency === 1
      && policy.model?.cloudFallbackAllowed === false
    if (config.invokerKind === "python" && policy.daedalusInvoker) {
      try {
        accepted = JSON.parse(fs.readFileSync(path.join(path.dirname(kernelQuarantinePath(config.runtimeRoot)), "daedalus-last-accepted.json"), "utf8"))
        const probe = await commandRunner({ command: "nvidia-smi", args: ["--query-gpu=uuid,name,memory.total", "--format=csv,noheader,nounits"], timeoutMs: 10000 })
        const line = String(probe.stdout ?? "").split("\n").find((line) => line.startsWith(policy.daedalusInvoker.expectedGpuUuid + ","))
        if ((probe.exitCode ?? probe.code ?? probe.status) === 0 && probe.timedOut !== true && line) {
          const [uuid, name, memory] = line.split(",").map((word) => word.trim())
          if (name && Number.isFinite(Number(memory)) && Number(memory) > 0) gpu = { uuid, name, vramBytes: Number(memory) * 1048576 }
        }
        const age = Date.now() - Date.parse(accepted.observedAt)
        ready = laneQualified && !quarantined && accepted.kernelTurnAccepted === true && age >= 0 && age < 86400000 && gpu !== null
          && accepted.nodeId === config.nodeId && accepted.modelId === config.modelId
          && accepted.gpuUuid === gpu?.uuid && accepted.gpuUuid === policy.daedalusInvoker.expectedGpuUuid
          && accepted.policySha256 === digest(fs.readFileSync(config.policyPath))
          && accepted.workerSha256 === digest(fs.readFileSync(policy.daedalusInvoker.workerPath))
          && accepted.invokerSha256 === digest(fs.readFileSync(config.invokerPath))
          && Object.keys(policy.daedalusInvoker.modelFiles).every((name) => fs.existsSync(path.join(policy.daedalusInvoker.modelPath, name)))
      } catch { ready = false }
    }
    return { nodeId: config.nodeId, observedAt: new Date().toISOString(), transport: "ssh", reachable: true,
      executionMode: config.invokerKind === "python" && Array.isArray(policy.execution?.allowedToolsets) && policy.execution.allowedToolsets.length === 0 && policy.execution.maximumConcurrency === 1 && policy.model?.cloudFallbackAllowed === false ? "read-only-inference" : "unqualified",
      agentToolsEnabled: !Array.isArray(policy.execution?.allowedToolsets) || policy.execution.allowedToolsets.length !== 0,
      policyWorkOrderId: policy.workOrderId,
      invokerPresent: fs.existsSync(config.invokerPath), quarantined,
      models: [{ id: policy.model.id, revision: policy.daedalusInvoker?.modelRevision, policyStatus: policy.promotion?.status ?? "UNKNOWN", runtimeState: ready ? "healthy" : "UNKNOWN" }],
      gpu, lastAcceptedRunId: accepted?.runId ?? null, ready, readinessReason: ready ? "Pinned on-demand inference worker verified; current GPU and artifacts present, accepted turn within 24 hours. Full model hashes rechecked at each dispatch." : "No current accepted execution evidence, or runtime/identity checks failed." }
  }
  const client = clientFactory({ workspacePath: params.workspacePath, runtimeRoot: config.runtimeRoot,
    policyPath: config.policyPath, invokerPath: config.invokerPath, invokerKind: config.invokerKind ?? "powershell", pythonCommand: config.pythonCommand,
    commandRunner, timeoutMs: params.timeoutMs })
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
    for (const file of ["packet.json", "stdout.txt", ...(config.invokerKind === "python" ? ["inference-request.json", "inference-result.json", "inference-stderr.txt"] : [])]) {
      const source = path.join(turnRoot, file)
      if (fs.statSync(source).size > MAX_BYTES) throw new Error("REMOTE_RESIDENT_EVIDENCE_TOO_LARGE")
      files[file] = fs.readFileSync(source, "utf8")
    }
    if (Buffer.byteLength(JSON.stringify(files)) > MAX_BYTES) throw new Error("REMOTE_RESIDENT_EVIDENCE_TOO_LARGE")
    if (config.invokerKind === "python") {
      const root = path.dirname(kernelQuarantinePath(config.runtimeRoot))
      const inference = JSON.parse(fs.readFileSync(path.join(root, "daedalus-last-inference-success.json"), "utf8"))
      if (inference.runId !== result.turnId || inference.resultSha256 !== digest(files["inference-result.json"])) throw new Error("REMOTE_RESIDENT_EVIDENCE_MISMATCH")
      const accepted = { ...inference, kernelTurnAccepted: true, threadId: result.threadId, invokerSha256: digest(fs.readFileSync(config.invokerPath)) }
      fs.writeFileSync(path.join(root, "daedalus-last-accepted.json"), JSON.stringify(accepted), { mode: 0o600 })
    }
    return { ...result, evidence: { nodeId: config.nodeId, files, sha256: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)])) } }
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
