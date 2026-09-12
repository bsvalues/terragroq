import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { integrationTree } from "../scripts/execution-fabric/integrate-lab-main.mjs"

/**
 * Integration content semantics. The lab integration must advance main by MERGING the candidate's
 * sealed change onto whatever main already holds — not by adopting the candidate's tree wholesale.
 * Observed failure (2026-09-12, #1231): the candidate branched from 15667803 while main already
 * held #1229 at 9f10645b, and the wholesale tree silently reverted #1229's script changes. The
 * mirror's squash merge applied the PR delta and got it right, so the lab authority must too.
 */
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "integration-merge-"))
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
  g("init", "-q", "-b", "main")
  g("config", "user.email", "test@lab")
  g("config", "user.name", "test")
  return dir
}
function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
}
function write(dir: string, file: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), body)
}
function commit(dir: string, message: string): string {
  git(dir, "add", "-A")
  git(dir, "commit", "-qm", message)
  return git(dir, "rev-parse", "HEAD")
}
function treeEntry(dir: string, rev: string, file: string): string {
  try {
    return git(dir, "rev-parse", `${rev}:${file}`)
  } catch {
    return "(absent)"
  }
}

describe("integration merge semantics", () => {
  it("adopts the candidate tree when main is an ancestor (fast-forward)", () => {
    const dir = repo()
    write(dir, "slice.txt", "candidate\n")
    const cand = commit(dir, "cand")
    const out = integrationTree({ baseSha: cand, candSha: cand, labMainBefore: cand, sealedPaths: ["slice.txt"], cwd: dir })
    expect(out.mode).toBe("FAST_FORWARD")
    expect(out.tree).toBe(git(dir, "rev-parse", `${cand}^{tree}`))
  })

  it("preserves work that landed on main after the candidate branched (#1231 regression shape)", () => {
    const dir = repo()
    // base: the world the candidate branched from
    write(dir, "scripts/deploy.ps1", "old\n")
    const base = commit(dir, "base")
    // candidate: a sealed change to unrelated files (the authority surface slice)
    git(dir, "checkout", "-q", "-b", "cand")
    write(dir, "lib/surface.ts", "surface\n")
    const cand = commit(dir, "candidate slice")
    // meanwhile main gained an unrelated sealed integration (#1229 shape)
    git(dir, "checkout", "-q", "main")
    write(dir, "scripts/deploy.ps1", "old\n+two-phase guard\n")
    write(dir, "tests/deploy.test.ts", "guard test\n")
    const labMain = commit(dir, "integrate #1229")

    const out = integrationTree({
      baseSha: base, candSha: cand, labMainBefore: labMain,
      sealedPaths: ["lib/surface.ts", "tests/sovereign-authority-surface.test.ts"], cwd: dir,
    })
    expect(out.mode).toBe("THREE_WAY_MERGE")
    // the candidate's sealed change is present…
    expect(treeEntry(dir, out.tree, "lib/surface.ts")).toBe(treeEntry(dir, cand, "lib/surface.ts"))
    // …and main's newer work is NOT reverted (the wholesale-tree bug failed exactly here)
    expect(treeEntry(dir, out.tree, "scripts/deploy.ps1")).toBe(treeEntry(dir, labMain, "scripts/deploy.ps1"))
    expect(treeEntry(dir, out.tree, "tests/deploy.test.ts")).toBe(treeEntry(dir, labMain, "tests/deploy.test.ts"))
  })

  it("refuses typed when the merge conflicts instead of silently picking a side", () => {
    const dir = repo()
    write(dir, "shared.ts", "one\n")
    const base = commit(dir, "base")
    git(dir, "checkout", "-q", "-b", "cand")
    write(dir, "shared.ts", "candidate\n")
    const cand = commit(dir, "cand edit")
    git(dir, "checkout", "-q", "main")
    write(dir, "shared.ts", "main\n")
    const labMain = commit(dir, "main edit")

    expect(() => integrationTree({
      baseSha: base, candSha: cand, labMainBefore: labMain, sealedPaths: ["shared.ts"], cwd: dir,
    })).toThrow(/INTEGRATION_MERGE_CONFLICT/)
  })

  it("refuses when the candidate is not a descendant of its sealed base", () => {
    const dir = repo()
    write(dir, "a.ts", "a\n")
    const base = commit(dir, "base")
    write(dir, "b.ts", "b\n")
    const other = commit(dir, "unrelated")
    expect(() => integrationTree({
      baseSha: base, candSha: other, labMainBefore: base, sealedPaths: ["b.ts"], cwd: dir,
    })).not.toThrow() // `other` IS a descendant of base; the guard is about unrelated histories
    git(dir, "checkout", "-q", "--orphan", "orphan")
    write(dir, "c.ts", "c\n")
    const orphan = commit(dir, "orphan")
    expect(() => integrationTree({
      baseSha: base, candSha: orphan, labMainBefore: base, sealedPaths: ["c.ts"], cwd: dir,
    })).toThrow(/BASE_NOT_CANDIDATE_ANCESTOR/)
  })
})
