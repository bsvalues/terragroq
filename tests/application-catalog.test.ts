import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { discoverApplications } from "@/lib/applications/application-catalog"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "application-catalog-")); roots.push(root)
  const applicationsRoot = path.join(root, "apps"); await fs.mkdir(applicationsRoot)
  const platformRoot = path.join(root, "platform"); await fs.mkdir(platformRoot)
  return { applicationsRoot, platformRoot }
}
async function app(root: string, id: string) {
  const destination = path.join(root, id)
  await fs.cp(path.resolve("starters/static-web-v1"), destination, { recursive: true })
  const file = path.join(destination, ".williamos/application.json")
  const value = JSON.parse(await fs.readFile(file, "utf8")); value.id = id
  await fs.writeFile(file, JSON.stringify(value))
  execFileSync("git", ["init", "-b", "main", destination], { windowsHide: true })
  execFileSync("git", ["-C", destination, "add", "."], { windowsHide: true })
  execFileSync("git", ["-C", destination, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Initial"], { windowsHide: true })
  return destination
}
describe("external application catalog", () => {
  it("discovers two independent repositories and isolates an invalid sibling", async () => {
    const options = await fixture()
    await app(options.applicationsRoot, "first-app"); await app(options.applicationsRoot, "second-app")
    await fs.mkdir(path.join(options.applicationsRoot, "invalid-app"))
    const catalog = await discoverApplications(options)
    expect(catalog.applications.map((item) => item.manifest.id)).toEqual(["first-app", "second-app"])
    expect(catalog.invalid).toEqual([{ id: "invalid-app", error: "APPLICATION_INVALID" }])
    expect(catalog.applications[0].repositoryRoot).not.toBe(catalog.applications[1].repositoryRoot)
    expect(catalog.applications[0].head).toMatch(/^[a-f0-9]{40}$/)
    const collision = await discoverApplications(options, undefined, () => -1)
    expect(collision.applications).toEqual([])
    expect(collision.invalid).toContainEqual({ id: "first-app", error: "APPLICATION_IDENTITY_COLLISION" })
    expect(collision.invalid).toContainEqual({ id: "second-app", error: "APPLICATION_IDENTITY_COLLISION" })
  })
  it("refuses a junction child and a junction source directory without exposing their targets", async () => {
    const options = await fixture(); const target = await app(options.applicationsRoot, "first-app")
    await fs.symlink(target, path.join(options.applicationsRoot, "linked-app"), "junction")
    await fs.rename(path.join(target, "src"), path.join(options.platformRoot, "src"))
    await fs.symlink(path.join(options.platformRoot, "src"), path.join(target, "src"), "junction")
    const catalog = await discoverApplications(options)
    expect(catalog.applications).toEqual([])
    expect(catalog.invalid.map((item) => item.id)).toEqual(["first-app", "linked-app"])
  })
  it("refuses oversized files, wrong folder IDs, and missing independent Git roots", async () => {
    const options = await fixture()
    const first = await app(options.applicationsRoot, "first-app")
    await fs.writeFile(path.join(first, "src/app.js"), "x".repeat(262145))
    const second = await app(options.applicationsRoot, "second-app")
    await fs.rename(second, path.join(options.applicationsRoot, "wrong-id"))
    const third = await app(options.applicationsRoot, "third-app")
    await fs.rm(path.join(third, ".git"), { recursive: true, force: true })
    expect((await discoverApplications(options)).applications).toEqual([])
  })
  it("refuses platform-contained roots and root junctions before discovery", async () => {
    const options = await fixture()
    await expect(discoverApplications({ ...options, applicationsRoot: options.platformRoot })).rejects.toThrow("APPLICATIONS_ROOT_INVALID")
    const link = path.join(path.dirname(options.platformRoot), "linked-root")
    await fs.symlink(options.applicationsRoot, link, "junction")
    await expect(discoverApplications({ ...options, applicationsRoot: link })).rejects.toThrow("APPLICATIONS_ROOT_INVALID")
  })
  it("refuses apps inside the platform's owning checkout when running from a nested worktree", async () => {
    const options = await fixture()
    await fs.mkdir(path.join(options.platformRoot, ".git"))
    const checkout = path.join(options.platformRoot, ".worktrees", "feature")
    await fs.mkdir(checkout, { recursive: true })
    await expect(discoverApplications({ platformRoot: checkout, applicationsRoot: path.join(options.platformRoot, "apps") })).rejects.toThrow("APPLICATIONS_ROOT_INVALID")
  })
})
