import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { describe, expect, it, vi } from "vitest"

import {
  createCommandEnvironment,
  resolveWorktreeValidationEnvironment,
  resolveWorktreeValidationInvocation,
  createRepositoryLifecycle,
  readSafeUntrackedSnapshotFile,
  HermesRepositoryLifecycleError,
} from "../scripts/hermes-bridge/repository-lifecycle.mjs"

const sha = "a".repeat(40)
const mergeSha = "b".repeat(40)
const root = path.resolve("C:/workspace/terragroq")
const ownedRoot = path.resolve("C:/workspace-owned/hermes")
const ownedWorktree = path.join(ownedRoot, "hermes-goal-77")
const rootGit = `git -C ${root}`
const ownedGit = `git -C ${ownedWorktree}`
const branch = "codex/hermes-goal-77"

type Call = {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  timeoutMs?: number
  credentialAccess?: boolean
}

describe("untracked snapshot containment", () => {
  it("rejects an untracked symbolic link before reading its external target", () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-snapshot-root-"))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-snapshot-outside-"))
    try {
      const target = path.join(outside, "secret.test.ts")
      const link = path.join(worktree, "linked.test.ts")
      fs.writeFileSync(target, "outside")
      fs.symlinkSync(target, link, "file")
      expect(() => readSafeUntrackedSnapshotFile(worktree, "linked.test.ts"))
        .toThrow(expect.objectContaining({ code: "HERMES_REPOSITORY_SNAPSHOT_WALL" }))
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it("rejects a symlinked intermediate directory without opening its target", () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-snapshot-root-"))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-snapshot-outside-"))
    try {
      fs.writeFileSync(path.join(outside, "secret.test.ts"), "outside")
      fs.symlinkSync(outside, path.join(worktree, "linked"), process.platform === "win32" ? "junction" : "dir")
      expect(() => readSafeUntrackedSnapshotFile(worktree, "linked/secret.test.ts"))
        .toThrow(expect.objectContaining({ code: "HERMES_REPOSITORY_SNAPSHOT_WALL" }))
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")("rejects a FIFO without blocking the supervisor", () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-snapshot-root-"))
    try {
      const fifo = path.join(worktree, "blocked.test.ts")
      execFileSync("mkfifo", [fifo])
      const startedAt = Date.now()
      expect(() => readSafeUntrackedSnapshotFile(worktree, "blocked.test.ts"))
        .toThrow(expect.objectContaining({ code: "HERMES_REPOSITORY_SNAPSHOT_WALL" }))
      expect(Date.now() - startedAt).toBeLessThan(2_000)
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true })
    }
  })
})

function fixture(overrides: Record<string, (call: Call) => unknown> = {}) {
  const calls: Call[] = []
  const runner = async (call: Call) => {
    calls.push(call)
    const key = `${call.command} ${call.args.filter((arg) => !arg.startsWith("query=")).join(" ")}`
    const override = Object.entries(overrides).find(([prefix]) => key.startsWith(prefix))?.[1]
    if (override) return override(call)
    if (key.includes("remote get-url origin")) return { code: 0, stdout: "https://github.com/bsvalues/terragroq.git\n" }
    if (key.includes("rev-parse refs/remotes/origin/main")) return { code: 0, stdout: `${sha}\n` }
    if (key.includes("ls-remote --heads origin refs/heads/")) {
      return { code: 0, stdout: `${sha}\t${call.args.at(-1)}\n` }
    }
    if (key.includes("rev-parse FETCH_HEAD")) return { code: 0, stdout: `${sha}\n` }
    if (key.includes("rev-parse refs/heads/")) return { code: 0, stdout: `${sha}\n` }
    if (key.includes("rev-parse HEAD")) return { code: 0, stdout: `${sha}\n` }
    if (key.includes("show-ref --verify --quiet")) return { code: 1 }
    if (key.includes("gh api repos/bsvalues/terragroq/commits/")) {
      return { code: 0, stdout: JSON.stringify({ statuses: [] }) }
    }
    return { code: 0, stdout: "" }
  }
  const lifecycle = createRepositoryLifecycle({
    repository: "bsvalues/terragroq",
    workspaceRoot: root,
    repositoryRoot: root,
    ownedWorktreeRoot: ownedRoot,
    validationCommands: [{ command: "npm", args: ["test", "--", "--run", "tests/unit.test.ts"] }],
    runner,
  })
  return { lifecycle, calls }
}

function reviewState(reviewThreads: unknown[] = [], comments: unknown[] = [], commentsPaginated = false) {
  return { data: { repository: { pullRequest: {
    mergedAt: "2026-07-27T19:00:00.000Z",
    reviewThreads: { nodes: reviewThreads, pageInfo: { hasNextPage: false } },
    comments: { nodes: comments, pageInfo: { hasPreviousPage: commentsPaginated, hasNextPage: false } },
  } } } }
}

async function ownedFixture(overrides: Record<string, (call: Call) => unknown> = {}) {
  const value = fixture(overrides)
  const record = await value.lifecycle.createWorktree({ branch })
  value.calls.length = 0
  return { ...value, record }
}

async function remoteDependencyFixture({
  repositoryHashes = ["1".repeat(64), "2".repeat(64)],
  worktreeHashes = repositoryHashes,
  target = "absent",
  marker = target === "owned-tree",
  failCopy = false,
  failValidation = false,
  sourceLink = false,
  dirtyAfterCopy = false,
  sourceDirectoryCode = 0,
  sourceLinkCode = sourceLink ? 0 : 1,
}: {
  repositoryHashes?: string[]
  worktreeHashes?: string[]
  target?: "absent" | "owned-tree" | "foreign-tree" | "symlink"
  marker?: boolean
  failCopy?: boolean
  failValidation?: boolean
  sourceLink?: boolean
  dirtyAfterCopy?: boolean
  sourceDirectoryCode?: number
  sourceLinkCode?: number
} = {}) {
  const repositoryPath = "/srv/william/terragroq"
  const worktreePath = "/srv/william/hermes/worktrees/hermes-goal-77"
  const dependencySource = `${repositoryPath}/node_modules`
  const dependencyTarget = `${worktreePath}/node_modules`
  const dependencyMarker = `${dependencyTarget}/.williamos-validation-dependencies`
  const sourceMarker = `${dependencySource}/.williamos-validation-dependencies`
  const calls: Array<{ workspacePath: string; command: string; args: string[] }> = []
  let targetState = target
  let markerPresent = marker
  let remainingCopyFailures = failCopy ? 1 : 0
  let validationSawIsolatedTree = false
  const governedSourceContents = "governed-dependencies"
  let isolatedTargetContents: string | null = targetState === "owned-tree" ? governedSourceContents : null
  const hashes = (values: string[]) => [
    `${values[0]}  package.json`,
    `${values[1]}  pnpm-lock.yaml`,
    "",
  ].join("\n")
  const backend = {
    isLocal: false,
    prepareWorkspace: vi.fn(async () => ({ workspacePath: worktreePath })),
    git: vi.fn(async ({ args }: { args: string[] }) => ({
      exitCode: 0,
      stdout: args.join(" ").includes("remote get-url origin")
        ? "https://github.com/bsvalues/terragroq.git\n"
        : args.join(" ").includes("rev-parse HEAD") ? `${sha}\n` : "",
    })),
    runCommand: vi.fn(async ({
      workspacePath, command, args,
    }: { workspacePath: string; command: string; args: string[] }) => {
      calls.push({ workspacePath, command, args: [...args] })
      if (command === "pwd") return { exitCode: 0, stdout: `${repositoryPath}\n`, stderr: "" }
      if (command === "sha256sum") {
        return {
          exitCode: 0,
          stdout: hashes(workspacePath === "bsvalues/terragroq" ? repositoryHashes : worktreeHashes),
          stderr: "",
        }
      }
      if (command === "stat") return { exitCode: 0, stdout: "2049:777\n", stderr: "" }
      if (command === "test" && args[0] === "-d") {
        const code = args[1] === dependencySource
          ? sourceDirectoryCode
          : ["owned-tree", "foreign-tree", "symlink"].includes(targetState) ? 0 : 1
        return { exitCode: code, stdout: "", stderr: "" }
      }
      if (command === "test" && args[0] === "-L") {
        return {
          exitCode: args[1] === dependencySource ? sourceLinkCode : targetState === "symlink" ? 0 : 1,
          stdout: "", stderr: "",
        }
      }
      if (command === "test" && args[0] === "-e") {
        if (args[1] === sourceMarker) return { exitCode: 1, stdout: "", stderr: "" }
        return { exitCode: targetState === "absent" ? 1 : 0, stdout: "", stderr: "" }
      }
      if (command === "test" && args[0] === "-f") {
        return { exitCode: args[1] === dependencyMarker && markerPresent ? 0 : 1, stdout: "", stderr: "" }
      }
      if (command === "readlink") {
        return { exitCode: 0, stdout: `${dependencySource}\n`, stderr: "" }
      }
      if (command === "git" && args.includes("check-ignore")) {
        return { exitCode: 0, stdout: "", stderr: "" }
      }
      if (command === "git" && args.includes("ls-files")) {
        return { exitCode: 0, stdout: "", stderr: "" }
      }
      if (command === "git" && args.includes("status")) {
        return { exitCode: 0, stdout: dirtyAfterCopy && targetState === "owned-tree" ? "?? node_modules\0" : "", stderr: "" }
      }
      if (command === "cp") {
        targetState = "owned-tree"
        isolatedTargetContents = governedSourceContents
        if (remainingCopyFailures > 0) {
          remainingCopyFailures -= 1
          isolatedTargetContents = "partial-copy"
          return { exitCode: 1, stdout: "", stderr: "refused" }
        }
        return { exitCode: 0, stdout: "", stderr: "" }
      }
      if (command === "node" && args[1]?.includes("writeFileSync")) {
        targetState = "owned-tree"
        markerPresent = true
        return { exitCode: 0, stdout: "", stderr: "" }
      }
      if (command === "node" && args[1]?.includes("readFileSync")) {
        return { exitCode: markerPresent && targetState === "owned-tree" ? 0 : 1, stdout: "", stderr: "" }
      }
      if (command === "rm") {
        targetState = "absent"
        markerPresent = false
        return { exitCode: 0, stdout: "", stderr: "" }
      }
      return { exitCode: 0, stdout: "", stderr: "" }
    }),
    validate: vi.fn(async () => {
      validationSawIsolatedTree = targetState === "owned-tree" && markerPresent
      isolatedTargetContents = "validator-write"
      if (failValidation) throw new Error("remote validation transport refused")
      return [{ exitCode: 0, stdout: "passed", stderr: "" }]
    }),
    stat: vi.fn(async () => ({ exists: targetState !== "absent", isFile: false })),
    cleanup: vi.fn(async () => {}),
  }
  const lifecycle = createRepositoryLifecycle({
    workspaceRoot: root,
    ownedWorktreeRoot: ownedRoot,
    executionBackend: backend,
    validationCommands: [{ command: "npm", args: ["test", "--", "--run"] }],
  })
  const record = await lifecycle.ensureOwnedWorktree({
    branch, baseSha: sha, worktreePath: ownedWorktree,
  })
  return {
    lifecycle,
    backend,
    record,
    calls,
    dependencySource,
    dependencyTarget,
    targetState: () => targetState,
    markerPresent: () => markerPresent,
    validationSawIsolatedTree: () => validationSawIsolatedTree,
    governedSourceContents: () => governedSourceContents,
    isolatedTargetContents: () => isolatedTargetContents,
  }
}

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected Hermes repository lifecycle wall")
  } catch (error) {
    expect(error).toBeInstanceOf(HermesRepositoryLifecycleError)
    expect(error).toMatchObject({ code })
  }
}

describe("Hermes repository lifecycle", () => {
  it("delegates workspace, git, and validation execution to an injected backend", async () => {
    const remoteWorkspace = "/srv/william/hermes/worktrees/hermes-goal-77"
    const backend = {
      prepareWorkspace: vi.fn(async () => ({ workspacePath: remoteWorkspace })),
      git: vi.fn(async ({ args }: { args: string[] }) => ({
        exitCode: 0,
        stdout: args.join(" ").includes("remote get-url origin")
          ? "https://github.com/bsvalues/terragroq.git\n"
          : "",
      })),
      runCommand: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
      validate: vi.fn(async () => [{ exitCode: 0, stdout: "passed", stderr: "" }]),
      cleanup: vi.fn(async () => {}),
    }
    const lifecycle = createRepositoryLifecycle({
      workspaceRoot: root,
      ownedWorktreeRoot: ownedRoot,
      executionBackend: backend,
      validationCommands: [{ command: "npm", args: ["test", "--", "--run"] }],
    })

    const record = await lifecycle.ensureOwnedWorktree({
      branch, baseSha: sha, worktreePath: ownedWorktree,
    })
    await expect(lifecycle.runValidationCommands(record)).resolves.toEqual([
      { command: "npm", args: ["test", "--", "--run"], code: 0 },
    ])
    expect(record.worktreePath).toBe(remoteWorkspace)
    expect(backend.prepareWorkspace).toHaveBeenCalledWith({
      branch, baseSha: sha, repository: "bsvalues/terragroq",
    })
    expect(backend.git).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: "bsvalues/terragroq",
      args: ["remote", "get-url", "origin"],
    }))
    expect(backend.validate).toHaveBeenCalledWith({
      workspacePath: remoteWorkspace,
      commands: [expect.objectContaining({ command: "npm", args: ["test", "--", "--run"] })],
    })
  })

  it("copies an isolated remote validation dependency tree and removes it after validation", async () => {
    const value = await remoteDependencyFixture()

    const pendingProvision = value.lifecycle.ensureValidationDependencies(value.record)
    await expect(value.lifecycle.runValidationCommands(value.record)).resolves.toEqual([
      { command: "npm", args: ["test", "--", "--run"], code: 0 },
    ])
    await pendingProvision

    expect(value.validationSawIsolatedTree()).toBe(true)
    expect(value.isolatedTargetContents()).toBe("validator-write")
    expect(value.governedSourceContents()).toBe("governed-dependencies")
    expect(value.targetState()).toBe("absent")
    expect(value.lifecycle.removeValidationDependencies(value.record)).toEqual({ removed: false })
    expect(value.calls).toContainEqual({
      workspacePath: value.record.worktreePath,
      command: "cp",
      args: ["-a", "--reflink=auto", "--", `${value.dependencySource}/.`, value.dependencyTarget],
    })
    expect(value.calls).toContainEqual({
      workspacePath: value.record.worktreePath,
      command: "rm",
      args: ["-rf", "--", value.dependencyTarget],
    })
    expect(value.calls.some(({ command }) => command === "ln")).toBe(false)
    expect(value.calls.filter(({ command }) => command === "rm")).toHaveLength(1)
  })

  it("types unsupported dependency lock transitions and leaves copy and validators inert", async () => {
    const value = await remoteDependencyFixture({ worktreeHashes: ["1".repeat(64), "3".repeat(64)] })

    await expect(value.lifecycle.ensureValidationDependencies(value.record)).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_VALIDATION_DEPENDENCY_LOCK_WALL",
    })
    expect(value.calls.some(({ command }) => command === "cp")).toBe(false)
    expect(value.backend.validate).not.toHaveBeenCalled()
    expect(value.targetState()).toBe("absent")
  })

  it("refuses a pre-existing remote dependency directory without mutation", async () => {
    const value = await remoteDependencyFixture({ target: "foreign-tree" })

    await expect(value.lifecycle.ensureValidationDependencies(value.record)).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_VALIDATION_WALL",
    })
    expect(value.calls.some(({ command }) => command === "cp")).toBe(false)
    expect(value.targetState()).toBe("foreign-tree")
  })

  it("recursively removes only an ordinary marked remote dependency tree", async () => {
    const exact = await remoteDependencyFixture({ target: "owned-tree" })
    await expect(exact.lifecycle.removeValidationDependencies(exact.record)).resolves.toEqual({ removed: true })
    expect(exact.targetState()).toBe("absent")
    expect(exact.calls.filter(({ command }) => command === "rm")).toEqual([{
      workspacePath: exact.record.worktreePath,
      command: "rm",
      args: ["-rf", "--", exact.dependencyTarget],
    }])

    for (const options of [
      { target: "owned-tree" as const, marker: false },
      { target: "foreign-tree" as const, marker: true },
      { target: "symlink" as const, marker: true },
    ]) {
      const wrong = await remoteDependencyFixture(options)
      await expect(wrong.lifecycle.removeValidationDependencies(wrong.record)).rejects.toMatchObject({
        code: "HERMES_REPOSITORY_CLEANUP_WALL",
      })
      expect(wrong.calls.some(({ command }) => command === "rm")).toBe(false)
    }
  })

  it("cleans a partial remote dependency copy and permits an exact retry", async () => {
    const value = await remoteDependencyFixture({ failCopy: true })

    await expect(value.lifecycle.ensureValidationDependencies(value.record)).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_VALIDATION_WALL",
    })
    expect(value.targetState()).toBe("absent")
    expect(value.calls.filter(({ command }) => command === "rm")).toHaveLength(1)

    await expect(value.lifecycle.ensureValidationDependencies(value.record)).resolves.toMatchObject({ copied: true })
    expect(value.targetState()).toBe("owned-tree")
    await expect(value.lifecycle.removeValidationDependencies(value.record)).resolves.toEqual({ removed: true })
    expect(value.targetState()).toBe("absent")
  })

  it("refuses a symlinked remote dependency source", async () => {
    const value = await remoteDependencyFixture({ sourceLink: true })

    await expect(value.lifecycle.ensureValidationDependencies(value.record)).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_VALIDATION_WALL",
    })
    expect(value.calls.some(({ command }) => command === "cp")).toBe(false)
  })

  it("fails closed on anomalous remote source directory inspection results", async () => {
    for (const options of [{ sourceDirectoryCode: 2 }, { sourceLinkCode: 2 }]) {
      const value = await remoteDependencyFixture(options)
      await expect(value.lifecycle.ensureValidationDependencies(value.record)).rejects.toMatchObject({
        code: "HERMES_REPOSITORY_VALIDATION_WALL",
      })
      expect(value.calls.some(({ command }) => command === "cp")).toBe(false)
    }
  })

  it("removes the isolated remote dependency tree when validation cannot start", async () => {
    const value = await remoteDependencyFixture({ failValidation: true })

    const pendingProvision = value.lifecycle.ensureValidationDependencies(value.record)
    await expect(value.lifecycle.runValidationCommands(value.record)).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_RUNNER_WALL",
    })
    await pendingProvision
    expect(value.validationSawIsolatedTree()).toBe(true)
    expect(value.targetState()).toBe("absent")
  })

  it("removes repository and provider secrets from child command environments", () => {
    const source = {
      Path: "C:/tools", USERPROFILE: "C:/Users/owner", APPDATA: "C:/Users/owner/AppData/Roaming",
      SSH_AUTH_SOCK: "C:/Users/owner/.ssh/agent.sock",
      SystemRoot: "C:/Windows", TEMP: "C:/Temp", TMPDIR: "C:/Temp/posix",
      DATABASE_URL: "postgresql://owner:secret@database.invalid/app", OPENAI_API_KEY: "secret",
      GH_TOKEN: "secret", BETTER_AUTH_SECRET: "secret",
    }
    expect(createCommandEnvironment(source, {
      NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: "still-forbidden",
    })).toEqual({
      Path: "C:/tools", USERPROFILE: "C:/Users/owner", APPDATA: "C:/Users/owner/AppData/Roaming",
      SSH_AUTH_SOCK: "C:/Users/owner/.ssh/agent.sock",
      SystemRoot: "C:/Windows", TEMP: "C:/Temp", TMPDIR: "C:/Temp/posix",
      NEXT_TELEMETRY_DISABLED: "1",
    })
    expect(createCommandEnvironment(source, { NEXT_TELEMETRY_DISABLED: "1" }, {
      credentialAccess: false, validationHome: "C:/Temp/isolated-validation",
    })).toEqual({
      Path: "C:/tools", SystemRoot: "C:/Windows", TEMP: "C:/Temp", TMPDIR: "C:/Temp/posix",
      NEXT_TELEMETRY_DISABLED: "1",
      USERPROFILE: path.resolve("C:/Temp/isolated-validation"),
      HOME: path.resolve("C:/Temp/isolated-validation"),
      APPDATA: path.resolve("C:/Temp/isolated-validation/AppData/Roaming"),
      LOCALAPPDATA: path.resolve("C:/Temp/isolated-validation/AppData/Local"),
    })
    expect(createCommandEnvironment(source, {
      NODE_PATH: "C:/workspace/node_modules/.pnpm/node_modules",
    }, { credentialAccess: false, validationHome: "C:/Temp/isolated-validation" })).toMatchObject({
      NODE_PATH: "C:/workspace/node_modules/.pnpm/node_modules",
    })
  })

  it("resolves Windows junction-backed Vitest and Next validators to local Node entrypoints", () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-validation-invocation-"))
    try {
      const vitest = path.join(worktree, "node_modules", "vitest", "vitest.mjs")
      const next = path.join(worktree, "node_modules", "next", "dist", "bin", "next")
      fs.mkdirSync(path.dirname(vitest), { recursive: true })
      fs.mkdirSync(path.dirname(next), { recursive: true })
      fs.writeFileSync(vitest, "")
      fs.writeFileSync(next, "")

      expect(resolveWorktreeValidationInvocation({
        command: "NPX.EXE", args: ["vitest", "run", "tests/focused.test.ts"], env: {}, timeoutMs: 1,
      }, worktree, "win32")).toMatchObject({
        command: process.execPath,
        args: [vitest, "run", "tests/focused.test.ts"],
      })
      expect(resolveWorktreeValidationInvocation({
        command: "npm", args: ["test", "--", "--run"], env: {}, timeoutMs: 1,
      }, worktree, "win32")).toMatchObject({
        command: process.execPath,
        args: [vitest, "run", "--run"],
      })
      expect(resolveWorktreeValidationInvocation({
        command: "NPM.CMD", args: ["run", "build", "--", "--profile"], env: {}, timeoutMs: 1,
      }, worktree, "win32")).toMatchObject({
        command: process.execPath,
        args: [next, "build", "--profile"],
      })
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true })
    }
  })

  it("binds Windows validation to the owned pnpm virtual module directory", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-validation-environment-"))
    const pnpmModules = path.join(workspace, "node_modules", ".pnpm", "node_modules")
    try {
      fs.mkdirSync(pnpmModules, { recursive: true })
      expect(resolveWorktreeValidationEnvironment({
        NEXT_TELEMETRY_DISABLED: "1",
      }, workspace, "win32")).toEqual({
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_PATH: pnpmModules,
      })
      expect(resolveWorktreeValidationEnvironment({
        NEXT_TELEMETRY_DISABLED: "1",
      }, workspace, "linux")).toEqual({
        NEXT_TELEMETRY_DISABLED: "1",
      })
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it("refreshes only the verified terragroq origin/main ref", async () => {
    const { lifecycle, calls } = fixture()
    await expect(lifecycle.refreshOriginMain()).resolves.toBe(sha)
    expect(calls.map(({ command, args }) => [command, args])).toEqual([
      ["git", ["-C", root, "remote", "get-url", "origin"]],
      ["git", ["-C", root, "fetch", "--no-tags", "--prune", "origin", "main"]],
      ["git", ["-C", root, "rev-parse", "refs/remotes/origin/main"]],
    ])
  })

  it("creates and then idempotently reuses an owned Hermes worktree", async () => {
    const { lifecycle, calls } = fixture()
    const first = await lifecycle.createWorktree({ branch })
    const second = await lifecycle.createWorktree({ branch })
    expect(second).toEqual(first)
    expect(first.worktreePath).toBe(path.join(ownedRoot, "hermes-goal-77"))
    expect(calls.filter(({ args }) => args.includes("worktree") && args.includes("add"))).toEqual([
      expect.objectContaining({
        command: "git",
        args: ["-C", root, "worktree", "add", "-b", branch, first.worktreePath, "refs/remotes/origin/main"],
      }),
    ])
  })

  it("does not adopt a pre-existing branch as Hermes-owned", async () => {
    const { lifecycle, calls } = fixture({
      [`${rootGit} show-ref`]: () => ({ code: 0 }),
    })
    await expect(lifecycle.createWorktree({ branch })).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_OWNERSHIP_WALL",
    })
    expect(calls.some(({ args }) => args.includes("worktree") && args.includes("add"))).toBe(false)
  })

  it("rehydrates only a persisted worktree registered to the exact owned branch", async () => {
    const worktreePath = ownedWorktree
    const { lifecycle } = fixture({
      [`${rootGit} worktree list`]: () => ({
        code: 0,
        stdout: `worktree ${worktreePath.replace(/\\/g, "/")}\nHEAD ${sha}\nbranch refs/heads/${branch}\n\n`,
      }),
      [`${ownedGit} branch --show-current`]: () => ({ code: 0, stdout: `${branch}\n` }),
    })
    await expect(lifecycle.resumeOwnedWorktree({ branch, worktreePath })).resolves.toMatchObject({
      branch, worktreePath, resumed: true,
    })
  })

  it("inspects tracked, untracked, renamed, and committed paths and runs configured validation", async () => {
    const { lifecycle, calls, record } = await ownedFixture({
      [`${ownedGit} status`]: () => ({ code: 0, stdout: " M src/a.ts\0?? src/new.ts\0R  src/old.ts\0src/moved.ts\0" }),
      [`${ownedGit} diff`]: () => ({ code: 0, stdout: "M\0src/a.ts\0R100\0lib/db/old.ts\0tests/a.test.ts\0" }),
    })
    await expect(lifecycle.inspectChangedPaths(record)).resolves.toEqual([
      "lib/db/old.ts", "src/a.ts", "src/moved.ts", "src/new.ts", "src/old.ts", "tests/a.test.ts",
    ])
    await expect(lifecycle.runValidationCommands(record)).resolves.toEqual([
      { command: "npm", args: ["test", "--", "--run", "tests/unit.test.ts"], code: 0 },
    ])
    expect(calls.at(-1)).toEqual({
      command: "npm",
      args: ["test", "--", "--run", "tests/unit.test.ts"],
      cwd: record.worktreePath,
      env: { WILLIAMOS_HERMES_VALIDATION_ISOLATED: "1" },
      timeoutMs: 10 * 60 * 1000,
      credentialAccess: false,
    })
  })

  it("passes only allowlisted validator environment overrides", async () => {
    const calls: Call[] = []
    const lifecycle = createRepositoryLifecycle({
      workspaceRoot: root,
      ownedWorktreeRoot: ownedRoot,
      validationCommands: [{
        command: "npm", args: ["run", "build"],
        env: { NEXT_PRIVATE_BUILD_WORKER: "0", NEXT_TELEMETRY_DISABLED: "1" },
      }],
      runner: async (call: Call) => {
        calls.push(call)
        if (call.args.includes("remote") && call.args.includes("get-url")) {
          return { code: 0, stdout: "https://github.com/bsvalues/terragroq.git\n" }
        }
        if (call.args.includes("show-ref")) return { code: 1, stdout: "" }
        return { code: 0, stdout: "" }
      },
    })
    await lifecycle.createWorktree({ branch })
    calls.length = 0
    await lifecycle.runValidationCommands({ worktreePath: ownedWorktree, branch })
    expect(calls.at(-1)).toEqual({
      command: "npm", args: ["run", "build"], cwd: ownedWorktree,
      env: {
        NEXT_PRIVATE_BUILD_WORKER: "0", NEXT_TELEMETRY_DISABLED: "1",
        WILLIAMOS_HERMES_VALIDATION_ISOLATED: "1",
      },
      timeoutMs: 10 * 60 * 1000,
      credentialAccess: false,
    })
    expect(() => createRepositoryLifecycle({
      workspaceRoot: root, ownedWorktreeRoot: ownedRoot,
      validationCommands: [{ command: "npm", args: ["run", "build"], env: { DATABASE_URL: "forbidden" } }],
      runner: async () => ({ code: 0 }),
    })).toThrow(HermesRepositoryLifecycleError)
    expect(() => createRepositoryLifecycle({
      workspaceRoot: root, ownedWorktreeRoot: ownedRoot,
      validationCommands: [{ command: "npm", args: ["run", "build"], env: { NODE_PATH: "caller-controlled" } }],
      runner: async () => ({ code: 0 }),
    })).toThrow(HermesRepositoryLifecycleError)
  })

  it("allows only the exact read-only git diff check validator", async () => {
    const calls: Call[] = []
    const lifecycle = createRepositoryLifecycle({
      workspaceRoot: root,
      ownedWorktreeRoot: ownedRoot,
      validationCommands: [{ command: "git", args: ["diff", "--check"] }],
      runner: async (call: Call) => {
        calls.push(call)
        if (call.args.includes("remote") && call.args.includes("get-url")) {
          return { code: 0, stdout: "https://github.com/bsvalues/terragroq.git\n" }
        }
        if (call.args.includes("show-ref")) return { code: 1, stdout: "" }
        return { code: 0, stdout: "" }
      },
    })
    const record = await lifecycle.createWorktree({ branch })
    calls.length = 0
    await lifecycle.runValidationCommands(record)
    expect(calls.at(-1)).toMatchObject({
      command: "git", args: ["diff", "--check"], credentialAccess: false,
    })

    for (const args of [
      ["status"], ["diff"], ["diff", "--cached", "--check"],
      ["diff", "--check", "docs/report.md"], ["-C", root, "diff", "--check"],
    ]) {
      expect(() => createRepositoryLifecycle({
        workspaceRoot: root,
        ownedWorktreeRoot: ownedRoot,
        validationCommands: [{ command: "git", args }],
        runner: async () => ({ code: 0 }),
      })).toThrow(HermesRepositoryLifecycleError)
    }
  })

  it("removes only owned generated Next output immediately before a build", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-next-validation-"))
    const workspaceRoot = path.join(tempRoot, "repository")
    const worktreeRoot = path.join(tempRoot, "worktrees")
    let nextOutputPresentDuringBuild = true
    try {
      const lifecycle = createRepositoryLifecycle({
        workspaceRoot,
        repositoryRoot: workspaceRoot,
        ownedWorktreeRoot: worktreeRoot,
        validationCommands: [{ command: "npm", args: ["run", "build"] }],
        runner: async ({ command, args, cwd }: Call) => {
          if (args.includes("remote") && args.includes("get-url")) {
            return { code: 0, stdout: "https://github.com/bsvalues/terragroq.git\n" }
          }
          if (args.includes("show-ref")) return { code: 1, stdout: "" }
          if (command === "npm" && args[0] === "run" && args[1] === "build") {
            nextOutputPresentDuringBuild = fs.existsSync(path.join(cwd, ".next"))
          }
          return { code: 0, stdout: "" }
        },
      })
      const record = await lifecycle.createWorktree({ branch })
      fs.mkdirSync(path.join(record.worktreePath, ".next", "standalone"), { recursive: true })
      fs.writeFileSync(path.join(record.worktreePath, ".next", "standalone", "generated.txt"), "generated")

      await lifecycle.runValidationCommands(record)

      expect(nextOutputPresentDuringBuild).toBe(false)
      expect(fs.existsSync(path.join(record.worktreePath, ".next"))).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("refuses generated-output cleanup when the recorded worktree root becomes a junction", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-next-junction-wall-"))
    const workspaceRoot = path.join(tempRoot, "repository")
    const worktreeRoot = path.join(tempRoot, "worktrees")
    const foreignRoot = path.join(tempRoot, "foreign")
    let worktreePath = ""
    let buildInvoked = false
    try {
      const lifecycle = createRepositoryLifecycle({
        workspaceRoot,
        repositoryRoot: workspaceRoot,
        ownedWorktreeRoot: worktreeRoot,
        validationCommands: [{ command: "npm", args: ["run", "build"] }],
        runner: async ({ command, args }: Call) => {
          if (args.includes("remote") && args.includes("get-url")) {
            return { code: 0, stdout: "https://github.com/bsvalues/terragroq.git\n" }
          }
          if (args.includes("show-ref")) return { code: 1, stdout: "" }
          if (command === "npm" && args[0] === "run" && args[1] === "build") buildInvoked = true
          return { code: 0, stdout: "" }
        },
      })
      const record = await lifecycle.createWorktree({ branch })
      worktreePath = record.worktreePath
      fs.mkdirSync(foreignRoot, { recursive: true })
      fs.mkdirSync(path.dirname(record.worktreePath), { recursive: true })
      fs.symlinkSync(foreignRoot, record.worktreePath, "junction")

      await expect(lifecycle.runValidationCommands(record)).rejects.toMatchObject({
        code: "HERMES_REPOSITORY_CLEANUP_WALL",
      })
      expect(buildInvoked).toBe(false)
    } finally {
      if (worktreePath && fs.lstatSync(worktreePath, { throwIfNoEntry: false })?.isSymbolicLink()) {
        fs.unlinkSync(worktreePath)
      }
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("removes the owned validation dependency junction before agent work resumes", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-validation-deps-"))
    const workspaceRoot = path.join(tempRoot, "repository")
    const worktreeRoot = path.join(tempRoot, "worktrees")
    fs.mkdirSync(path.join(workspaceRoot, "node_modules"), { recursive: true })
    try {
      const lifecycle = createRepositoryLifecycle({
        workspaceRoot,
        repositoryRoot: workspaceRoot,
        ownedWorktreeRoot: worktreeRoot,
        runner: async ({ args }: Call) => {
          if (args.includes("remote") && args.includes("get-url")) {
            return { code: 0, stdout: "https://github.com/bsvalues/terragroq.git\n" }
          }
          if (args.includes("show-ref")) return { code: 1, stdout: "" }
          if (args.includes("rev-parse")) return { code: 0, stdout: `${sha}\n` }
          return { code: 0, stdout: "" }
        },
      })
      const record = await lifecycle.createWorktree({ branch })
      fs.mkdirSync(record.worktreePath, { recursive: true })
      expect(lifecycle.ensureValidationDependencies(record)).toEqual({ linked: true, existing: false })
      expect(fs.realpathSync(path.join(record.worktreePath, "node_modules")))
        .toBe(fs.realpathSync(path.join(workspaceRoot, "node_modules")))
      expect(lifecycle.removeValidationDependencies(record)).toEqual({ removed: true })
      expect(fs.existsSync(path.join(record.worktreePath, "node_modules"))).toBe(false)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it("returns bounded secret-screened validator evidence for Codex remediation", async () => {
    const { lifecycle, record } = await ownedFixture({
      npm: () => ({ code: 1, stdout: "", stderr: "tests/radar.test.ts: expected READY but received BLOCKED" }),
    })
    await expect(lifecycle.runValidationCommands({ ...record })).rejects.toMatchObject({
      code: "HERMES_VALIDATION_FAILED",
      validation: expect.objectContaining({ code: 1, output: expect.stringContaining("expected READY") }),
    })
  })

  it("refuses credential-bearing connection URLs in validator evidence", async () => {
    for (const connectionUrl of [
      "postgresql://owner:credential@database.invalid/app",
      "redis://:credential@cache.invalid/0",
    ]) {
      const { lifecycle, record } = await ownedFixture({
        npm: () => ({ code: 1, stdout: "", stderr: connectionUrl }),
      })
      await expect(lifecycle.runValidationCommands({ ...record })).rejects.toMatchObject({
        code: "HERMES_REPOSITORY_SECRET_WALL",
      })
    }
  })

  it("returns the latest active comment without making a resolution-policy guess", async () => {
    const { lifecycle } = fixture({
      "gh api graphql": () => ({
        code: 0,
        stdout: JSON.stringify(reviewState([{
          id: "PRRT_security", isResolved: false, isOutdated: true,
          path: "scripts/hermes-bridge/orchestrator.mjs", line: 42,
          comments: { nodes: [
            { body: "Preserve the authority boundary before merge.", isMinimized: false },
            { body: "Fixed in the latest commit.", isMinimized: false },
          ] },
        }])),
      }),
    })
    await expect(lifecycle.inspectReviewFindings(77)).resolves.toEqual([
      expect.objectContaining({
        threadId: "PRRT_security", isOutdated: true,
        body: "Fixed in the latest commit.",
      }),
    ])
    expect((await lifecycle.inspectReviewFindings(77))[0]).not.toHaveProperty("requiresExplicitResolution")
  })

  it("verifies immutable commit ancestry without accepting a non-ancestor", async () => {
    const ancestor = "c".repeat(40)
    const descendant = "d".repeat(40)
    const { lifecycle, calls } = fixture({
      [`${rootGit} merge-base --is-ancestor ${ancestor} ${descendant}`]: () => ({
        code: 1,
        stdout: "",
      }),
    })
    await expect(lifecycle.verifyCommitAncestor(ancestor, descendant)).resolves.toBe(false)
    expect(calls.some(({ args }) => JSON.stringify(args) === JSON.stringify([
      "-C", root, "merge-base", "--is-ancestor", ancestor, descendant,
    ]))).toBe(true)
  })

  it("extracts only immutable owner-pinned remediation proof from resolved review findings", async () => {
    const findingAt = "2026-07-27T20:00:00.000Z"
    const proofAt = "2026-07-27T20:05:00.000Z"
    const filesDigest = "c".repeat(64)
    const { lifecycle } = fixture({
      "gh api graphql": () => ({
        code: 0,
        stdout: JSON.stringify(reviewState([{
          id: "PRRT_review",
          isResolved: true,
          comments: {
            nodes: [
              {
                author: { login: "chatgpt-codex-connector" },
                body: "Fix the decision projection.",
                isMinimized: false,
                createdAt: findingAt,
                updatedAt: findingAt,
              },
              {
                author: { login: "bsvalues" },
                body: `HERMES_REVIEW_REMEDIATION_PROOF v2 pr=466 head=${sha} merge=${mergeSha} files=${filesDigest}`,
                isMinimized: false,
                createdAt: proofAt,
                updatedAt: proofAt,
              },
            ],
            pageInfo: { hasPreviousPage: false },
          },
        }])),
      }),
    })
    await expect(lifecycle.inspectReviewRemediationClaims(77)).resolves.toEqual([{
      threadIds: ["PRRT_review"],
      prNumber: 466,
      headRefOid: sha,
      mergeSha,
      filesDigest,
    }])
  })

  it("rejects any unproved or incompletely paginated post-merge review finding", async () => {
    const finding = {
      author: { login: "chatgpt-codex-connector" },
      body: "Post-merge defect.",
      isMinimized: false,
      createdAt: "2026-07-27T20:00:00.000Z",
      updatedAt: "2026-07-27T20:00:00.000Z",
    }
    const missingProof = fixture({
      "gh api graphql": () => ({
        code: 0,
        stdout: JSON.stringify(reviewState([{
          id: "PRRT_unproved",
          isResolved: true,
          comments: {
            nodes: [finding],
            pageInfo: { hasPreviousPage: false, hasNextPage: false },
          },
        }])),
      }),
    })
    await expect(missingProof.lifecycle.inspectReviewRemediationClaims(77))
      .rejects.toMatchObject({ code: "HERMES_REPOSITORY_REVIEW_WALL" })

    const paginated = fixture({
      "gh api graphql": () => ({
        code: 0,
        stdout: JSON.stringify(reviewState([{
          id: "PRRT_paginated",
          isResolved: true,
          comments: {
            nodes: [finding],
            pageInfo: { hasPreviousPage: false, hasNextPage: true },
          },
        }])),
      }),
    })
    await expect(paginated.lifecycle.inspectReviewRemediationClaims(77))
      .rejects.toMatchObject({ code: "HERMES_REPOSITORY_GITHUB_WALL" })
  })

  it("rejects incomplete review-thread comment history", async () => {
    const { lifecycle } = fixture({
      "gh api graphql": () => ({
        code: 0,
        stdout: JSON.stringify(reviewState([{
          id: "PRRT_long", isResolved: false, isOutdated: false,
          path: "scripts/hermes-bridge/orchestrator.mjs", line: 42,
          comments: {
            nodes: [{ body: "Potentially stale finding.", isMinimized: false }],
            pageInfo: { hasPreviousPage: true },
          },
        }])),
      }),
    })
    await expect(lifecycle.inspectReviewFindings(77)).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_GITHUB_WALL",
    })
  })

  it("commits exactly the owned working-tree paths and requests exact-head Codex review", async () => {
    const changed = ["components/dashboard/radar.tsx", "tests/radar.test.ts"]
    const { lifecycle, calls, record } = await ownedFixture({
      [`${ownedGit} status`]: () => ({ code: 0, stdout: changed.map((item) => ` M ${item}\0`).join("") }),
      [`${ownedGit} diff --cached --quiet`]: () => ({ code: 1, stdout: "" }),
      [`${ownedGit} rev-parse HEAD`]: () => ({ code: 0, stdout: `${sha}\n` }),
    })
    await expect(lifecycle.commitChanges({
      ...record, paths: changed, message: "feat(williamos): deliver goal-77",
    })).resolves.toEqual({ branch, commit: sha, paths: changed })
    expect(calls.some(({ args }) => JSON.stringify(args) === JSON.stringify([
      "-C", ownedWorktree, "add", "--", ...changed,
    ]))).toBe(true)
    await lifecycle.requestCodexReview({ number: 77, headRefOid: sha })
    expect(calls.at(-1)?.args).toEqual([
      "pr", "comment", "77", "--repo", "bsvalues/terragroq", "--body",
      `@codex review Exact-head review requested for ${sha}.`,
    ])
  })

  it("discovers an exact-head PR and creates only when absent", async () => {
    const existing = { number: 77, headRefName: branch, state: "OPEN", url: "https://github.test/pr/77" }
    const present = fixture({
      "gh pr list": () => ({ code: 0, stdout: JSON.stringify([{ ...existing }, { number: 1, headRefName: "codex/other" }]) }),
    })
    await expect(present.lifecycle.createPullRequest({ branch, title: "feat: goal", body: "Bounded change." }))
      .resolves.toEqual({ ...existing, created: false })
    expect(present.calls.some(({ args }) => args[0] === "pr" && args[1] === "create")).toBe(false)

    const absent = fixture({
      "gh pr list": () => ({ code: 0, stdout: "[]" }),
      "gh pr create": () => ({ code: 0, stdout: "https://github.test/pr/78\n" }),
    })
    await expect(absent.lifecycle.createPullRequest({ branch, title: "feat: goal", body: "Bounded change." }))
      .resolves.toMatchObject({ created: true, branch, url: "https://github.test/pr/78" })
    expect(absent.calls.at(-1)?.args).toEqual([
      "pr", "create", "--repo", "bsvalues/terragroq", "--head", branch, "--base", "main",
      "--title", "feat: goal", "--body", "Bounded change.",
    ])
  })

  it("adopts only a persisted worktree intent that exactly matches registered git state", async () => {
    const { lifecycle } = fixture({
      [`${rootGit} worktree list`]: () => ({
        code: 0, stdout: `worktree ${ownedWorktree.replace(/\\/g, "/")}\nHEAD ${sha}\nbranch refs/heads/${branch}\n\n`,
      }),
      [`${ownedGit} branch --show-current`]: () => ({ code: 0, stdout: `${branch}\n` }),
    })
    await expect(lifecycle.ensureOwnedWorktree({
      branch, name: "hermes-goal-77", worktreePath: ownedWorktree,
    })).resolves.toMatchObject({ branch, worktreePath: ownedWorktree, resumed: true })
    await expect(lifecycle.ensureOwnedWorktree({
      branch, name: "hermes-goal-other", worktreePath: path.join(ownedRoot, "hermes-goal-other"),
    })).rejects.toMatchObject({ code: "HERMES_REPOSITORY_OWNERSHIP_WALL" })
  })

  it("reads bounded immutable PR file pages without requiring gh --slurp", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `components/hermes/file-${String(index).padStart(3, "0")}.tsx`,
      ...(index === 0 ? { previous_filename: "lib/auth/old-status.tsx" } : {}),
    }))
    const { lifecycle, calls } = fixture({
      "gh api --paginate --slurp": () => ({ code: 1, stderr: "unknown flag: --slurp" }),
      "gh api repos/bsvalues/terragroq/pulls/77": (call) => {
        const endpoint = call.args.at(-1) ?? ""
        return { code: 0, stdout: JSON.stringify(endpoint.includes("/files?")
          ? endpoint.endsWith("page=1") ? firstPage : [{ filename: "tests/hermes-status.test.tsx" }]
          : { changed_files: 101, head: { sha } }) }
      },
    })
    const files = await lifecycle.inspectPullRequestFiles(77)
    expect(files).toHaveLength(102)
    expect(files).toEqual(expect.arrayContaining([
      "components/hermes/file-000.tsx", "lib/auth/old-status.tsx", "tests/hermes-status.test.tsx",
    ]))
    const fileCalls = calls.filter(({ args }) => args.at(-1)?.includes("/pulls/77/files?"))
    expect(fileCalls.map(({ args }) => args)).toEqual([
      ["api", "repos/bsvalues/terragroq/pulls/77/files?per_page=100&page=1"],
      ["api", "repos/bsvalues/terragroq/pulls/77/files?per_page=100&page=2"],
    ])
    expect(calls.some(({ args }) => args.includes("--slurp"))).toBe(false)
    expect(calls.filter(({ args }) => args.at(-1) === "repos/bsvalues/terragroq/pulls/77")).toHaveLength(2)
  })

  it("fails closed on malformed, short, oversized, or duplicate PR file pages", async () => {
    for (const { changedFiles, response } of [
      { changedFiles: 1, response: { files: "not-an-array" } },
      { changedFiles: 2, response: [{ filename: "components/valid.tsx" }, null] },
      { changedFiles: 1, response: [{ previous_filename: "components/old.tsx" }] },
      { changedFiles: 100, response: Array.from({ length: 99 }, (_, index) => ({ filename: `components/short-${index}.tsx` })) },
      { changedFiles: 100, response: Array.from({ length: 101 }, (_, index) => ({ filename: `components/long-${index}.tsx` })) },
      { changedFiles: 2, response: [{ filename: "components/duplicate.tsx" }, { filename: "components/duplicate.tsx" }] },
    ]) {
      const { lifecycle } = fixture({
        "gh api repos/bsvalues/terragroq/pulls/77": (call) => ({ code: 0, stdout: JSON.stringify(
          call.args.at(-1)?.includes("/files?") ? response : { changed_files: changedFiles, head: { sha } },
        ) }),
      })
      await expect(lifecycle.inspectPullRequestFiles(77)).rejects.toMatchObject({
        code: "HERMES_REPOSITORY_GITHUB_WALL",
      })
    }
  })

  it("rejects invalid PR file metadata before reading pages", async () => {
    for (const metadata of [
      { changed_files: 0, head: { sha } },
      { changed_files: 3_001, head: { sha } },
      { changed_files: 1.5, head: { sha } },
      { changed_files: 1, head: { sha: "not-a-commit" } },
      { changed_files: 1 },
    ]) {
      const { lifecycle, calls } = fixture({
        "gh api repos/bsvalues/terragroq/pulls/77": () => ({
          code: 0, stdout: JSON.stringify(metadata),
        }),
      })
      await expect(lifecycle.inspectPullRequestFiles(77)).rejects.toMatchObject({
        code: "HERMES_REPOSITORY_GITHUB_WALL",
      })
      expect(calls.some(({ args }) => args.at(-1)?.includes("/files?"))).toBe(false)
    }
  })

  it("rejects PR file metadata head or count drift", async () => {
    for (const postMetadata of [
      { changed_files: 1, head: { sha: "b".repeat(40) } },
      { changed_files: 2, head: { sha } },
    ]) {
      let metadataReads = 0
      const { lifecycle } = fixture({
        "gh api repos/bsvalues/terragroq/pulls/77": (call) => {
          if (call.args.at(-1)?.includes("/files?")) {
            return { code: 0, stdout: JSON.stringify([{ filename: "components/stable.tsx" }]) }
          }
          metadataReads += 1
          return { code: 0, stdout: JSON.stringify(metadataReads === 1
            ? { changed_files: 1, head: { sha } }
            : postMetadata) }
        },
      })
      await expect(lifecycle.inspectPullRequestFiles(77)).rejects.toMatchObject({
        code: "HERMES_REPOSITORY_GITHUB_WALL",
      })
    }
  })

  it("accepts exactly three thousand PR files in thirty pages with no page thirty-one", async () => {
    const { lifecycle, calls } = fixture({
      "gh api repos/bsvalues/terragroq/pulls/77": (call) => {
        const endpoint = call.args.at(-1) ?? ""
        if (!endpoint.includes("/files?")) {
          return { code: 0, stdout: JSON.stringify({ changed_files: 3_000, head: { sha } }) }
        }
        const page = Number(new URL(`https://github.invalid/${endpoint}`).searchParams.get("page"))
        return {
          code: 0,
          stdout: JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
            filename: `components/page-${page}-file-${index}.tsx`,
          }))),
        }
      },
    })
    await expect(lifecycle.inspectPullRequestFiles(77)).resolves.toHaveLength(3_000)
    const fileCalls = calls.filter(({ args }) => args.at(-1)?.includes("/pulls/77/files?"))
    expect(fileCalls).toHaveLength(30)
    expect(fileCalls.at(-1)?.args.at(-1)).toContain("page=30")
    expect(fileCalls.some(({ args }) => args.at(-1)?.includes("page=31"))).toBe(false)
  })

  it("pushes an exact refspec and merges only an approved green PR with no unresolved threads", async () => {
    const pr = {
      number: 77,
      headRefName: branch,
      headRefOid: sha,
      baseRefName: "main",
      state: "OPEN",
      isDraft: false,
      reviewDecision: "APPROVED",
      statusCheckRollup: [{ conclusion: "SUCCESS" }, { state: "SUCCESS" }],
      reviews: [{ author: { login: "independent-reviewer" }, state: "APPROVED", commit: { oid: sha } }],
    }
    const { lifecycle, calls, record } = await ownedFixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify(pr) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await lifecycle.pushBranch(record)
    expect(calls.at(-1)?.args).toEqual([
      "-C", record.worktreePath, "push", "--set-upstream", "origin",
      `refs/heads/${branch}:refs/heads/${branch}`,
    ])
    await expect(lifecycle.mergePullRequest({ number: 77, branch })).resolves.toMatchObject({ merged: true })
    expect(calls.at(-1)?.args).toEqual([
      "pr", "merge", "77", "--repo", "bsvalues/terragroq", "--squash", "--delete-branch=false",
      "--match-head-commit", sha,
    ])
    expect(JSON.stringify(calls)).not.toMatch(/authorization|credential|ghp_|github_pat_/i)
  })

  it("rejects merge when checks, approval, or substantive review threads are unresolved", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [{ conclusion: "FAILURE" }],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState([
        { isResolved: false, comments: { nodes: [{ body: "Fix this", isMinimized: false }] } },
      ])) }),
    })
    await expect(lifecycle.mergePullRequest({ number: 77, branch })).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_MERGE_GATE_WALL",
    })
  })

  it("reports completed red checks as bounded remediation evidence", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "OPEN", isDraft: false,
        reviewDecision: "APPROVED", statusCheckRollup: [
          { context: "Vercel", state: "FAILURE" },
          { context: "Unit tests", state: "SUCCESS" },
        ],
        reviews: [{ author: { login: "independent-reviewer" }, state: "APPROVED", commit: { oid: sha } }],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      checksGreen: false,
      checksComplete: true,
      failedChecks: [{ name: "Vercel", state: "FAILURE" }],
    })
  })

  it("uses the latest completed run for one named check context", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "MERGED", isDraft: false,
        reviewDecision: "", statusCheckRollup: [
          {
            __typename: "CheckRun", name: "work context receipt (#831)", status: "COMPLETED",
            workflowName: "work context receipt (#831)", conclusion: "CANCELLED",
            startedAt: "2026-08-21T00:10:00Z", completedAt: "2026-08-21T00:30:00Z",
          },
          {
            __typename: "CheckRun", name: "work context receipt (#831)", status: "COMPLETED",
            workflowName: "work context receipt (#831)", conclusion: "SUCCESS",
            startedAt: "2026-08-21T00:20:00Z", completedAt: "2026-08-21T00:21:00Z",
          },
        ],
        reviews: [{ author: { login: "independent-reviewer" }, state: "APPROVED", commit: { oid: sha } }],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      checksGreen: true, checksComplete: true, failedChecks: [], pendingChecks: [],
    })
  })

  it("preserves a genuine latest cancellation and a distinct failing context", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "MERGED", isDraft: false,
        reviewDecision: "", statusCheckRollup: [
          { __typename: "CheckRun", workflowName: "receipt workflow", name: "receipt", conclusion: "SUCCESS", startedAt: "2026-08-21T00:11:00Z" },
          { __typename: "CheckRun", workflowName: "receipt workflow", name: "receipt", conclusion: "CANCELLED", startedAt: "2026-08-21T00:21:00Z" },
          { __typename: "CheckRun", workflowName: "test workflow", name: "unit tests", conclusion: "FAILURE", startedAt: "2026-08-21T00:22:00Z" },
        ], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      checksGreen: false,
      failedChecks: [
        { name: "receipt", state: "CANCELLED" },
        { name: "unit tests", state: "FAILURE" },
      ],
    })
  })

  it("keeps same-named checks from different workflows distinct", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "OPEN", isDraft: false,
        statusCheckRollup: [
          { __typename: "CheckRun", workflowName: "receipt workflow", name: "verify", conclusion: "FAILURE", startedAt: "2026-08-21T00:11:00Z" },
          { __typename: "CheckRun", workflowName: "unit workflow", name: "verify", conclusion: "SUCCESS", startedAt: "2026-08-21T00:21:00Z" },
        ], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      checksGreen: false,
      failedChecks: [{ name: "verify", state: "FAILURE" }],
      pendingChecks: [],
    })
  })

  it("does not collapse checks whose exact workflow identity differs only by whitespace", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "OPEN", isDraft: false,
        statusCheckRollup: [
          { __typename: "CheckRun", workflowName: "receipt workflow", name: "verify", status: "IN_PROGRESS", startedAt: "2026-08-21T00:11:00Z" },
          { __typename: "CheckRun", workflowName: "receipt workflow ", name: "verify", conclusion: "SUCCESS", startedAt: "2026-08-21T00:21:00Z" },
        ], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      checksGreen: false, checksComplete: false,
      failedChecks: [], pendingChecks: [{ name: "verify", state: "IN_PROGRESS" }],
    })
  })

  it("fails closed without a CheckRun workflow identity", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "OPEN", isDraft: false,
        statusCheckRollup: [
          { __typename: "CheckRun", name: "verify", conclusion: "CANCELLED", startedAt: "2026-08-21T00:11:00Z" },
          { __typename: "CheckRun", name: "verify", conclusion: "SUCCESS", startedAt: "2026-08-21T00:21:00Z" },
        ], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      checksGreen: false,
      failedChecks: [{ name: "verify", state: "CANCELLED" }],
    })
  })

  it("preserves the latest pending run and StatusContext ordering", async () => {
    const pending = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "OPEN", isDraft: false,
        statusCheckRollup: [
          { __typename: "CheckRun", workflowName: "receipt workflow", name: "receipt", conclusion: "SUCCESS", startedAt: "2026-08-21T00:11:00Z" },
          { __typename: "CheckRun", workflowName: "receipt workflow", name: "receipt", status: "IN_PROGRESS", startedAt: "2026-08-21T00:21:00Z" },
        ], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(pending.lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      checksGreen: false, checksComplete: false,
      failedChecks: [], pendingChecks: [{ name: "receipt", state: "IN_PROGRESS" }],
    })

    const statusContext = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "OPEN", isDraft: false,
        statusCheckRollup: [
          { __typename: "StatusContext", context: "Vercel", state: "FAILURE", startedAt: "2026-08-21T00:11:00Z" },
          { __typename: "StatusContext", context: "Vercel", state: "SUCCESS", startedAt: "2026-08-21T00:21:00Z" },
        ], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(statusContext.lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      checksGreen: true, failedChecks: [], pendingChecks: [],
    })
  })

  it("fails closed when duplicate check ordering is unavailable or ambiguous", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "MERGED", isDraft: false,
        statusCheckRollup: [
          { __typename: "CheckRun", workflowName: "receipt workflow", name: "receipt", conclusion: "CANCELLED" },
          { __typename: "CheckRun", workflowName: "receipt workflow", name: "receipt", conclusion: "SUCCESS" },
        ], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_GITHUB_WALL",
    })

    const tied = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "MERGED", isDraft: false,
        statusCheckRollup: [
          { __typename: "CheckRun", workflowName: "receipt workflow", name: "receipt", conclusion: "CANCELLED", startedAt: "2026-08-21T00:11:00Z" },
          { __typename: "CheckRun", workflowName: "receipt workflow", name: "receipt", conclusion: "SUCCESS", startedAt: "2026-08-21T00:11:00Z" },
        ], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(tied.lifecycle.inspectPullRequest(77)).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_GITHUB_WALL",
    })
  })

  it("does not accept a stale approval through reviewDecision", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        reviewDecision: "APPROVED", statusCheckRollup: [{ conclusion: "SUCCESS" }],
        reviews: [{ author: { login: "independent-reviewer" }, state: "APPROVED", commit: { oid: mergeSha } }],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({ reviewed: false })
  })

  it("recognizes a successful CodeRabbit check as independent review evidence", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        reviewDecision: "", statusCheckRollup: [
          { context: "CodeRabbit", state: "SUCCESS" },
          { context: "Vercel", state: "SUCCESS" },
        ],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({ reviewed: true, checksGreen: true })
  })

  it("does not accept a green-but-rate-limited CodeRabbit context without exact-head review", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "OPEN", isDraft: false,
        reviewDecision: "", statusCheckRollup: [
          { context: "CodeRabbit", state: "SUCCESS" },
          { context: "Vercel", state: "SUCCESS" },
        ], reviews: [],
      }) }),
      "gh api repos/bsvalues/terragroq/commits/": () => ({ code: 0, stdout: JSON.stringify({
        statuses: [{ context: "CodeRabbit", state: "success", description: "Review rate limited" }],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      reviewed: false, checksGreen: false, codeRabbitRateLimited: true,
    })
  })

  it("does not treat a skipped CodeRabbit check as review evidence", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        reviewDecision: "", statusCheckRollup: [
          { context: "CodeRabbit", state: "SKIPPED" }, { context: "Vercel", state: "SUCCESS" },
        ], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({ reviewed: false, checksGreen: true })
  })

  it("accepts only an immutable Codex-authored clean comment pinned to the current head", async () => {
    const request = (digest: string, updatedAt = "2026-07-21T09:59:00.000Z") => ({
      author: { login: "bsvalues" }, body: `Final head ${digest}. @codex review`,
      createdAt: "2026-07-21T09:59:00.000Z", updatedAt,
    })
    const clean = (digest: string, updatedAt = "2026-07-21T10:00:00.000Z", author = "chatgpt-codex-connector") => ({
      author: { login: author },
      body: `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${digest}\``,
      createdAt: "2026-07-21T10:00:00.000Z", updatedAt,
    })
    const create = (comments: unknown[]) => fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        reviewDecision: "", statusCheckRollup: [{ context: "Vercel", state: "SUCCESS" }], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState([], comments)) }),
    }).lifecycle
    await expect(create([request(sha), clean(sha.slice(0, 10))]).inspectPullRequest(77))
      .resolves.toMatchObject({ reviewed: true, reviewCompleted: true })
    await expect(create([request(sha), clean(mergeSha.slice(0, 10))]).inspectPullRequest(77))
      .resolves.toMatchObject({ reviewed: false })
    await expect(create([request(sha), clean(sha.slice(0, 10), "2026-07-21T10:02:00.000Z")]).inspectPullRequest(77))
      .resolves.toMatchObject({ reviewed: false })
    await expect(create([request(sha), clean(sha.slice(0, 10), undefined, "bsvalues")]).inspectPullRequest(77))
      .resolves.toMatchObject({ reviewed: false })
    await expect(create([request(sha.slice(0, 10)), clean(sha.slice(0, 10))]).inspectPullRequest(77))
      .resolves.toMatchObject({ reviewed: false })
    await expect(create([request(sha, "2026-07-21T10:02:00.000Z"), clean(sha.slice(0, 10))]).inspectPullRequest(77))
      .resolves.toMatchObject({ reviewed: false })
    const paginated = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        statusCheckRollup: [{ context: "Vercel", state: "SUCCESS" }], reviews: [],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState([], [request(sha), clean(sha.slice(0, 10))], true)) }),
    }).lifecycle
    await expect(paginated.inspectPullRequest(77)).rejects.toMatchObject({ code: "HERMES_REPOSITORY_GITHUB_WALL" })
  })

  it("accepts exact-head Codex boilerplate only when no summary or inline finding remains", async () => {
    const create = (threads: unknown[]) => fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "OPEN", isDraft: false,
        reviewDecision: "", statusCheckRollup: [{ context: "Vercel", state: "SUCCESS" }],
        reviews: [{
          author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", commit: { oid: sha },
          body: `### Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\`\n\n<details>About Codex</details>`,
        }],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState(threads)) }),
    }).lifecycle
    await expect(create([]).inspectPullRequest(77)).resolves.toMatchObject({
      reviewCompleted: true, reviewed: true, codexReviewFindings: [],
    })
    await expect(create([{ isResolved: false, comments: { nodes: [{ body: "Finding", isMinimized: false }] } }])
      .inspectPullRequest(77)).resolves.toMatchObject({ reviewCompleted: true, reviewed: false })
  })

  it("returns substantive exact-head Codex review summaries as remediation findings", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, baseRefName: "main", state: "OPEN", isDraft: false,
        statusCheckRollup: [{ context: "Vercel", state: "SUCCESS" }],
        reviews: [{
          author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", commit: { oid: sha },
          body: `### Codex Review\n\nPreserve the authority predicate before merge.\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``,
        }],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      reviewed: false,
      reviewCompleted: true,
      codexReviewFindings: ["Preserve the authority predicate before merge."],
    })
  })

  it("accepts an explicit CodeRabbit rate-limit only with clean exact-head review evidence", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        reviewDecision: "", statusCheckRollup: [
          { context: "CodeRabbit", state: "FAILURE" },
          { context: "Vercel", state: "SUCCESS" },
        ],
        reviews: [],
      }) }),
      "gh api repos/bsvalues/terragroq/commits/": () => ({ code: 0, stdout: JSON.stringify({
        statuses: [{ context: "CodeRabbit", state: "failure", description: "Review rate limited" }],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState([], [{
        author: { login: "bsvalues" }, body: `Final head ${sha}. @codex review`,
        createdAt: "2026-07-21T09:59:00.000Z", updatedAt: "2026-07-21T09:59:00.000Z",
      }, {
        author: { login: "chatgpt-codex-connector" },
        body: `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``,
        createdAt: "2026-07-21T10:00:00.000Z", updatedAt: "2026-07-21T10:00:00.000Z",
      }])) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      reviewed: true, checksGreen: true, codeRabbitRateLimited: true,
    })
  })

  it("rejects a CodeRabbit failure when the alternate Codex review is stale", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        reviewDecision: "", statusCheckRollup: [
          { context: "CodeRabbit", state: "FAILURE" },
          { context: "Vercel", state: "SUCCESS" },
        ],
        reviews: [{
          author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", commit: { oid: mergeSha },
        }],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({
      reviewed: false, checksGreen: false, codeRabbitRateLimited: false,
    })
  })

  it("does not count a current-head Codex commented review as clean evidence", async () => {
    const { lifecycle } = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        reviewDecision: "", statusCheckRollup: [{ context: "Vercel", state: "SUCCESS" }],
        reviews: [{ author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", commit: { oid: sha } }],
      }) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify(reviewState()) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({ reviewed: false })
  })

  it("does not exempt inexact rate-limit descriptions or separate CodeRabbit failures", async () => {
    const exactHeadReview = [{
      author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", commit: { oid: sha },
    }]
    const threads = () => ({ code: 0, stdout: JSON.stringify(reviewState()) })
    const inexact = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        reviewDecision: "", statusCheckRollup: [{ context: "CodeRabbit", state: "FAILURE" }], reviews: exactHeadReview,
      }) }),
      "gh api repos/bsvalues/terragroq/commits/": () => ({ code: 0, stdout: JSON.stringify({
        statuses: [{ context: "CodeRabbit", state: "failure", description: "Review rate limited after provider error" }],
      }) }),
      "gh api graphql": threads,
    })
    await expect(inexact.lifecycle.inspectPullRequest(77)).resolves.toMatchObject({ checksGreen: false })

    const separateFailure = fixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify({
        number: 77, headRefName: branch, headRefOid: sha, state: "OPEN", isDraft: false,
        reviewDecision: "", statusCheckRollup: [
          { context: "CodeRabbit", state: "FAILURE" },
          { name: "CodeRabbit security", conclusion: "FAILURE" },
          { context: "Vercel", state: "SUCCESS" },
        ], reviews: exactHeadReview,
      }) }),
      "gh api repos/bsvalues/terragroq/commits/": () => ({ code: 0, stdout: JSON.stringify({
        statuses: [{ context: "CodeRabbit", state: "failure", description: "Review rate limited" }],
      }) }),
      "gh api graphql": threads,
    })
    await expect(separateFailure.lifecycle.inspectPullRequest(77)).resolves.toMatchObject({ checksGreen: false })
  })

  it("verifies origin/main and cleans only a recorded, clean, merged worktree once", async () => {
    const { lifecycle, calls, record } = await ownedFixture({
      [`${rootGit} merge-base`]: () => ({ code: 0 }),
      [`${ownedGit} status`]: () => ({ code: 0, stdout: "" }),
    })
    const first = await lifecycle.cleanupOwnedWorktree({ ...record, mergeCommitSha: mergeSha, expectedHeadSha: sha })
    const second = await lifecycle.cleanupOwnedWorktree({ ...record, mergeCommitSha: mergeSha, expectedHeadSha: sha })
    expect(first).toMatchObject({ cleaned: true, alreadyCleaned: false })
    expect(second).toMatchObject({ cleaned: true, alreadyCleaned: true })
    expect(calls.filter(({ args }) => args.includes("remove"))).toHaveLength(1)
    expect(calls.filter(({ args }) => args.includes("update-ref"))).toHaveLength(1)
  })

  it("cleans a reviewed branch whose authoritative remote head fast-forwards the clean owned worktree head", async () => {
    const reviewedHead = "c".repeat(40)
    const { lifecycle, calls, record } = await ownedFixture({
      [`${rootGit} ls-remote --heads origin refs/heads/${branch}`]: () => ({
        code: 0,
        stdout: `${reviewedHead}\trefs/heads/${branch}\n`,
      }),
      [`${ownedGit} rev-parse HEAD`]: () => ({ code: 0, stdout: `${sha}\n` }),
      [`${rootGit} fetch --no-tags origin refs/heads/${branch}`]: () => ({ code: 0 }),
      [`${rootGit} rev-parse FETCH_HEAD`]: () => ({ code: 0, stdout: `${reviewedHead}\n` }),
      [`${rootGit} merge-base --is-ancestor ${sha} ${reviewedHead}`]: () => ({ code: 0 }),
      [`${rootGit} merge-base`]: () => ({ code: 0 }),
      [`${ownedGit} status`]: () => ({ code: 0, stdout: "" }),
    })

    await expect(lifecycle.cleanupOwnedWorktree({
      ...record,
      mergeCommitSha: mergeSha,
      expectedHeadSha: reviewedHead,
    })).resolves.toMatchObject({ cleaned: true, alreadyCleaned: false })

    const cleanupCalls = calls.map(({ command, args }) => `${command} ${args.join(" ")}`)
    const remoteIndex = cleanupCalls.indexOf(`${rootGit} ls-remote --heads origin refs/heads/${branch}`)
    const statusIndex = cleanupCalls.indexOf(`${ownedGit} status --porcelain=v1 -z --untracked-files=all`)
    const removeIndex = cleanupCalls.indexOf(`${rootGit} worktree remove ${ownedWorktree}`)
    const deleteIndex = cleanupCalls.indexOf(`${rootGit} update-ref -d refs/heads/${branch} ${sha}`)
    expect(remoteIndex).toBeGreaterThanOrEqual(0)
    expect(statusIndex).toBeGreaterThan(remoteIndex)
    expect(removeIndex).toBeGreaterThan(statusIndex)
    expect(deleteIndex).toBeGreaterThan(removeIndex)
    expect(cleanupCalls).not.toContain(`${rootGit} update-ref -d refs/heads/${branch} ${reviewedHead}`)
  })

  it("replays partial cleanup by deleting only the observed ancestor branch ref", async () => {
    const reviewedHead = "c".repeat(40)
    let worktreeReads = 0
    const { lifecycle, calls } = fixture({
      [`${rootGit} worktree list --porcelain`]: () => {
        worktreeReads += 1
        return { code: 0, stdout: "" }
      },
      [`${rootGit} show-ref --verify --quiet refs/heads/${branch}`]: () => ({ code: 0 }),
      [`${rootGit} rev-parse refs/heads/${branch}`]: () => ({ code: 0, stdout: `${sha}\n` }),
      [`${rootGit} ls-remote --heads origin refs/heads/${branch}`]: () => ({
        code: 0,
        stdout: `${reviewedHead}\trefs/heads/${branch}\n`,
      }),
      [`${rootGit} fetch --no-tags origin refs/heads/${branch}`]: () => ({ code: 0 }),
      [`${rootGit} rev-parse FETCH_HEAD`]: () => ({ code: 0, stdout: `${reviewedHead}\n` }),
      [`${rootGit} merge-base --is-ancestor ${sha} ${reviewedHead}`]: () => ({ code: 0 }),
      [`${rootGit} merge-base`]: () => ({ code: 0 }),
    })

    await expect(lifecycle.cleanupOwnedWorktree({
      branch,
      worktreePath: ownedWorktree,
      mergeCommitSha: mergeSha,
      expectedHeadSha: reviewedHead,
    })).resolves.toMatchObject({ cleaned: true, alreadyCleaned: true })

    expect(worktreeReads).toBe(2)
    expect(calls).toContainEqual(expect.objectContaining({
      command: "git",
      args: ["-C", root, "update-ref", "-d", `refs/heads/${branch}`, sha],
    }))
    expect(calls.some(({ args }) => args.includes("remove"))).toBe(false)
  })

  it.each([
    ["a mismatched authoritative remote", `${"d".repeat(40)}\trefs/heads/${branch}\n`, 0],
    ["duplicate authoritative remote rows", `${sha}\trefs/heads/${branch}\n${sha}\trefs/heads/${branch}\n`, 0],
    ["a divergent local branch", `${"c".repeat(40)}\trefs/heads/${branch}\n`, 1],
  ])("walls before cleanup effects for %s", async (_label, remoteRows, ancestorCode) => {
    const reviewedHead = "c".repeat(40)
    const { lifecycle, calls, record } = await ownedFixture({
      [`${rootGit} ls-remote --heads origin refs/heads/${branch}`]: () => ({ code: 0, stdout: remoteRows }),
      [`${ownedGit} rev-parse HEAD`]: () => ({ code: 0, stdout: `${sha}\n` }),
      [`${rootGit} fetch --no-tags origin refs/heads/${branch}`]: () => ({ code: 0 }),
      [`${rootGit} rev-parse FETCH_HEAD`]: () => ({ code: 0, stdout: `${reviewedHead}\n` }),
      [`${rootGit} merge-base --is-ancestor ${sha} ${reviewedHead}`]: () => ({ code: ancestorCode }),
      [`${rootGit} merge-base`]: () => ({ code: 0 }),
      [`${ownedGit} status`]: () => ({ code: 0, stdout: "" }),
    })

    await expect(lifecycle.cleanupOwnedWorktree({
      ...record,
      mergeCommitSha: mergeSha,
      expectedHeadSha: reviewedHead,
    })).rejects.toMatchObject({ code: "HERMES_REPOSITORY_OWNERSHIP_WALL" })
    expect(calls.some(({ args }) => args.includes("remove") || args.includes("update-ref"))).toBe(false)
  })

  it("walls partial-cleanup replay if the owned worktree reappears before branch deletion", async () => {
    const reviewedHead = "c".repeat(40)
    let worktreeReads = 0
    const { lifecycle, calls } = fixture({
      [`${rootGit} worktree list --porcelain`]: () => {
        worktreeReads += 1
        return {
          code: 0,
          stdout: worktreeReads === 1 ? "" : `worktree ${ownedWorktree}\nHEAD ${sha}\nbranch refs/heads/${branch}\n\n`,
        }
      },
      [`${rootGit} show-ref --verify --quiet refs/heads/${branch}`]: () => ({ code: 0 }),
      [`${rootGit} rev-parse refs/heads/${branch}`]: () => ({ code: 0, stdout: `${sha}\n` }),
      [`${rootGit} ls-remote --heads origin refs/heads/${branch}`]: () => ({
        code: 0,
        stdout: `${reviewedHead}\trefs/heads/${branch}\n`,
      }),
      [`${rootGit} fetch --no-tags origin refs/heads/${branch}`]: () => ({ code: 0 }),
      [`${rootGit} rev-parse FETCH_HEAD`]: () => ({ code: 0, stdout: `${reviewedHead}\n` }),
      [`${rootGit} merge-base --is-ancestor ${sha} ${reviewedHead}`]: () => ({ code: 0 }),
      [`${rootGit} merge-base`]: () => ({ code: 0 }),
    })

    await expect(lifecycle.cleanupOwnedWorktree({
      branch,
      worktreePath: ownedWorktree,
      mergeCommitSha: mergeSha,
      expectedHeadSha: reviewedHead,
    })).rejects.toMatchObject({ code: "HERMES_REPOSITORY_OWNERSHIP_WALL" })
    expect(calls.some(({ args }) => args.includes("update-ref"))).toBe(false)
  })

  it("walls before worktree removal when the registered branch ref drifts from the owned worktree head", async () => {
    const driftedBranchHead = "d".repeat(40)
    const { lifecycle, calls, record } = await ownedFixture({
      [`${rootGit} ls-remote --heads origin refs/heads/${branch}`]: () => ({
        code: 0,
        stdout: `${sha}\trefs/heads/${branch}\n`,
      }),
      [`${ownedGit} rev-parse HEAD`]: () => ({ code: 0, stdout: `${sha}\n` }),
      [`${rootGit} rev-parse refs/heads/${branch}`]: () => ({ code: 0, stdout: `${driftedBranchHead}\n` }),
      [`${rootGit} merge-base`]: () => ({ code: 0 }),
      [`${ownedGit} status`]: () => ({ code: 0, stdout: "" }),
    })

    await expect(lifecycle.cleanupOwnedWorktree({
      ...record,
      mergeCommitSha: mergeSha,
      expectedHeadSha: sha,
    })).rejects.toMatchObject({ code: "HERMES_REPOSITORY_OWNERSHIP_WALL" })
    expect(calls.some(({ args }) => args.includes("remove") || args.includes("update-ref"))).toBe(false)
  })

  it("treats an absent owned worktree and absent local branch as idempotently cleaned", async () => {
    const { lifecycle, calls } = fixture({
      [`${rootGit} worktree list --porcelain`]: () => ({ code: 0, stdout: "" }),
      [`${rootGit} show-ref --verify --quiet refs/heads/${branch}`]: () => ({ code: 1 }),
      [`${rootGit} merge-base`]: () => ({ code: 0 }),
    })
    await expect(lifecycle.cleanupOwnedWorktree({
      branch,
      worktreePath: ownedWorktree,
      mergeCommitSha: mergeSha,
      expectedHeadSha: sha,
    })).resolves.toMatchObject({ cleaned: true, alreadyCleaned: true })
    expect(calls.some(({ args }) => args.includes("ls-remote") || args.includes("update-ref"))).toBe(false)
  })

  it("removes only an ignored ordinary dependency directory during terminal cleanup recovery", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-terminal-cleanup-"))
    const workspaceRoot = path.join(temporary, "workspace")
    const recoveryRoot = path.join(temporary, "owned")
    const recoveryBranch = "codex/hermes-goal-99"
    const recoveryWorktree = path.join(recoveryRoot, "hermes-goal-99")
    fs.mkdirSync(workspaceRoot, { recursive: true })
    fs.mkdirSync(recoveryRoot, { recursive: true })
    const runner = async ({ args }: Call) => {
      const command = args.join(" ")
      if (command.includes("remote get-url origin")) {
        return { code: 0, stdout: "https://github.com/bsvalues/terragroq.git\n" }
      }
      if (command.includes("show-ref --verify --quiet")) return { code: 1, stdout: "" }
      if (command.includes("rev-parse HEAD")) return { code: 0, stdout: `${sha}\n` }
      if (command.includes("check-ignore -q node_modules/")) return { code: 0, stdout: "" }
      return { code: 0, stdout: "" }
    }
    const lifecycle = createRepositoryLifecycle({
      repository: "bsvalues/terragroq",
      workspaceRoot,
      repositoryRoot: workspaceRoot,
      ownedWorktreeRoot: recoveryRoot,
      runner,
    })
    const record = await lifecycle.createWorktree({ branch: recoveryBranch })
    fs.mkdirSync(path.join(recoveryWorktree, "node_modules", "package"), { recursive: true })
    fs.writeFileSync(path.join(recoveryWorktree, "node_modules", "package", "index.js"), "module.exports = true\n")

    await expect(lifecycle.removeTerminalRecoveryDependencies({
      branch: recoveryBranch,
      worktreePath: record.worktreePath,
      expectedHeadSha: sha,
    })).resolves.toEqual({ removed: true, headRefOid: sha })
    expect(fs.existsSync(path.join(recoveryWorktree, "node_modules"))).toBe(false)
    fs.rmSync(temporary, { recursive: true, force: true })
  })

  it("removes the exact owned validation junction during terminal cleanup recovery", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-terminal-junction-cleanup-"))
    const workspaceRoot = path.join(temporary, "workspace")
    const recoveryRoot = path.join(temporary, "owned")
    const recoveryBranch = "codex/hermes-goal-100"
    const recoveryWorktree = path.join(recoveryRoot, "hermes-goal-100")
    fs.mkdirSync(path.join(workspaceRoot, "node_modules"), { recursive: true })
    fs.mkdirSync(recoveryRoot, { recursive: true })
    const runner = async ({ args }: Call) => {
      const command = args.join(" ")
      if (command.includes("remote get-url origin")) {
        return { code: 0, stdout: "https://github.com/bsvalues/terragroq.git\n" }
      }
      if (command.includes("show-ref --verify --quiet")) return { code: 1, stdout: "" }
      if (command.includes("rev-parse HEAD")) return { code: 0, stdout: `${sha}\n` }
      if (command.includes("check-ignore -q node_modules/")) return { code: 0, stdout: "" }
      return { code: 0, stdout: "" }
    }
    const lifecycle = createRepositoryLifecycle({
      repository: "bsvalues/terragroq",
      workspaceRoot,
      repositoryRoot: workspaceRoot,
      ownedWorktreeRoot: recoveryRoot,
      runner,
    })

    try {
      const record = await lifecycle.createWorktree({ branch: recoveryBranch })
      fs.mkdirSync(recoveryWorktree, { recursive: true })
      expect(lifecycle.ensureValidationDependencies(record)).toEqual({ linked: true, existing: false })

      await expect(lifecycle.removeTerminalRecoveryDependencies({
        branch: recoveryBranch,
        worktreePath: record.worktreePath,
        expectedHeadSha: sha,
      })).resolves.toEqual({ removed: true, headRefOid: sha })
      expect(fs.existsSync(path.join(recoveryWorktree, "node_modules"))).toBe(false)
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("removes the exact owned validation junction after its target disappears", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-terminal-dangling-junction-"))
    const workspaceRoot = path.join(temporary, "workspace")
    const recoveryRoot = path.join(temporary, "owned")
    const recoveryBranch = "codex/hermes-goal-101"
    const recoveryWorktree = path.join(recoveryRoot, "hermes-goal-101")
    const dependencySource = path.join(workspaceRoot, "node_modules")
    fs.mkdirSync(dependencySource, { recursive: true })
    fs.mkdirSync(recoveryRoot, { recursive: true })
    const runner = async ({ args }: Call) => {
      const command = args.join(" ")
      if (command.includes("remote get-url origin")) {
        return { code: 0, stdout: "https://github.com/bsvalues/terragroq.git\n" }
      }
      if (command.includes("show-ref --verify --quiet")) return { code: 1, stdout: "" }
      if (command.includes("rev-parse HEAD")) return { code: 0, stdout: `${sha}\n` }
      return { code: 0, stdout: "" }
    }
    const lifecycle = createRepositoryLifecycle({
      repository: "bsvalues/terragroq",
      workspaceRoot,
      repositoryRoot: workspaceRoot,
      ownedWorktreeRoot: recoveryRoot,
      runner,
    })

    try {
      const record = await lifecycle.createWorktree({ branch: recoveryBranch })
      fs.mkdirSync(recoveryWorktree, { recursive: true })
      expect(lifecycle.ensureValidationDependencies(record)).toEqual({ linked: true, existing: false })
      fs.rmSync(dependencySource, { recursive: true, force: true })

      await expect(lifecycle.removeTerminalRecoveryDependencies({
        branch: recoveryBranch,
        worktreePath: record.worktreePath,
        expectedHeadSha: sha,
      })).resolves.toEqual({ removed: true, headRefOid: sha })
      expect(fs.lstatSync(path.join(recoveryWorktree, "node_modules"), { throwIfNoEntry: false })).toBeUndefined()
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  })

  it("terminal remote cleanup removes only the marked isolated dependency tree", async () => {
    const exact = await remoteDependencyFixture({ target: "owned-tree" })
    await expect(exact.lifecycle.removeTerminalRecoveryDependencies({
      ...exact.record, expectedHeadSha: sha,
    })).resolves.toEqual({ removed: true, headRefOid: sha })
    expect(exact.calls.filter(({ command }) => command === "rm")).toEqual([{
      workspacePath: exact.record.worktreePath,
      command: "rm",
      args: ["-rf", "--", exact.dependencyTarget],
    }])
    expect(exact.backend.runCommand).toHaveBeenCalledWith({
      workspacePath: exact.record.worktreePath,
      command: "rm",
      args: ["-rf", "--", exact.dependencyTarget],
      credentialAccess: false,
    })

    for (const options of [
      { target: "owned-tree" as const, marker: false },
      { target: "foreign-tree" as const, marker: true },
      { target: "symlink" as const, marker: true },
    ]) {
      const refused = await remoteDependencyFixture(options)
      await expect(refused.lifecycle.removeTerminalRecoveryDependencies({
        ...refused.record, expectedHeadSha: sha,
      })).rejects.toMatchObject({ code: "HERMES_REPOSITORY_CLEANUP_WALL" })
      expect(refused.calls.some(({ command }) => command === "rm")).toBe(false)
    }
  })

  it("fails closed on foreign repositories, unsafe branches and paths, destructive validation, and unowned cleanup", async () => {
    expectWall(() => createRepositoryLifecycle({
      repository: "other/repo", workspaceRoot: root, ownedWorktreeRoot: ownedRoot, runner: async () => ({ code: 0 }),
    }), "HERMES_REPOSITORY_SCOPE_WALL")
    expectWall(() => createRepositoryLifecycle({
      workspaceRoot: root, ownedWorktreeRoot: path.join(root, "worktrees"), runner: async () => ({ code: 0 }),
    }), "HERMES_REPOSITORY_PATH_WALL")
    for (const validationCommand of [
      { command: "git", args: ["reset", "--hard"] },
      { command: "git", args: ["push", "--force", "origin", branch] },
      { command: "git", args: ["tag", "v1"] },
      { command: "gh", args: ["release", "create", "v1"] },
      { command: "npm", args: ["run", "deploy"] },
    ]) {
      expect(() => createRepositoryLifecycle({
        workspaceRoot: root, ownedWorktreeRoot: ownedRoot,
        validationCommands: [validationCommand], runner: async () => ({ code: 0 }),
      })).toThrow(HermesRepositoryLifecycleError)
    }
    expectWall(() => createRepositoryLifecycle({
      workspaceRoot: root, ownedWorktreeRoot: ownedRoot,
      validationCommands: [{ command: "Remove-Item", args: ["-Recurse", root] }], runner: async () => ({ code: 0 }),
    }), "HERMES_REPOSITORY_VALIDATION_WALL")
    const { lifecycle } = fixture()
    await expect(lifecycle.createWorktree({ branch: "main" })).rejects.toMatchObject({ code: "HERMES_REPOSITORY_BRANCH_WALL" })
    await expect(lifecycle.cleanupOwnedWorktree({
      branch, worktreePath: path.join(ownedRoot, "not-recorded"), mergeCommitSha: mergeSha, expectedHeadSha: sha,
    })).rejects.toMatchObject({ code: "HERMES_REPOSITORY_OWNERSHIP_WALL" })
  })
})
