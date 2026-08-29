import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it, vi } from "vitest"

import { deriveWorkspaceFileDiff, MAX_WORKSPACE_PATCH_BYTES } from "@/lib/loom/workspace-diff"

const execute = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("server-derived workspace diff grounding", () => {
  it("derives a bounded tracked patch and fingerprint from fixed git argv", async () => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "status") return { stdout: " M src/app.ts\n", stderr: "" }
      if (args[0] === "ls-files") return { stdout: "src/app.ts\n", stderr: "" }
      if (args[0] === "rev-parse") return { stdout: "abc123\n", stderr: "" }
      if (args[0] === "diff") return { stdout: "diff --git a/src/app.ts b/src/app.ts\n-old\n+new\n", stderr: "" }
      throw new Error(`unexpected argv: ${args.join(" ")}`)
    })

    const snapshot = await deriveWorkspaceFileDiff("C:\\repo", "src/app.ts", run)

    expect(snapshot).toEqual(expect.objectContaining({
      state: "modified",
      path: "src/app.ts",
      status: " M src/app.ts",
      baseHash: "abc123",
      patch: expect.stringContaining("+new"),
      patchHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      fingerprint: expect.stringContaining('"baseHash":"abc123"'),
    }))
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ["status", "--porcelain=v1", "--untracked-files=all", "--", "src/app.ts"],
      ["ls-files", "--error-unmatch", "--", "src/app.ts"],
      ["rev-parse", "--verify", "HEAD"],
      ["diff", "--patch", "--no-color", "HEAD", "--", "src/app.ts"],
    ])
  })

  it.each([
    { name: "clean", status: "", tracked: true, patch: "", state: "clean" },
    { name: "untracked", status: "?? src/new.ts\n", tracked: false, patch: "", state: "untracked" },
    { name: "ignored untracked", status: "", tracked: false, patch: "", state: "untracked" },
  ])("reports $name truth explicitly", async ({ status, tracked, patch, state }) => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "status") return { stdout: status, stderr: "" }
      if (args[0] === "ls-files") {
        if (!tracked) throw Object.assign(new Error("not tracked"), { code: 1 })
        return { stdout: "src/app.ts\n", stderr: "" }
      }
      if (args[0] === "rev-parse") return { stdout: "abc123\n", stderr: "" }
      if (args[0] === "diff") return { stdout: patch, stderr: "" }
      throw new Error("unexpected")
    })

    await expect(deriveWorkspaceFileDiff("C:\\repo", tracked ? "src/app.ts" : "src/new.ts", run))
      .resolves.toEqual(expect.objectContaining({ state }))
  })

  it("types an oversized patch without returning partial patch content", async () => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "status") return { stdout: " M src/app.ts\n", stderr: "" }
      if (args[0] === "ls-files") return { stdout: "src/app.ts\n", stderr: "" }
      if (args[0] === "rev-parse") return { stdout: "abc123\n", stderr: "" }
      return { stdout: "x".repeat(MAX_WORKSPACE_PATCH_BYTES + 1), stderr: "" }
    })

    await expect(deriveWorkspaceFileDiff("C:\\repo", "src/app.ts", run)).resolves.toEqual(expect.objectContaining({
      state: "oversize",
      patch: "",
      patchHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
  })

  it("types git unavailability without leaking command failure detail", async () => {
    const run = vi.fn(async () => { throw new Error("secret host detail") })

    await expect(deriveWorkspaceFileDiff("C:\\repo", "src/app.ts", run)).resolves.toEqual(expect.objectContaining({
      state: "git-unavailable",
      patch: "",
      patchHash: null,
      reason: "GIT_UNAVAILABLE",
    }))
  })

  it("hashes the complete real patch while returning only bounded patch text", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-workspace-diff-"))
    roots.push(root)
    await execute("git", ["init", "--quiet"], { cwd: root, windowsHide: true })
    await fs.mkdir(path.join(root, "src"), { recursive: true })
    await fs.writeFile(path.join(root, "src", "app.ts"), "export const value = 'old'\n")
    await execute("git", ["add", "--", "src/app.ts"], { cwd: root, windowsHide: true })
    await execute("git", ["-c", "user.name=WilliamOS Test", "-c", "user.email=test@williamos.invalid", "commit", "--quiet", "-m", "base"], { cwd: root, windowsHide: true })
    await fs.writeFile(path.join(root, "src", "app.ts"), "export const value = 'new'\n")

    const snapshot = await deriveWorkspaceFileDiff(root, "src/app.ts")

    expect(snapshot).toEqual(expect.objectContaining({
      state: "modified",
      path: "src/app.ts",
      patch: expect.stringContaining("+export const value = 'new'"),
      baseHash: expect.stringMatching(/^[a-f0-9]{40,64}$/),
      patchHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
  })
})
