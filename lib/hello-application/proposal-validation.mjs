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

function directChild(runtimeRoot, workspacePath) {
  const worktrees = fs.realpathSync(path.resolve(runtimeRoot, "worktrees"))
  const workspace = path.resolve(workspacePath)
  if (path.dirname(workspace) !== worktrees || fs.realpathSync(workspace) !== workspace) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")
  for (const candidate of [worktrees, workspace]) {
    const stat = fs.lstatSync(candidate)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("HELLO_PROPOSAL_WORKTREE_INVALID")
  }
  for (const relativePath of VALIDATION_PATHS) {
    const stat = fs.lstatSync(path.join(workspace, ...relativePath.split("/")))
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("HELLO_PROPOSAL_WORKSPACE_FILE_INVALID")
  }
  return workspace
}

function defaultRunner(command, args, options = {}) {
  return new Promise((resolve) => execFile(command, args, { ...options, timeout: 60_000, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
    resolve({ code: error ? 1 : 0, timedOut: Boolean(error?.killed), stdout, stderr })
  }))
}

function policy(repositoryRoot) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ...POLICY_PATH), "utf8"))
    if (!value?.build?.image || !value?.build?.imageId || !value?.placement?.dockerConfig) throw new Error()
    return value
  } catch { throw new Error("HELLO_PROPOSAL_POLICY_INVALID") }
}

const tail = (value) => String(value ?? "").slice(-12_000)

export async function validateHelloApplicationInContainer({ repositoryRoot, runtimeRoot, workspacePath, commandRunner = defaultRunner }) {
  const workspace = directChild(runtimeRoot, workspacePath)
  const reviewed = policy(repositoryRoot)
  const env = { ...process.env, DOCKER_CONFIG: reviewed.placement.dockerConfig }
  const name = `williamos-hello-validator-${crypto.randomUUID()}`
  try {
    const image = await commandRunner("docker", ["image", "inspect", "--format", "{{.Id}}", reviewed.build.image], { env })
    if (image?.code !== 0 || image?.timedOut || String(image?.stdout).trim() !== reviewed.build.imageId) throw new Error("image")
    const result = await commandRunner("docker", [
      "run", "--rm", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true", "--cpus", "1", "--memory", "512m", "--pids-limit", "64",
      "--user", "10000:10000", "--mount", `type=bind,src=${workspace},dst=/workspace,readonly`,
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--workdir", "/workspace", "--entrypoint", "node",
      reviewed.build.imageId, "--test", "examples/hello-application/test/hello.test.mjs",
    ], { env })
    if (result?.code !== 0 || result?.timedOut) throw new Error("run")
    return { status: "passed", command: COMMAND, output: tail(`${result.stdout ?? ""}${result.stderr ?? ""}`).trim() }
  } catch { throw new Error("HELLO_PROPOSAL_VALIDATION_FAILED")
  } finally {
    try { await commandRunner("docker", ["rm", "-f", name], { env }) } catch { /* cleanup is best effort */ }
  }
}
