import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const POLICY_PATH = ["config", "execution-fabric", "hermes-free-dev-agent-v2.policy.json"]
const VALIDATION_PATHS = [
  "examples/hello-application/src/app.js",
  "examples/hello-application/src/index.html",
  "examples/hello-application/src/styles.css",
  "examples/hello-application/package.json",
  "examples/hello-application/server.mjs",
  "examples/hello-application/test/hello.test.mjs",
]
const COMMAND = "node --test examples/hello-application/test/hello.test.mjs"

export function assertHelloValidationWorkspace(runtimeRoot, workspacePath) {
  const worktrees = path.resolve(runtimeRoot, "worktrees")
  const workspace = path.resolve(workspacePath)
  if (path.dirname(workspace) !== worktrees) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")
  // Check lexical ancestors before realpath: resolving first would hide a junction.
  const root = path.parse(workspace).root
  let cursor = root
  for (const segment of workspace.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    const stat = fs.lstatSync(cursor)
    if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(cursor) !== cursor) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")
  }
  if (path.dirname(fs.realpathSync(workspace)) !== fs.realpathSync(worktrees)) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")
  const pending = [workspace]
  while (pending.length) {
    const directory = pending.pop()
    for (const name of fs.readdirSync(directory)) {
      const target = path.join(directory, name)
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || fs.realpathSync(target) !== target) throw new Error("HELLO_PROPOSAL_WORKSPACE_FILE_INVALID")
      if (stat.isDirectory()) pending.push(target)
    }
  }
  for (const relativePath of VALIDATION_PATHS) {
    const stat = fs.lstatSync(path.join(workspace, ...relativePath.split("/")))
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("HELLO_PROPOSAL_WORKSPACE_FILE_INVALID")
  }
  return workspace
}

function defaultRunner(command, args, options = {}) {
  return new Promise((resolve) => execFile(command, args, { ...options, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
    resolve({ code: error ? 1 : 0, timedOut: Boolean(error?.killed), stdout, stderr })
  }))
}

function policy(repositoryRoot) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ...POLICY_PATH), "utf8"))
    if (typeof value?.build?.image !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value?.build?.imageId)
      || typeof value?.placement?.dockerConfig !== "string" || !value.placement.dockerConfig.trim()) throw new Error()
    return value
  } catch { throw new Error("HELLO_PROPOSAL_POLICY_INVALID") }
}

const tail = (value) => String(value ?? "").slice(-12_000)

/** @param {{ repositoryRoot: string, runtimeRoot: string, workspacePath: string, commandRunner?: (command: string, args: string[], options: { env: NodeJS.ProcessEnv, timeout: number, maxBuffer: number }) => Promise<any> }} options */
export async function validateHelloApplicationInContainer({ repositoryRoot, runtimeRoot, workspacePath, commandRunner = defaultRunner }) {
  const workspace = assertHelloValidationWorkspace(runtimeRoot, workspacePath)
  const identity = (target) => { const stat = fs.lstatSync(target); return `${stat.dev}:${stat.ino}` }
  const originalParent = identity(path.dirname(workspace))
  const originalWorkspace = identity(workspace)
  const reviewed = policy(repositoryRoot)
  const env = { ...process.env, DOCKER_CONFIG: reviewed.placement.dockerConfig }
  const name = `williamos-hello-validator-${crypto.randomUUID()}`
  const bounded = { env, timeout: 60_000, maxBuffer: 2_000_000 }
  let validation
  let failed = false
  try {
    const image = await commandRunner("docker", ["image", "inspect", "--format", "{{.Id}}", reviewed.build.image], bounded)
    if (image?.code !== 0 || image?.timedOut || String(image?.stdout).trim() !== reviewed.build.imageId) throw new Error("image")
    assertHelloValidationWorkspace(runtimeRoot, workspacePath)
    if (identity(path.dirname(workspace)) !== originalParent || identity(workspace) !== originalWorkspace) throw new Error("workspace replaced")
    const result = await commandRunner("docker", [
      "run", "--rm", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true", "--cpus", "1", "--memory", "512m", "--pids-limit", "64",
      "--user", "10000:10000", "--mount", `type=bind,src=${workspace},dst=/workspace,readonly`,
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--workdir", "/workspace", "--entrypoint", "node",
      reviewed.build.imageId, "--test", "examples/hello-application/test/hello.test.mjs",
    ], bounded)
    if (result?.code !== 0 || result?.timedOut) throw new Error("run")
    validation = { status: "passed", command: COMMAND, output: tail(`${result.stdout ?? ""}${result.stderr ?? ""}`).trim() }
  } catch { failed = true
  } finally {
    try {
      const cleanup = await commandRunner("docker", ["rm", "-f", name], { env, timeout: 10_000, maxBuffer: 64_000 })
      // --rm may already have removed it; only the exact missing-container response is benign.
      const absent = cleanup?.code === 1 && String(cleanup.stderr ?? "").trim() === `Error response from daemon: No such container: ${name}`
      if (cleanup?.timedOut || (cleanup?.code !== 0 && !absent)) failed = true
    } catch { failed = true }
  }
  if (failed || !validation) throw new Error("HELLO_PROPOSAL_VALIDATION_FAILED")
  return validation
}
