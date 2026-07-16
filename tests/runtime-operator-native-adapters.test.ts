import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { buildSanitizedEnvironment, evaluateCheckRollup, inspectWorkspaceChanges } from "@/scripts/runtime-operator/native-adapters.mjs"

describe("native operational-kernel adapters", () => {
  const roots: string[] = []

  function createRepository(prefix: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    roots.push(root)
    execFileSync("git", ["init", "-b", "main"], { cwd: root })
    execFileSync("git", ["config", "user.email", "runtime-test@example.com"], { cwd: root })
    execFileSync("git", ["config", "user.name", "Runtime Test"], { cwd: root })
    fs.mkdirSync(path.join(root, "docs", "reports"), { recursive: true })
    fs.writeFileSync(path.join(root, "docs", "reports", "allowed.md"), "before\n")
    execFileSync("git", ["add", "."], { cwd: root })
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root })
    return root
  }

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  it("uses actual Git state and rejects unstaged, untracked, and out-of-envelope changes", async () => {
    const root = createRepository("williamos-native-adapter-")
    fs.writeFileSync(path.join(root, "README.md"), "before\n")
    execFileSync("git", ["add", "."], { cwd: root })
    execFileSync("git", ["commit", "-m", "add readme"], { cwd: root })

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
  }, 30_000)

  it("rejects staged binary content before it can be published", async () => {
    const root = createRepository("williamos-native-binary-")
    fs.writeFileSync(path.join(root, "docs", "reports", "allowed.md"), Buffer.from([0, 1, 2, 3, 4, 255]))
    execFileSync("git", ["add", "docs/reports/allowed.md"], { cwd: root })

    await expect(inspectWorkspaceChanges(root, ["docs/reports/allowed.md"])).rejects.toThrow("PATCH_BINARY_WALL")
  }, 30_000)

  it("rejects staged Git link modes even when the working tree materializes a regular file", async () => {
    const root = createRepository("williamos-native-link-")
    const target = "docs/reports/allowed.md\n"
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: target, encoding: "utf8" }).trim()
    execFileSync("git", ["update-index", "--add", "--cacheinfo", `120000,${blob},docs/reports/linked.md`], { cwd: root })
    fs.writeFileSync(path.join(root, "docs", "reports", "linked.md"), target)

    await expect(inspectWorkspaceChanges(root, ["docs/reports/linked.md"])).rejects.toThrow("PATCH_SYMLINK_OR_SUBMODULE_WALL")
  }, 30_000)

  it("handles GitHub check runs and legacy status contexts without waiting forever", () => {
    expect(evaluateCheckRollup([
      { __typename: "StatusContext", context: "CodeRabbit", state: "SUCCESS" },
      { __typename: "CheckRun", name: "Vercel", status: "COMPLETED", conclusion: "SUCCESS" },
    ])).toEqual({ pending: false, failures: [] })
    expect(evaluateCheckRollup([{ __typename: "StatusContext", context: "Vercel", state: "PENDING" }]).pending).toBe(true)
    expect(evaluateCheckRollup([{ __typename: "StatusContext", context: "Vercel", state: "FAILURE" }]).failures).toHaveLength(1)
  })

  it("passes only the native identity allowlist to subprocesses", () => {
    const environment = buildSanitizedEnvironment({ NEXT_TELEMETRY_DISABLED: "1" }, {
      SystemRoot: "C:\\Windows",
      PATH: "C:\\Windows\\System32",
      USERPROFILE: "C:\\Users\\owner",
      APPDATA: "C:\\Users\\owner\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local",
      [["AZURE", "ACCESS", "TOKEN"].join("_")]: "blocked",
    })
    expect(environment).toMatchObject({ SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\owner", NEXT_TELEMETRY_DISABLED: "1" })
    expect(environment).not.toHaveProperty(["AZURE", "ACCESS", "TOKEN"].join("_"))
  })
})
