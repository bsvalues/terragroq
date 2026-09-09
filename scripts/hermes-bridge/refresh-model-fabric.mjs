import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { selectExecutionBackend } from "./execution-backend.mjs"
import { createCommandRunner } from "./repository-lifecycle.mjs"
import { evaluatePlacement } from "../execution-fabric/recommend-placement.mjs"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const fail = (reason) => { throw new Error(`MODEL_FABRIC_REFRESH_${reason}`) }
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"))

function safePath(target) {
  const full = path.resolve(target), root = path.parse(full).root
  let cursor = root
  for (const part of full.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part)
    if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) fail("PATH_INVALID")
  }
}

export async function refreshModelFabric(config, {
  backendFactory = selectExecutionBackend, commandRunner = createCommandRunner(), repositoryRoot = sourceRoot, now = () => new Date(),
} = {}) {
  if (config?.WILLIAMOS_EXECUTOR !== "remote-resident-model" || !path.isAbsolute(config.WILLIAMOS_MODEL_EVIDENCE_ROOT ?? "")) fail("CONFIG_INVALID")
  const backend = backendFactory(config)
  const seed = read(path.join(repositoryRoot, "config/execution-fabric/registry.seed.json"))
  const expected = seed.nodes.find((node) => node.id === backend.nodeId)
  if (backend.nodeId !== "daedalus" || !/^[a-f0-9]{64}$/.test(expected?.identity?.machine_id_sha256 ?? "")) fail("IDENTITY_PIN_REQUIRED")
  const directory = path.join(config.WILLIAMOS_MODEL_EVIDENCE_ROOT, "placement")
  safePath(directory); fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lockPath = path.join(directory, ".refresh.lock")
  try { fs.writeFileSync(lockPath, "refresh", { flag: "wx", mode: 0o600 }) } catch (error) {
    if (error.code === "EEXIST") fail("IN_PROGRESS")
    throw error
  }
  try {
    const health = await backend.health()
    const response = await backend.runCommand({ workspacePath: backend.repositoryRoot, command: "bash",
      args: [path.posix.join(backend.repositoryRoot, "scripts/execution-fabric/probe-linux.sh"), backend.nodeId], timeoutMs: 180000 })
    if (response.exitCode !== 0 || Buffer.byteLength(response.stdout ?? "") > 4 * 1024 * 1024) fail("PROBE_FAILED")
    const probe = JSON.parse(response.stdout)
    if (probe.schema_version !== "0.1-node-probe" || probe.node?.id !== backend.nodeId || health.nodeId !== backend.nodeId
      || probe.node?.identity?.machine_id_sha256 !== expected.identity.machine_id_sha256
      || probe.node.identity.source !== expected.identity.source) fail("IDENTITY_MISMATCH")
    const evaluatedAt = now()
    for (const timestamp of [health.observedAt, probe.evidence?.observed_at, probe.node.observed_at]) {
      const age = evaluatedAt.getTime() - Date.parse(timestamp)
      if (!Number.isFinite(age) || age < 0 || age >= 300000) fail("OBSERVATION_STALE")
    }
    if (!Array.isArray(probe.node.runtimes) || !Array.isArray(probe.node.gpus)) fail("PROBE_INVALID")
    const sameGpu = health.gpu && probe.node.gpus.some((gpu) => gpu.uuid === health.gpu.uuid && gpu.vram_bytes === health.gpu.vramBytes && gpu.model === health.gpu.name)
    const ready = health.ready === true && health.reachable === true && health.quarantined === false && health.invokerPresent === true
      && health.executionMode === "read-only-inference" && health.agentToolsEnabled === false && sameGpu
      && health.models?.some((model) => model.id === backend.modelId && model.runtimeState === "healthy")
    const healthBytes = JSON.stringify(health)
    probe.node.runtimes = probe.node.runtimes.filter((runtime) => runtime.kind !== "remote-resident-model")
    probe.node.runtimes.push({ id: "daedalus-resident-model", kind: "remote-resident-model", state: ready ? "healthy" : "unavailable",
      details: { models: ready ? [backend.modelId] : [], exposure: "ssh-only", authentication: "pinned-ssh-host-key",
        observation: `health.json#sha256=${sha(healthBytes)}` } })
    const snapshotPath = path.join(directory, "snapshot.json"), healthPath = path.join(directory, "health.json"), probePath = path.join(directory, "daedalus.json")
    const write = (file, bytes) => {
      safePath(file)
      const temporary = `${file}.${crypto.randomUUID()}.tmp`
      fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, file)
    }
    write(healthPath, healthBytes); write(probePath, JSON.stringify(probe))
    safePath(snapshotPath)
    const assembled = await commandRunner({ command: process.execPath, args: [path.join(repositoryRoot, "scripts/execution-fabric/assemble-registry.mjs"),
      "--evidence-dir", directory, "--out", snapshotPath], cwd: repositoryRoot, timeoutMs: 60000, credentialAccess: false })
    if ((assembled.exitCode ?? assembled.code ?? assembled.status) !== 0) fail("ASSEMBLY_FAILED")
    const snapshotBytes = fs.readFileSync(snapshotPath)
    const schema = read(path.join(repositoryRoot, "config/execution-fabric/registry.schema.json"))
    const catalog = read(path.join(repositoryRoot, "config/execution-fabric/placement-workloads.json"))
    const workload = catalog.workloads.find((entry) => entry.id === "qwen3-8b-resident-inference")
    const recommendation = evaluatePlacement(JSON.parse(snapshotBytes), workload, { evaluatedAt: now().toISOString(), schema })
    if (recommendation.status === "INPUT_REJECTED") fail("PLACEMENT_INVALID")
    recommendation.snapshot = { path: snapshotPath, sha256: sha(snapshotBytes) }
    const recommendationPath = path.join(directory, "recommendation.json")
    write(recommendationPath, JSON.stringify(recommendation))
    return { schemaVersion: 1, status: recommendation.status, nodeId: backend.nodeId, recommendation, recommendationPath,
      healthPath, probePath, snapshotPath, autonomousDispatch: false }
  } finally { fs.unlinkSync(lockPath) }
}
