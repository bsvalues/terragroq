import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { evaluateCheckRollup, inspectWorkspaceChanges } from "@/scripts/runtime-operator/native-adapters.mjs"

describe("native operational-kernel adapters", () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  it("uses actual Git state and rejects unstaged, untracked, and out-of-envelope changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-native-adapter-"))
    roots.push(root)
    execFileSync("git", ["init", "-b", "main"], { cwd: root })
    execFileSync("git", ["config", "user.email", "runtime-test@example.com"], { cwd: root })
    execFileSync("git", ["config", "user.name", "Runtime Test"], { cwd: root })
    fs.mkdirSync(path.join(root, "docs", "reports"), { recursive: true })
    fs.writeFileSync(path.join(root, "docs", "reports", "allowed.md"), "before\n")
    fs.writeFileSync(path.join(root, "README.md"), "before\n")
    execFileSync("git", ["add", "."], { cwd: root })
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root })

    fs.writeFileSync(path.join(root, "docs", "reports", "allowed.md"), "after\n")
    execFileSync("git", ["add", "docs/reports/allowed.md"], { cwd: root })
    await expect(inspectWorkspaceChanges(root, ["docs/reports/allowed.md"])).resolves.toMatchObject({
      changedPaths: ["docs/reports/allowed.md"],
    })

    fs.writeFileSync(path.join(root, "README.md"), "unstaged\n")
    await expect(inspectWorkspaceChanges(root, ["docs/reports/allowed.md"])).rejects.toThrow("PATCH_UNSTAGED_WALL")
    execFileSync("git", ["restore", "README.md"], { cwd: root })

    fs.writeFileSync(path.join(root, "untracked.txt"), "unexpected\n")
    await expect(inspectWorkspaceChanges(root, ["docs/reports/allowed.md"])).rejects.toThrow("PATCH_UNTRACKED_WALL")
    fs.rmSync(path.join(root, "untracked.txt"))

    await expect(inspectWorkspaceChanges(root, ["README.md"])).rejects.toThrow("PATCH_EXACT_PATH_WALL")

    execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: root })
    const assignment = `${["api", "key"].join("_")} = "${"a".repeat(22)}"\n`
    fs.writeFileSync(path.join(root, "docs", "reports", "allowed.md"), assignment)
    execFileSync("git", ["add", "docs/reports/allowed.md"], { cwd: root })
    await expect(inspectWorkspaceChanges(root, ["docs/reports/allowed.md"])).rejects.toThrow("PATCH_SECRET_OR_BINARY_WALL")
  })

  it("handles GitHub check runs and legacy status contexts without waiting forever", () => {
    expect(evaluateCheckRollup([
      { __typename: "StatusContext", context: "CodeRabbit", state: "SUCCESS" },
      { __typename: "CheckRun", name: "Vercel", status: "COMPLETED", conclusion: "SUCCESS" },
    ])).toEqual({ pending: false, failures: [] })
    expect(evaluateCheckRollup([{ __typename: "StatusContext", context: "Vercel", state: "PENDING" }]).pending).toBe(true)
    expect(evaluateCheckRollup([{ __typename: "StatusContext", context: "Vercel", state: "FAILURE" }]).failures).toHaveLength(1)
  })
})
