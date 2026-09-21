import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const COMMAND = "node --test test/application.test.mjs"
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/
const MAX_FILE_BYTES = 262_144
const MAX_TOTAL_BYTES = 1024 * 1024

const samePath = (left, right) => process.platform === "win32"
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
  : path.resolve(left) === path.resolve(right)

function safeDockerEnvironment(source, dockerConfig) {
  const environment = {
    DOCKER_CONFIG: dockerConfig,
    PATH: "C:\\Program Files\\Docker\\Docker\\resources\\bin;C:\\Windows\\System32;C:\\Windows",
  }
  for (const key of ["SystemRoot", "SystemDrive", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramW6432"]) {
    const entry = Object.entries(source).find(([candidate]) => candidate.toUpperCase() === key.toUpperCase())
    if (entry?.[1] !== undefined && !/[\0\r\n]/.test(entry[1])) environment[key] = entry[1]
  }
  return environment
}

function defaultRunner(command, args, options = {}) {
  return new Promise((resolve) => execFile(command, args, { ...options, shell: false, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
    resolve({ code: error ? 1 : 0, timedOut: Boolean(error?.killed), stdout, stderr })
  }))
}

function validationPaths(application) {
  const manifest = application?.manifest
  if (!manifest || manifest.adapter !== "static-web-v1" || manifest.source?.test !== "test/application.test.mjs"
    || !Array.isArray(manifest.ai?.writablePaths) || manifest.ai.writablePaths.length !== 3) {
    throw new Error("APPLICATION_PROPOSAL_MANIFEST_INVALID")
  }
  const paths = [...manifest.ai.writablePaths, manifest.source.test]
  if (new Set(paths).size !== 4 || paths.some((item) => typeof item !== "string" || path.isAbsolute(item)
    || item.includes("\\") || item.startsWith(".williamos/") || item.startsWith(".git/")
    || item.split("/").some((part) => part === "." || part === ".."))) {
    throw new Error("APPLICATION_PROPOSAL_MANIFEST_INVALID")
  }
  return paths
}

export function assertApplicationProposalWorkspace(runtimeRoot, workspacePath, application) {
  const worktrees = path.resolve(runtimeRoot, "worktrees")
  const workspace = path.resolve(workspacePath)
  if (!samePath(path.dirname(workspace), worktrees)) throw new Error("APPLICATION_PROPOSAL_WORKTREE_INVALID")
  for (const target of [worktrees, workspace]) {
    const stat = fs.lstatSync(target)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(fs.realpathSync(target), target)) {
      throw new Error("APPLICATION_PROPOSAL_WORKTREE_INVALID")
    }
  }
  for (const relative of validationPaths(application)) {
    let cursor = workspace
    for (const [index, segment] of relative.split("/").entries()) {
      cursor = path.join(cursor, segment)
      const stat = fs.lstatSync(cursor)
      if (stat.isSymbolicLink() || !samePath(fs.realpathSync(cursor), cursor)
        || (index === relative.split("/").length - 1 ? !stat.isFile() : !stat.isDirectory())) {
        throw new Error("APPLICATION_PROPOSAL_WORKSPACE_FILE_INVALID")
      }
    }
  }
  return workspace
}

function snapshot(runtimeRoot, workspacePath, application) {
  const root = assertApplicationProposalWorkspace(runtimeRoot, workspacePath, application)
  let total = 0
  return new Map(validationPaths(application).map((relative) => {
    const target = path.join(root, ...relative.split("/"))
    const stat = fs.lstatSync(target, { bigint: true })
    const size = Number(stat.size)
    total += size
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES || stat.nlink !== 1n) {
      throw new Error("APPLICATION_PROPOSAL_SOURCE_SIZE_REFUSED")
    }
    const bytes = fs.readFileSync(target)
    const after = fs.lstatSync(target, { bigint: true })
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs) {
      throw new Error("APPLICATION_PROPOSAL_WORKSPACE_FILE_INVALID")
    }
    return [relative, {
      identity: `${stat.dev}:${stat.ino}`,
      mode: Number(stat.mode & 0o777n),
      size,
      digest: crypto.createHash("sha256").update(bytes).digest("hex"),
    }]
  }))
}

const equalSnapshots = (left, right) => left.size === right.size && [...left].every(([key, value]) => {
  const other = right.get(key)
  return other && Object.keys(value).every((name) => value[name] === other[name])
})

function defaultPolicy(assetRoot = process.env.WILLIAMOS_APPLICATION_ASSET_ROOT ?? process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(assetRoot, "config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json"), "utf8"))
    return { image: value.build?.image, imageId: value.build?.imageId, dockerConfig: value.placement?.dockerConfig }
  } catch { throw new Error("APPLICATION_PROPOSAL_POLICY_INVALID") }
}

const tail = (value) => String(value ?? "").slice(-12_000)

export async function validateApplicationProposalInContainer({
  application,
  runtimeRoot,
  workspacePath,
  validatorPolicy = defaultPolicy(),
  commandRunner = defaultRunner,
  processEnvironment = process.env,
}) {
  if (!validatorPolicy || typeof validatorPolicy.image !== "string" || !IMAGE_ID.test(validatorPolicy.imageId)
    || typeof validatorPolicy.dockerConfig !== "string" || !validatorPolicy.dockerConfig.trim()) {
    throw new Error("APPLICATION_PROPOSAL_POLICY_INVALID")
  }
  const workspace = assertApplicationProposalWorkspace(runtimeRoot, workspacePath, application)
  const before = snapshot(runtimeRoot, workspace, application)
  const environment = safeDockerEnvironment(processEnvironment, validatorPolicy.dockerConfig)
  const name = `williamos-application-validator-${crypto.randomUUID()}`
  const bounded = { env: environment, timeout: 60_000, maxBuffer: 2_000_000 }
  let validation
  let failure = null
  try {
    const image = await commandRunner("docker", ["image", "inspect", "--format", "{{.Id}}", validatorPolicy.image], bounded)
    if (image?.code !== 0 || image?.timedOut || String(image?.stdout).trim() !== validatorPolicy.imageId) {
      throw new Error("APPLICATION_PROPOSAL_VALIDATION_FAILED")
    }
    if (!equalSnapshots(before, snapshot(runtimeRoot, workspace, application))) {
      throw new Error("APPLICATION_PROPOSAL_VALIDATION_HASH_MISMATCH")
    }
    const result = await commandRunner("docker", [
      "run", "--rm", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true", "--cpus", "1", "--memory", "512m", "--memory-swap", "512m",
      "--pids-limit", "64", "--user", "10000:10000", "--mount", `type=bind,src=${workspace},dst=/workspace,readonly`,
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--workdir", "/workspace", "--entrypoint", "node",
      validatorPolicy.imageId, "--test", "test/application.test.mjs",
    ], bounded)
    if (result?.code !== 0 || result?.timedOut) throw new Error("APPLICATION_PROPOSAL_VALIDATION_FAILED")
    if (!equalSnapshots(before, snapshot(runtimeRoot, workspace, application))) {
      throw new Error("APPLICATION_PROPOSAL_VALIDATION_HASH_MISMATCH")
    }
    validation = { status: "passed", command: COMMAND, output: tail(`${result.stdout ?? ""}${result.stderr ?? ""}`).trim() }
  } catch (error) { failure = error
  } finally {
    try {
      const cleanup = await commandRunner("docker", ["rm", "-f", name], { env: environment, timeout: 10_000, maxBuffer: 64_000 })
      const absent = cleanup?.code === 1 && String(cleanup.stderr ?? "").trim() === `Error response from daemon: No such container: ${name}`
      if (cleanup?.timedOut || (cleanup?.code !== 0 && !absent)) failure ??= new Error("APPLICATION_PROPOSAL_VALIDATION_FAILED")
    } catch { failure ??= new Error("APPLICATION_PROPOSAL_VALIDATION_FAILED") }
  }
  if (failure) throw failure
  if (!validation) throw new Error("APPLICATION_PROPOSAL_VALIDATION_FAILED")
  return validation
}
