import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  createCommandEnvironment,
  createRepositoryLifecycle,
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

function fixture(overrides: Record<string, (call: Call) => unknown> = {}) {
  const calls: Call[] = []
  const runner = async (call: Call) => {
    calls.push(call)
    const key = `${call.command} ${call.args.filter((arg) => !arg.startsWith("query=")).join(" ")}`
    const override = Object.entries(overrides).find(([prefix]) => key.startsWith(prefix))?.[1]
    if (override) return override(call)
    if (key.includes("remote get-url origin")) return { code: 0, stdout: "https://github.com/bsvalues/terragroq.git\n" }
    if (key.includes("rev-parse refs/remotes/origin/main")) return { code: 0, stdout: `${sha}\n` }
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

  it("reads immutable PR file names for post-merge scope verification", async () => {
    const { lifecycle, calls } = fixture({
      "gh api --paginate --slurp repos/bsvalues/terragroq/pulls/77/files": () => ({ code: 0, stdout: JSON.stringify([[
        { filename: "components/hermes/status.tsx", previous_filename: "lib/auth/old-status.tsx" },
        { filename: "tests/hermes-status.test.tsx" },
      ]]) }),
    })
    await expect(lifecycle.inspectPullRequestFiles(77)).resolves.toEqual([
      "components/hermes/status.tsx", "lib/auth/old-status.tsx", "tests/hermes-status.test.tsx",
    ])
    expect(calls.at(-1)?.args).toEqual(["api", "--paginate", "--slurp", "repos/bsvalues/terragroq/pulls/77/files?per_page=100"])
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
