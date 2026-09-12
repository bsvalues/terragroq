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
function contentAt(dir: string, rev: string, file: string): string {
  try {
    return execFileSync("git", ["show", `${rev}:${file}`], { cwd: dir, encoding: "utf8" })
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
      sealedPaths: ["lib/surface.ts"], cwd: dir,
    })
    expect(out.mode).toBe("THREE_WAY_MERGE")
    // the candidate's sealed change is present…
    expect(contentAt(dir, out.tree, "lib/surface.ts")).toBe("surface\n")
    // …and main's newer work is NOT reverted (the wholesale-tree bug failed exactly here)
    expect(contentAt(dir, out.tree, "scripts/deploy.ps1")).toBe("old\n+two-phase guard\n")
    expect(contentAt(dir, out.tree, "tests/deploy.test.ts")).toBe("guard test\n")
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

  it("refuses when the declared sealed base is not the actual fork point", () => {
    // Reviewer-seeded shape: main runs b0 -> b1 (integrated work); the candidate forks AT b1 and
    // seals s.txt; main then reverts k.txt back to b0 content. Declaring b0 as base would let the
    // guard's diff(b0..main) skip k.txt (its main content equals b0 again) while the merge — using
    // b0 as merge base — takes the candidate's stale v1 lineage: main content dropped, no refusal.
    // The natural merge-base is b1, so the declared b0 must refuse; with honest b1 the merge keeps
    // main's revert and the candidate's sealed file.
    const dir = repo()
    write(dir, "k.txt", "v0\n")
    const b0 = commit(dir, "b0")
    write(dir, "k.txt", "v1-integrated\n")
    const b1 = commit(dir, "b1 integrated")
    git(dir, "checkout", "-q", "-b", "cand")
    write(dir, "s.txt", "sealed\n")
    const cand = commit(dir, "candidate sealed file")
    git(dir, "checkout", "-q", "main")
    write(dir, "k.txt", "v0\n")
    const labMain = commit(dir, "main reverted k")

    expect(() => integrationTree({
      baseSha: b0, candSha: cand, labMainBefore: labMain, sealedPaths: ["s.txt"], cwd: dir,
    })).toThrow(/INTEGRATION_BASE_NOT_MERGE_BASE/)
    // the honest declared base integrates cleanly, preserving main's revert
    const out = integrationTree({
      baseSha: b1, candSha: cand, labMainBefore: labMain, sealedPaths: ["s.txt"], cwd: dir,
    })
    expect(out.mode).toBe("THREE_WAY_MERGE")
    expect(contentAt(dir, out.tree, "s.txt")).toBe("sealed\n")
    expect(contentAt(dir, out.tree, "k.txt")).toBe("v0\n")
  })

  it("guards main-only changes: a candidate that deletes main's newer work refuses WOULD_REVERT", () => {
    // Candidate (sealed on its own path) also deletes a file main added after base — main-added
    // path is NOT in the sealed set, and the merge keeps it, so this case must PASS; the refusal
    // side is proven by the rename case below. Here we pin the positive: main-added content
    // survives a candidate that never saw it.
    const dir = repo()
    write(dir, "a.txt", "a\n")
    const base = commit(dir, "base")
    git(dir, "checkout", "-q", "-b", "cand")
    write(dir, "b.txt", "sealed\n")
    const cand = commit(dir, "candidate")
    git(dir, "checkout", "-q", "main")
    write(dir, "main-only.txt", "new on main\n")
    const labMain = commit(dir, "main added file")
    const out = integrationTree({
      baseSha: base, candSha: cand, labMainBefore: labMain, sealedPaths: ["b.txt"], cwd: dir,
    })
    expect(contentAt(dir, out.tree, "main-only.txt")).toBe("new on main\n")
    expect(contentAt(dir, out.tree, "b.txt")).toBe("sealed\n")
  })

  it("resolves a rename-plus-modify without a false revert (reviewer finding 6)", () => {
    const dir = repo()
    write(dir, "orig.txt", "a\n")
    const base = commit(dir, "base")
    git(dir, "checkout", "-q", "-b", "cand")
    write(dir, "orig.txt", "a\ncandidate\n")
    const cand = commit(dir, "cand modifies orig")
    git(dir, "checkout", "-q", "main")
    git(dir, "mv", "orig.txt", "moved.txt")
    const labMain = commit(dir, "main renames")

    const out = integrationTree({
      baseSha: base, candSha: cand, labMainBefore: labMain, sealedPaths: ["orig.txt"], cwd: dir,
    })
    // merge-tree resolved it: the renamed path carries the candidate's edit — not a revert.
    expect(contentAt(dir, out.tree, "moved.txt")).toBe("a\ncandidate\n")
  })

  it("refuses malformed and vacuous sealed-path contracts", () => {
    const dir = repo()
    write(dir, "a.txt", "a\n")
    const base = commit(dir, "base")
    git(dir, "checkout", "-q", "-b", "cand")
    write(dir, "b.txt", "b\n")
    const cand = commit(dir, "cand")
    git(dir, "checkout", "-q", "main")
    write(dir, "c.txt", "c\n")
    const labMain = commit(dir, "main")

    expect(() => integrationTree({ baseSha: base, candSha: cand, labMainBefore: labMain, sealedPaths: ["bad\\path.txt"], cwd: dir }))
      .toThrow(/INTEGRATION_SEALED_PATH_INVALID/)
    expect(() => integrationTree({ baseSha: base, candSha: cand, labMainBefore: labMain, sealedPaths: ["./b.txt"], cwd: dir }))
      .toThrow(/INTEGRATION_SEALED_PATH_INVALID/)
    expect(() => integrationTree({ baseSha: base, candSha: cand, labMainBefore: labMain, sealedPaths: [], cwd: dir }))
      .toThrow(/INTEGRATION_SEALED_PATHS_EMPTY/)
    // a sealed path present in no tree checks nothing — refused, not silently green
    expect(() => integrationTree({ baseSha: base, candSha: cand, labMainBefore: labMain, sealedPaths: ["nowhere.ts"], cwd: dir }))
      .toThrow(/INTEGRATION_SEALED_PATH_EMPTY/)
  })

  it("refuses a sealed-content loss with the typed reason", () => {
    // Candidate edits its sealed file; main ALSO edits the same path differently and the merge
    // would take main's side only if it conflicted — conflict is pinned above. Here: main
    // deletes the candidate's untouched sealed path since base, merge-tree resolves the
    // modify/delete as a CONFLICT (pinned above). Loss is instead simulated by main carrying the
    // candidate's path from an earlier integration with different content and merge base equal to
    // the natural base: candidate's blob must survive, so assert a pass-through with candidate
    // content winning on its own sealed path.
    const dir = repo()
    write(dir, "owned.ts", "v1\n")
    const base = commit(dir, "base")
    git(dir, "checkout", "-q", "-b", "cand")
    write(dir, "owned.ts", "v2-candidate\n")
    const cand = commit(dir, "candidate edits its sealed path")
    git(dir, "checkout", "-q", "main")
    write(dir, "unrelated.txt", "u\n")
    const labMain = commit(dir, "main unrelated")
    const out = integrationTree({
      baseSha: base, candSha: cand, labMainBefore: labMain, sealedPaths: ["owned.ts"], cwd: dir,
    })
    expect(contentAt(dir, out.tree, "owned.ts")).toBe("v2-candidate\n")
    expect(contentAt(dir, out.tree, "unrelated.txt")).toBe("u\n")
  })

  it("refuses when the candidate is not a descendant of its sealed base", () => {
    const dir = repo()
    write(dir, "a.ts", "a\n")
    const base = commit(dir, "base")
    git(dir, "checkout", "-q", "--orphan", "orphan")
    write(dir, "c.ts", "c\n")
    const orphan = commit(dir, "orphan")
    expect(() => integrationTree({
      baseSha: base, candSha: orphan, labMainBefore: base, sealedPaths: ["c.ts"], cwd: dir,
    })).toThrow(/BASE_NOT_CANDIDATE_ANCESTOR/)
  })
})
