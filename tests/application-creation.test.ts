import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { createApplication } from "@/lib/applications/application-creation"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function options() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "application-create-")); roots.push(root)
  return { applicationsRoot: path.join(root, "apps"), platformRoot: process.cwd() }
}
describe("atomic application creation", () => {
  it("creates Focus Board from the pinned starter in an independent committed main repository", async () => {
    const config = await options()
    const created = await createApplication({ id: "focus-board", displayName: "Focus Board" }, config)
    expect(created.manifest.id).toBe("focus-board")
    expect(created.repositoryRoot).toBe(path.join(config.applicationsRoot, "focus-board"))
    expect(execFileSync("git", ["-C", created.repositoryRoot, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("main")
    expect(execFileSync("git", ["-C", created.repositoryRoot, "status", "--porcelain"], { encoding: "utf8" })).toBe("")
    expect(execFileSync("git", ["-C", created.repositoryRoot, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim()).toBe("1")
    expect(await fs.readFile(path.join(created.repositoryRoot, "src/app.js"), "utf8")).toBe(await fs.readFile("starters/static-web-v1/src/app.js", "utf8"))
    expect(await fs.readdir(config.applicationsRoot)).toEqual(["focus-board"])
    await expect(createApplication({ id: "focus-board", displayName: "Replace" }, config)).rejects.toThrow("APPLICATION_EXISTS")
    expect(JSON.parse(await fs.readFile(path.join(created.repositoryRoot, ".williamos/application.json"), "utf8")).displayName).toBe("Focus Board")
  })
  it.each(["../escape", "C:\\escape", "Upper", "con", "williamos", "terrafusion", "hello-application", "a".repeat(65)])("refuses invalid or reserved ID %s before writing", async (id) => {
    const config = await options()
    await expect(createApplication({ id, displayName: "Board" }, config)).rejects.toThrow()
    await expect(fs.stat(config.applicationsRoot)).rejects.toThrow()
  })
  it.each(["root", "command", "image", "mounts", "network", "dockerArgs", "starterPath"])("refuses caller policy field %s before writing", async (key) => {
    const config = await options()
    await expect(createApplication({ id: "board", displayName: "Board", [key]: "unsafe" }, config)).rejects.toThrow()
    await expect(fs.stat(config.applicationsRoot)).rejects.toThrow()
  })
  it("cleans sibling temporary state after a forced Git failure and never publishes", async () => {
    const config = await options()
    await expect(createApplication({ id: "board", displayName: "Board" }, config, {
      initializeRepository: async () => { throw new Error("forced Git failure") },
    })).rejects.toThrow("forced Git failure")
    expect(await fs.readdir(config.applicationsRoot)).toEqual([])
  })
  it("serializes competing creation so exactly one repository is published", async () => {
    const config = await options()
    const results = await Promise.allSettled([createApplication({ id: "board", displayName: "One" }, config), createApplication({ id: "board", displayName: "Two" }, config)])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await fs.readdir(config.applicationsRoot)).toEqual(["board"])
  })
})
