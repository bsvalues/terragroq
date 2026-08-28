import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import {
  cleanupCodexIsolatedWorkspace,
  createCodexIsolatedWorkspace,
  inspectCodexIsolatedWorkspace,
} from "@/lib/loom/codex-isolated-workspace"

const run = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "codex-isolation-"))
  roots.push(parent)
  const projectRoot = path.join(parent, "real-checkout")
  const runtimeRoot = path.join(parent, ".williamos")
  await run("git", ["init", "--quiet", projectRoot])
  await run("git", ["-C", projectRoot, "config", "user.email", "test@example.test"])
  await run("git", ["-C", projectRoot, "config", "user.name", "Test"])
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true })
  await fs.writeFile(path.join(projectRoot, "src", "selected.ts"), "export const before = true\n", "utf8")
  await fs.writeFile(path.join(projectRoot, "src", "other.ts"), "export const other = true\n", "utf8")
  await fs.writeFile(path.join(projectRoot, ".gitignore"), ".codex-hidden/\n", "utf8")
  await run("git", ["-C", projectRoot, "add", "."])
  await run("git", ["-C", projectRoot, "commit", "--quiet", "-m", "fixture"])
  return { parent, projectRoot, runtimeRoot }
}

describe("product-local Codex disposable worktree", () => {
  it("creates a detached worktree seeded with the exact captured target and verifies cleanup", async () => {
    const { projectRoot, runtimeRoot } = await fixture()
    const baseSha = (await run("git", ["-C", projectRoot, "rev-parse", "HEAD"])).stdout.trim()

    const isolated = await createCodexIsolatedWorkspace({
      projectRoot,
      runtimeRoot,
      selectedPath: "src/selected.ts",
      initialContent: "export const captured = true\n",
    })

    expect(isolated.baseSha).toBe(baseSha)
    expect(path.relative(runtimeRoot, isolated.root)).not.toMatch(/^\.\./)
    expect((await run("git", ["-C", isolated.root, "branch", "--show-current"])).stdout.trim()).toBe("")
    expect(await fs.readFile(path.join(isolated.root, "src", "selected.ts"), "utf8"))
      .toBe("export const captured = true\n")

    await cleanupCodexIsolatedWorkspace(isolated)
    await expect(fs.stat(isolated.root)).rejects.toMatchObject({ code: "ENOENT" })
    expect((await run("git", ["-C", projectRoot, "worktree", "list", "--porcelain"])).stdout)
      .not.toContain(isolated.root)
  })

  it("accepts exactly one regular text modification to the assigned existing file", async () => {
    const { projectRoot, runtimeRoot } = await fixture()
    const isolated = await createCodexIsolatedWorkspace({
      projectRoot, runtimeRoot, selectedPath: "src/selected.ts", initialContent: "export const before = true\n",
    })
    await fs.writeFile(path.join(isolated.root, "src", "selected.ts"), "export const after = true\n", "utf8")

    const result = await inspectCodexIsolatedWorkspace(isolated)

    expect(result).toMatchObject({ content: "export const after = true\n" })
    await cleanupCodexIsolatedWorkspace(isolated)
  })

  it.each([
    ["an out-of-scope modification", async (root: string) => {
      await fs.writeFile(path.join(root, "src", "selected.ts"), "selected changed\n")
      await fs.writeFile(path.join(root, "src", "other.ts"), "other changed\n")
    }],
    ["a created file", async (root: string) => {
      await fs.writeFile(path.join(root, "src", "selected.ts"), "selected changed\n")
      await fs.writeFile(path.join(root, "src", "created.ts"), "created\n")
    }],
    ["an ignored out-of-scope file", async (root: string) => {
      await fs.writeFile(path.join(root, "src", "selected.ts"), "selected changed\n")
      await fs.mkdir(path.join(root, ".codex-hidden"), { recursive: true })
      await fs.writeFile(path.join(root, ".codex-hidden", "payload.txt"), "hidden side effect\n")
    }],
    ["a deleted target", async (root: string) => fs.rm(path.join(root, "src", "selected.ts"))],
    ["a binary target", async (root: string) => {
      await fs.writeFile(path.join(root, "src", "selected.ts"), Buffer.from([0x41, 0, 0x42]))
    }],
  ])("rejects %s while leaving the real checkout unchanged", async (_label, mutate) => {
    const { projectRoot, runtimeRoot } = await fixture()
    const isolated = await createCodexIsolatedWorkspace({
      projectRoot, runtimeRoot, selectedPath: "src/selected.ts", initialContent: "export const before = true\n",
    })
    await mutate(isolated.root)

    await expect(inspectCodexIsolatedWorkspace(isolated)).rejects.toMatchObject({
      code: "CODEX_ISOLATION_VIOLATION",
    })
    expect(await fs.readFile(path.join(projectRoot, "src", "selected.ts"), "utf8"))
      .toBe("export const before = true\n")
    await cleanupCodexIsolatedWorkspace(isolated)
  })

  it("rejects a provider success that did not change the captured target", async () => {
    const { projectRoot, runtimeRoot } = await fixture()
    const isolated = await createCodexIsolatedWorkspace({
      projectRoot, runtimeRoot, selectedPath: "src/selected.ts", initialContent: "export const before = true\n",
    })

    await expect(inspectCodexIsolatedWorkspace(isolated)).rejects.toMatchObject({
      code: "CODEX_NO_CHANGE",
    })
    await cleanupCodexIsolatedWorkspace(isolated)
  })
})
