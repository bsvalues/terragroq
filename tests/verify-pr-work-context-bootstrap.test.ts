import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

const temporaryRoots: string[] = []

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true })
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("pull-request delivery verifier bootstrap", () => {
  it("opts the protected verifier into exact multi-path artifact measurement", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts", "verify-pr-work-context.mjs"), "utf8")
    expect(source).toMatch(/seal\.payload\.delivery\.paths,\s*\{\s*allowMultiple:\s*true\s*\}/)
  })

  it("reaches a controlled seal verdict in a clean checkout without application dependencies", () => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-delivery-bootstrap-"))
    temporaryRoots.push(container)
    const checkout = path.join(container, "checkout")
    const origin = path.join(container, "origin.git")
    fs.mkdirSync(path.join(checkout, "scripts"), { recursive: true })
    fs.mkdirSync(path.join(checkout, "lib", "governance"), { recursive: true })

    for (const relative of [
      "scripts/verify-pr-work-context.mjs",
      "lib/governance/pr-receipt.ts",
      "lib/governance/delivery-seal.ts",
      "lib/governance/git-delivery.ts",
    ]) {
      fs.copyFileSync(path.join(process.cwd(), relative), path.join(checkout, relative))
    }

    git(checkout, "init", "--initial-branch=main")
    git(checkout, "config", "user.name", "WilliamOS test")
    git(checkout, "config", "user.email", "williamos-test@example.invalid")
    git(checkout, "add", ".")
    git(checkout, "commit", "-m", "bootstrap fixture")
    execFileSync("git", ["init", "--bare", origin], { encoding: "utf8", windowsHide: true })
    git(checkout, "remote", "add", "origin", origin)
    git(checkout, "push", "-u", "origin", "main")

    const result = spawnSync(process.execPath, ["--no-warnings", "scripts/verify-pr-work-context.mjs"], {
      cwd: checkout,
      encoding: "utf8",
      env: { ...process.env, GITHUB_EVENT_PATH: "" },
    })

    expect(fs.existsSync(path.join(checkout, "node_modules"))).toBe(false)
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND")
    expect(result.stderr).toContain("FAILED_CONTEXT_NOT_PROVEN")
    expect(result.status).toBe(1)
  })
})
