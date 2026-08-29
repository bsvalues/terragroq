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

  it("refuses a commit whose selected assignment path has no delivered patch", async () => {
    const repo = repository()
    await expect(inspectGitDelivery(repo.root, repo.baseSha, repo.commitSha, ["src/missing.ts"]))
      .rejects.toMatchObject({ code: "DELIVERY_SEAL_DIFF_INVALID" })
  })
})
