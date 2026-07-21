import path from "node:path"

import { describe, expect, it } from "vitest"

import {
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

type Call = { command: string; args: string[]; cwd: string }

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
        stdout: `worktree ${worktreePath.replace(/\\\\/g, "/")}\nHEAD ${sha}\nbranch refs/heads/${branch}\n\n`,
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
      [`${ownedGit} diff`]: () => ({ code: 0, stdout: "src/a.ts\0tests/a.test.ts\0" }),
    })
    await expect(lifecycle.inspectChangedPaths(record)).resolves.toEqual([
      "src/a.ts", "src/moved.ts", "src/new.ts", "src/old.ts", "tests/a.test.ts",
    ])
    await expect(lifecycle.runValidationCommands(record)).resolves.toEqual([
      { command: "npm", args: ["test", "--", "--run", "tests/unit.test.ts"], code: 0 },
    ])
    expect(calls.at(-1)).toEqual({
      command: "npm",
      args: ["test", "--", "--run", "tests/unit.test.ts"],
      cwd: record.worktreePath,
    })
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

  it("reads immutable PR file names for post-merge scope verification", async () => {
    const { lifecycle, calls } = fixture({
      "gh pr diff 77": () => ({ code: 0, stdout: "components/hermes/status.tsx\ntests/hermes-status.test.tsx\n" }),
    })
    await expect(lifecycle.inspectPullRequestFiles(77)).resolves.toEqual([
      "components/hermes/status.tsx", "tests/hermes-status.test.tsx",
    ])
    expect(calls.at(-1)?.args).toEqual(["pr", "diff", "77", "--repo", "bsvalues/terragroq", "--name-only"])
  })

  it("pushes an exact refspec and merges only an approved green PR with no unresolved threads", async () => {
    const pr = {
      number: 77,
      headRefName: branch,
      headRefOid: sha,
      state: "OPEN",
      isDraft: false,
      reviewDecision: "APPROVED",
      statusCheckRollup: [{ conclusion: "SUCCESS" }, { state: "SUCCESS" }],
    }
    const { lifecycle, calls, record } = await ownedFixture({
      "gh pr view": () => ({ code: 0, stdout: JSON.stringify(pr) }),
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } }) }),
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
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [
        { isResolved: false, comments: { nodes: [{ body: "Fix this", isMinimized: false }] } },
      ], pageInfo: { hasNextPage: false } } } } } }) }),
    })
    await expect(lifecycle.mergePullRequest({ number: 77, branch })).rejects.toMatchObject({
      code: "HERMES_REPOSITORY_MERGE_GATE_WALL",
    })
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
      "gh api graphql": () => ({ code: 0, stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } }) }),
    })
    await expect(lifecycle.inspectPullRequest(77)).resolves.toMatchObject({ reviewed: true, checksGreen: true })
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
