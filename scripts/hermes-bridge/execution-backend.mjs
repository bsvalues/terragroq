import fs from "node:fs"
import path from "node:path"

import { CodexAppServerClient } from "./app-server-client.mjs"
import { createCommandRunner } from "./repository-lifecycle.mjs"

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

function commandResult(value) {
  return {
    exitCode: value?.exitCode ?? value?.code ?? value?.status ?? 0,
    stdout: String(value?.stdout ?? ""),
    stderr: String(value?.stderr ?? ""),
    ...(value?.timedOut === true ? { timedOut: true } : {}),
  }
}

function workspaceLeaf(branch) {
  const leaf = requiredString(branch, "branch").replace(/^codex\//, "").replace(/[^A-Za-z0-9._-]/g, "-")
  if (!leaf || leaf === "." || leaf === "..") throw new TypeError("branch does not identify a safe workspace")
  return leaf
}

function hasExactWorktree(output, workspacePath, branch) {
  return String(output).split(/\r?\n\r?\n/).some((block) => {
    const lines = block.split(/\r?\n/)
    return lines.includes(`worktree ${workspacePath}`) && lines.includes(`branch refs/heads/${branch}`)
  })
}

function hasWorktreeConflict(output, workspacePath, branch) {
  return String(output).split(/\r?\n\r?\n/).some((block) => {
    const lines = block.split(/\r?\n/)
    return lines.includes(`worktree ${workspacePath}`) || lines.includes(`branch refs/heads/${branch}`)
  })
}

function shellQuote(value) {
  const text = String(value)
  if (text.includes("\0")) throw new TypeError("remote command argument contains NUL")
  return `'${text.replaceAll("'", `'"'"'`)}'`
}

/** Contract implemented by execution contexts used by the Hermes orchestrator. */
export class ExecutionBackend {
  async prepareWorkspace(_request) { throw new Error("prepareWorkspace is not implemented") }
  async runCodexClient(_request) { throw new Error("runCodexClient is not implemented") }
  async runCommand(_request) { throw new Error("runCommand is not implemented") }
  async stat(_request) { throw new Error("stat is not implemented") }
  async validate(_request) { throw new Error("validate is not implemented") }
  async git(_request) { throw new Error("git is not implemented") }
  async cleanup(_request) { throw new Error("cleanup is not implemented") }
}

export class LocalExecutionBackend extends ExecutionBackend {
  constructor({
    runtimeRoot = process.env.WILLIAMOS_HERMES_RUNTIME_ROOT ?? path.join(process.cwd(), ".williamos-hermes"),
    repositoryRoot = process.cwd(),
    commandRunner = createCommandRunner(),
    clientFactory = (options) => new CodexAppServerClient(options),
  } = {}) {
    super()
    this.runtimeRoot = path.resolve(runtimeRoot)
    this.repositoryRoot = path.resolve(repositoryRoot)
    this.commandRunner = commandRunner
    this.clientFactory = clientFactory
    this.isLocal = true
  }

  #workspace(value) {
    return value === "bsvalues/terragroq"
      ? this.repositoryRoot
      : requiredString(value, "workspacePath")
  }

  async prepareWorkspace({ branch, baseSha, repository } = {}) {
    const repositoryRoot = path.resolve(repository && path.isAbsolute(repository) ? repository : this.repositoryRoot)
    const workspacePath = path.join(this.runtimeRoot, "worktrees", workspaceLeaf(branch))
    fs.mkdirSync(path.dirname(workspacePath), { recursive: true })
    const listing = await this.#run("git", ["-C", repositoryRoot, "worktree", "list", "--porcelain"], repositoryRoot)
    if (listing.exitCode !== 0) throw new Error(`git worktree list exited ${listing.exitCode}: ${listing.stderr}`)
    if (hasExactWorktree(listing.stdout, workspacePath, branch)) return { workspacePath }
    if (hasWorktreeConflict(listing.stdout, workspacePath, branch)) throw new Error("worktree path or branch conflicts with owned workspace")
    const result = await this.#run("git", ["-C", repositoryRoot, "worktree", "add", "-b", branch, workspacePath, requiredString(baseSha, "baseSha")], repositoryRoot)
    if (result.exitCode !== 0) throw new Error(`git worktree add exited ${result.exitCode}: ${result.stderr}`)
    return { workspacePath }
  }

  async runCodexClient({ workspacePath, timeoutMs } = {}) {
    return this.clientFactory({ cwd: requiredString(workspacePath, "workspacePath"), timeoutMs })
  }

  async #run(command, args, cwd, timeoutMs, env, credentialAccess) {
    return commandResult(await this.commandRunner({ command, args, cwd, timeoutMs, env, credentialAccess }))
  }

  async runCommand({ workspacePath, command, args = [], timeoutMs, env, credentialAccess } = {}) {
    return this.#run(requiredString(command, "command"), args, this.#workspace(workspacePath), timeoutMs, env, credentialAccess)
  }

  async stat({ workspacePath, relPath } = {}) {
    const root = path.resolve(requiredString(workspacePath, "workspacePath"))
    const candidate = path.resolve(root, requiredString(relPath, "relPath"))
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error("relPath escapes workspace")
    const value = fs.statSync(candidate, { throwIfNoEntry: false })
    return { exists: Boolean(value), isFile: value?.isFile() === true }
  }

  async validate({ workspacePath, commands = [] } = {}) {
    const results = []
    for (const entry of commands) results.push(await this.runCommand({ workspacePath, ...entry }))
    return results
  }

  async git({ workspacePath, args = [], timeoutMs } = {}) {
    const result = await this.runCommand({ workspacePath: this.#workspace(workspacePath), command: "git", args, timeoutMs })
    return { exitCode: result.exitCode, stdout: result.stdout }
  }

  async cleanup({ workspacePath } = {}) {
    const ownedRoot = path.join(this.runtimeRoot, "worktrees")
    const target = path.resolve(requiredString(workspacePath, "workspacePath"))
    if (path.dirname(target) !== ownedRoot) throw new Error("workspacePath is outside the owned worktree root")
    const result = await this.#run("git", ["-C", this.repositoryRoot, "worktree", "remove", target], this.repositoryRoot)
    if (result.exitCode !== 0) throw new Error(`git worktree remove exited ${result.exitCode}: ${result.stderr}`)
  }
}

export class AegisExecutionBackend extends ExecutionBackend {
  constructor({
    host = process.env.WILLIAMOS_CODEX_EXEC_NODE,
    runtimeRoot = process.env.WILLIAMOS_AEGIS_RUNTIME_ROOT ?? process.env.WILLIAMOS_HERMES_RUNTIME_ROOT ?? "/srv/william/hermes",
    repositoryRoot = process.env.WILLIAMOS_AEGIS_REPOSITORY_ROOT ?? "/srv/william/terragroq",
    commandRunner = createCommandRunner(),
    clientFactory,
  } = {}) {
    super()
    this.host = requiredString(host, "host").trim()
    if (this.host.startsWith("-") || !/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(this.host)) {
      throw new TypeError("host must be a safe SSH destination")
    }
    this.runtimeRoot = path.posix.resolve(runtimeRoot)
    this.repositoryRoot = path.posix.resolve(repositoryRoot)
    this.commandRunner = commandRunner
    this.clientFactory = clientFactory
  }

  #workspace(value) {
    return value === "bsvalues/terragroq"
      ? this.repositoryRoot
      : requiredString(value, "workspacePath")
  }

  async #remote(command, args = [], { cwd, timeoutMs, env = {} } = {}) {
    const words = []
    if (cwd) words.push("cd", "--", shellQuote(cwd), "&&")
    for (const [key, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new TypeError(`unsafe environment name: ${key}`)
      words.push(`${key}=${shellQuote(String(value))}`)
    }
    words.push("exec", shellQuote(command), ...args.map((arg) => shellQuote(String(arg))))
    return commandResult(await this.commandRunner({
      command: "ssh",
      args: ["-o", "BatchMode=yes", this.host, words.join(" ")],
      timeoutMs,
    }))
  }

  async prepareWorkspace({ branch, baseSha, repository } = {}) {
    const repositoryRoot = typeof repository === "string" && repository.startsWith("/")
      ? path.posix.resolve(repository) : this.repositoryRoot
    const workspacePath = path.posix.join(this.runtimeRoot, "worktrees", workspaceLeaf(branch))
    const mkdir = await this.#remote("mkdir", ["-p", path.posix.dirname(workspacePath)])
    if (mkdir.exitCode !== 0) throw new Error(`remote mkdir exited ${mkdir.exitCode}: ${mkdir.stderr}`)
    const listing = await this.#remote("git", ["-C", repositoryRoot, "worktree", "list", "--porcelain"])
    if (listing.exitCode !== 0) throw new Error(`remote git worktree list exited ${listing.exitCode}: ${listing.stderr}`)
    if (hasExactWorktree(listing.stdout, workspacePath, branch)) return { workspacePath }
    if (hasWorktreeConflict(listing.stdout, workspacePath, branch)) throw new Error("worktree path or branch conflicts with owned workspace")
    const result = await this.#remote("git", ["-C", repositoryRoot, "worktree", "add", "-b", branch, workspacePath, requiredString(baseSha, "baseSha")])
    if (result.exitCode !== 0) throw new Error(`remote git worktree add exited ${result.exitCode}: ${result.stderr}`)
    return { workspacePath }
  }

  async runCodexClient({ workspacePath, timeoutMs } = {}) {
    const remoteCwd = requiredString(workspacePath, "workspacePath")
    if (this.clientFactory) return this.clientFactory({ cwd: remoteCwd, timeoutMs })
    return new CodexAppServerClient({
      command: "ssh",
      args: ["-o", "BatchMode=yes", this.host, "codex", "app-server", "--stdio"],
      timeoutMs,
    })
  }

  async runCommand({ workspacePath, command, args = [], timeoutMs, env } = {}) {
    return this.#remote(requiredString(command, "command"), args, {
      cwd: this.#workspace(workspacePath), timeoutMs, env,
    })
  }

  async stat({ workspacePath, relPath } = {}) {
    const root = path.posix.resolve(requiredString(workspacePath, "workspacePath"))
    const candidate = path.posix.resolve(root, requiredString(relPath, "relPath"))
    if (candidate !== root && !candidate.startsWith(`${root}/`)) throw new Error("relPath escapes workspace")
    const result = await this.#remote("test", ["-e", candidate, "-a", "-f", candidate])
    if (result.exitCode === 0) return { exists: true, isFile: true }
    const exists = await this.#remote("test", ["-e", candidate])
    if (![0, 1].includes(exists.exitCode)) throw new Error(`remote stat exited ${exists.exitCode}: ${exists.stderr}`)
    return { exists: exists.exitCode === 0, isFile: false }
  }

  async validate({ workspacePath, commands = [] } = {}) {
    const results = []
    for (const entry of commands) {
      if (entry.command === "npm" && entry.args?.[0] === "run" && entry.args?.[1] === "build") {
        const cleanup = await this.runCommand({ workspacePath, command: "rm", args: ["-rf", "--", ".next"] })
        if (cleanup.exitCode !== 0) throw new Error(`remote validation cleanup exited ${cleanup.exitCode}`)
      }
      results.push(await this.runCommand({ workspacePath, ...entry }))
    }
    return results
  }

  async git({ workspacePath, args = [], timeoutMs } = {}) {
    const result = await this.runCommand({ workspacePath: this.#workspace(workspacePath), command: "git", args, timeoutMs })
    return { exitCode: result.exitCode, stdout: result.stdout }
  }

  async cleanup({ workspacePath } = {}) {
    const ownedRoot = path.posix.join(this.runtimeRoot, "worktrees")
    const target = path.posix.resolve(requiredString(workspacePath, "workspacePath"))
    if (path.posix.dirname(target) !== ownedRoot) throw new Error("workspacePath is outside the owned worktree root")
    const result = await this.#remote("git", ["-C", this.repositoryRoot, "worktree", "remove", target])
    if (result.exitCode !== 0) throw new Error(`remote git worktree remove exited ${result.exitCode}: ${result.stderr}`)
  }
}

export function selectExecutionBackend(env = process.env) {
  const host = env?.WILLIAMOS_CODEX_EXEC_NODE
  if (typeof host === "string" && host.trim().length > 0) {
    const options = { host }
    const runtimeRoot = env.WILLIAMOS_AEGIS_RUNTIME_ROOT ?? env.WILLIAMOS_HERMES_RUNTIME_ROOT
    if (runtimeRoot) options.runtimeRoot = runtimeRoot
    if (env.WILLIAMOS_AEGIS_REPOSITORY_ROOT) options.repositoryRoot = env.WILLIAMOS_AEGIS_REPOSITORY_ROOT
    return new AegisExecutionBackend(options)
  }
  const options = {}
  if (env?.WILLIAMOS_HERMES_RUNTIME_ROOT) options.runtimeRoot = env.WILLIAMOS_HERMES_RUNTIME_ROOT
  if (env?.WILLIAMOS_REPOSITORY_ROOT) options.repositoryRoot = env.WILLIAMOS_REPOSITORY_ROOT
  return new LocalExecutionBackend(options)
}
