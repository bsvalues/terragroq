import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { integrationTree, localTestEvidence } from "../scripts/execution-fabric/integrate-lab-main.mjs"

/**
 * Follow-up hardening tests (owner-acknowledged 2026-09-12, after #1232's first live integration):
 *   1. the coincidental-twin rename allowance is DECLARED behavior, pinned both ways;
 *   3. the local full-suite record is parsed, success-checked, suite-identified and head-bound;
 *   5. a candidate sharing no ancestor with lab main refuses TYPED.
 */
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "integration-followups-"))
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

describe("follow-up 1: coincidental-twin rename allowance is declared behavior", () => {
  it("integrates when main deleted a sealed path and an identical blob exists elsewhere (twin)", () => {
    const dir = repo()
    write(dir, "shared-boiler.txt", "boiler\n")
    const base = commit(dir, "base")
    // candidate seals the file WITHOUT touching it: its blob at the sealed path is base's blob.
    git(dir, "checkout", "-q", "-b", "cand")
    write(dir, "own.txt", "own\n")
    const cand = commit(dir, "cand own file")
    // main deletes the sealed path and coincidentally materializes the same content elsewhere.
    git(dir, "checkout", "-q", "main")
    git(dir, "rm", "-q", "shared-boiler.txt")
    write(dir, "twin.txt", "boiler\n")
    const labMain = commit(dir, "main: delete sealed path, add coincidental twin")
    const out = integrationTree({
      baseSha: base, candSha: cand, labMainBefore: labMain, sealedPaths: ["shared-boiler.txt"], cwd: dir,
    })
    expect(out.mode).toBe("THREE_WAY_MERGE")
    // The deletion of the sealed path is preserved and the twin carries the content.
    expect(contentAt(dir, out.tree, "shared-boiler.txt")).toBe("(absent)")
    expect(contentAt(dir, out.tree, "twin.txt")).toBe("boiler\n")
  })

  it("refuses the same shape when no identical blob exists anywhere (control)", () => {
    const dir = repo()
    write(dir, "shared-boiler.txt", "boiler\n")
    const base = commit(dir, "base")
    git(dir, "checkout", "-q", "-b", "cand")
    write(dir, "own.txt", "own\n")
    const cand = commit(dir, "cand own file")
    git(dir, "checkout", "-q", "main")
    git(dir, "rm", "-q", "shared-boiler.txt")
    write(dir, "unrelated.txt", "different\n")
    const labMain = commit(dir, "main: delete sealed path, unrelated content")
    expect(() => integrationTree({
      baseSha: base, candSha: cand, labMainBefore: labMain, sealedPaths: ["shared-boiler.txt"], cwd: dir,
    })).toThrow(/INTEGRATION_SEALED_CONTENT_LOST/)
  })
})

describe("follow-up 5: disjoint lineage refuses typed", () => {
  it("refuses INTEGRATION_BASE_UNRELATED when candidate shares no ancestor with lab main", () => {
    const dir = repo()
    write(dir, "a.txt", "a\n")
    const labMain = commit(dir, "lab main lineage")
    // A separate root lineage: candidate descends from its own base, unrelated to lab main.
    git(dir, "checkout", "-q", "--orphan", "orphan")
    write(dir, "c.txt", "c\n")
    const orphanBase = commit(dir, "orphan base")
    write(dir, "c.txt", "c2\n")
    const cand = commit(dir, "orphan candidate")
    expect(() => integrationTree({
      baseSha: orphanBase, candSha: cand, labMainBefore: labMain, sealedPaths: ["c.txt"], cwd: dir,
    })).toThrow(/INTEGRATION_BASE_UNRELATED/)
  })
})

describe("follow-up 3: local full-suite evidence is parsed, checked and head-bound", () => {
  const HEAD = "c65f62d900f652471768f071f5f542de7845c21c"
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-tests-"))
  const file = (name: string, body: string): string => {
    const p = path.join(dir, name)
    fs.writeFileSync(p, body)
    return p
  }
  const record = (over: Record<string, unknown> = {}): string => file(`rec-${Math.random().toString(36).slice(2)}.json`, JSON.stringify({
    numTotalTests: 18, numPassedTests: 18, numFailedTests: 0,
    testResults: [{ name: "/repo/tests/integration-merge-semantics.test.ts" }],
    headSha: HEAD,
    ...over,
  }))

  it("accepts a green record bound to the exact candidate head and returns auditable evidence", () => {
    const out = localTestEvidence(record(), HEAD)
    expect(out.total).toBe(18)
    expect(out.passed).toBe(18)
    expect(out.suites).toBe(1)
    expect(out.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
  it("accepts the STAMPED record regardless of case in the sha", () => {
    expect(localTestEvidence(record({ headSha: HEAD.toUpperCase() }), HEAD).total).toBe(18)
  })
  it("refuses a directory, a missing path, and an empty file", () => {
    expect(() => localTestEvidence(dir, HEAD)).toThrow(/LOCAL_TESTS_RECORD_MISSING/)
    expect(() => localTestEvidence(path.join(dir, "nope.json"), HEAD)).toThrow(/LOCAL_TESTS_RECORD_MISSING/)
    expect(() => localTestEvidence(file("empty.json", ""), HEAD)).toThrow(/LOCAL_TESTS_RECORD_UNPARSEABLE/)
  })
  it("refuses a file that happens to exist but is not a test record (package.json vector)", () => {
    expect(() => localTestEvidence("package.json", HEAD)).toThrow(/LOCAL_TESTS_RECORD_UNPARSEABLE/)
  })
  it("refuses a record with failing tests, zero tests, or no named suites", () => {
    expect(() => localTestEvidence(record({ numFailedTests: 1, numPassedTests: 17 }), HEAD)).toThrow(/LOCAL_TESTS_NOT_PASSED/)
    expect(() => localTestEvidence(record({ numTotalTests: 0, numPassedTests: 0 }), HEAD)).toThrow(/LOCAL_TESTS_RECORD_UNPARSEABLE/)
    expect(() => localTestEvidence(record({ testResults: [] }), HEAD)).toThrow(/LOCAL_TESTS_NO_SUITES/)
  })
  it("refuses an unbounded record and a record bound to a different head", () => {
    expect(() => localTestEvidence(record({ headSha: undefined }), HEAD)).toThrow(/LOCAL_TESTS_UNBOUND/)
    expect(() => localTestEvidence(record({ headSha: "a".repeat(40) }), HEAD)).toThrow(/LOCAL_TESTS_HEAD_MISMATCH/)
  })
})
