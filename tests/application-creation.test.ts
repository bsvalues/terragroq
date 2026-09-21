import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApplication } from "@/lib/applications/application-creation"

const roots: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function options() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "application-create-")); roots.push(root)
  return { applicationsRoot: path.join(root, "apps"), platformRoot: process.cwd() }
}
describe("atomic application creation", () => {
  it("commits all five literal required paths even when host excludes hide the manifest and test", async () => {
    const config = await options()
    const exclusions = path.join(path.dirname(config.applicationsRoot), "host-excludes")
    await fs.writeFile(exclusions, ".williamos/\ntest/\n")
    vi.stubEnv("GIT_CONFIG_COUNT", "1")
    vi.stubEnv("GIT_CONFIG_KEY_0", "core.excludesFile")
    vi.stubEnv("GIT_CONFIG_VALUE_0", exclusions)
    const created = await createApplication({ id: "ignored-board", displayName: "Ignored Board" }, config)
    const paths = execFileSync("git", ["-C", created.repositoryRoot, "ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8" }).trim().split(/\r?\n/)
    expect(paths).toEqual([".williamos/application.json", "src/app.js", "src/index.html", "src/styles.css", "test/application.test.mjs"])
    expect(JSON.parse(execFileSync("git", ["-C", created.repositoryRoot, "show", "HEAD:.williamos/application.json"], { encoding: "utf8" })).id).toBe("ignored-board")
    expect(execFileSync("git", ["-C", created.repositoryRoot, "show", "HEAD:test/application.test.mjs"], { encoding: "utf8" })).toContain('assert.equal(elements.get("task-count").textContent, "0 of 0 complete")')
  })
  it("never publishes an initial commit that omits required files even if they exist on disk", async () => {
    const config = await options()
    await expect(createApplication({ id: "incomplete-board", displayName: "Incomplete Board" }, config, {
      initializeRepository: async (repository) => {
        execFileSync("git", ["-C", repository, "init", "-b", "main"], { windowsHide: true })
        execFileSync("git", ["-C", repository, "add", "--", "src/app.js"], { windowsHide: true })
        execFileSync("git", ["-C", repository, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Incomplete"], { windowsHide: true })
      },
    })).rejects.toThrow("APPLICATION_REPOSITORY_INCOMPLETE")
    expect(await fs.readdir(config.applicationsRoot)).toEqual([])
  })
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
