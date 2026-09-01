import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { inspectGitDelivery } from "@/lib/governance/delivery-seal-runtime"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim()
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-seal-")); roots.push(root)
  git(root, "init")
  git(root, "config", "user.email", "test@example.invalid")
  git(root, "config", "user.name", "Delivery Seal Test")
  git(root, "remote", "add", "origin", "https://github.com/bsvalues/terragroq.git")
  fs.mkdirSync(path.join(root, "src"))
  fs.writeFileSync(path.join(root, "src", "selected.ts"), "export const value = 1\n")
  git(root, "add", "src/selected.ts")
  git(root, "commit", "-m", "base")
  const baseSha = git(root, "rev-parse", "HEAD")
  fs.writeFileSync(path.join(root, "src", "selected.ts"), "export const value = 2\n")
  git(root, "add", "src/selected.ts")
  git(root, "commit", "-m", "change")
  return { root, baseSha, commitSha: git(root, "rev-parse", "HEAD") }
}

describe("delivery commit inspection", () => {
  it("measures the canonical repository, exact descendant commit, selected path, and stable patch digest", async () => {
    const repo = repository()
    const measured = await inspectGitDelivery(repo.root, repo.baseSha, repo.commitSha, ["src/selected.ts"])
    expect(measured).toMatchObject({
      repository: "https://github.com/bsvalues/terragroq",
      baseSha: repo.baseSha,
      commitSha: repo.commitSha,
      paths: ["src/selected.ts"],
    })
    expect(measured.patchDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it.runIf(process.platform === "win32")("accepts the same Windows worktree root with different path casing", async () => {
    const repo = repository()
    const measured = await inspectGitDelivery(repo.root.toUpperCase(), repo.baseSha, repo.commitSha, ["src/selected.ts"])
    expect(measured).toMatchObject({ commitSha: repo.commitSha, paths: ["src/selected.ts"] })
  })

  it("refuses a commit whose selected assignment path has no delivered patch", async () => {
    const repo = repository()
    await expect(inspectGitDelivery(repo.root, repo.baseSha, repo.commitSha, ["src/missing.ts"]))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_DIFF_INVALID" })
  })

  it.each([
    ["leading dot segment", "./src/selected.ts"],
    ["backslash separator", "src\\selected.ts"],
    ["surrounding whitespace", " src/selected.ts "],
    ["asterisk wildcard", "src/*.ts"],
    ["question-mark wildcard", "src/selected?.ts"],
  ])("rejects a noncanonical %s authority path", async (_label, deliveryPath) => {
    const repo = repository()
    await expect(inspectGitDelivery(repo.root, repo.baseSha, repo.commitSha, [deliveryPath]))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_DIFF_INVALID" })
  })

  it("rejects duplicate authority path claims instead of collapsing them", async () => {
    const repo = repository()
    await expect(inspectGitDelivery(
      repo.root,
      repo.baseSha,
      repo.commitSha,
      ["src/selected.ts", "src/selected.ts"],
      { allowMultiple: true },
    )).rejects.toMatchObject({ code: "DELIVERY_SEAL_DIFF_INVALID" })
  })

  it("measures an exact deleted path with a deterministic head-absent representation", async () => {
    const repo = repository()
    fs.unlinkSync(path.join(repo.root, "src", "selected.ts"))
    git(repo.root, "add", "src/selected.ts")
    git(repo.root, "commit", "-m", "delete selected path")
    const deletedHead = git(repo.root, "rev-parse", "HEAD")

    const first = await inspectGitDelivery(repo.root, repo.commitSha, deletedHead, ["src/selected.ts"])
    const second = await inspectGitDelivery(repo.root, repo.commitSha, deletedHead, ["src/selected.ts"])
    expect(first).toMatchObject({ commitSha: deletedHead, paths: ["src/selected.ts"] })
    expect(first.contentDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(second.contentDigest).toBe(first.contentDigest)
  })

  it("measures both exact paths of a rename without collapsing the source", async () => {
    const repo = repository()
    fs.renameSync(path.join(repo.root, "src", "selected.ts"), path.join(repo.root, "src", "renamed.ts"))
    git(repo.root, "add", "-A", "src")
    git(repo.root, "commit", "-m", "rename selected path")
    const renamedHead = git(repo.root, "rev-parse", "HEAD")

    const measured = await inspectGitDelivery(
      repo.root,
      repo.commitSha,
      renamedHead,
      ["src/selected.ts", "src/renamed.ts"],
      { allowMultiple: true },
    )
    expect(measured).toMatchObject({ commitSha: renamedHead, paths: ["src/renamed.ts", "src/selected.ts"] })
  })

  it("treats a bracketed Next route as a literal Git pathspec", async () => {
    const repo = repository()
    const dynamicRoute = "app/api/environment/spaces/[worldId]/route.ts"
    const globMatch = "app/api/environment/spaces/w/route.ts"
    for (const deliveryPath of [dynamicRoute, globMatch]) {
      fs.mkdirSync(path.dirname(path.join(repo.root, deliveryPath)), { recursive: true })
      fs.writeFileSync(path.join(repo.root, deliveryPath), "export const value = 1\n")
    }
    git(repo.root, "--literal-pathspecs", "add", "--", dynamicRoute, globMatch)
    git(repo.root, "commit", "-m", "add bracketed route fixture")
    const bracketBase = git(repo.root, "rev-parse", "HEAD")
    fs.writeFileSync(path.join(repo.root, dynamicRoute), "export const value = 2\n")
    fs.writeFileSync(path.join(repo.root, globMatch), "export const value = 3\n")
    git(repo.root, "--literal-pathspecs", "add", "--", dynamicRoute, globMatch)
    git(repo.root, "commit", "-m", "change bracketed route and glob lookalike")
    const bracketHead = git(repo.root, "rev-parse", "HEAD")

    await expect(inspectGitDelivery(repo.root, bracketBase, bracketHead, [dynamicRoute]))
      .resolves.toMatchObject({ paths: [dynamicRoute], commitSha: bracketHead })
  })
})
