import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

/**
 * WO-0030 produced a working lane integration across four files and was discarded whole because one
 * test fixture contained `postgres://user:pw@host/db`. The wall was right to refuse the patch. Throwing
 * away the run was not: the offending line is something the worker added and can remove, which is what
 * the remediation loop is for.
 *
 * The rule is still fail-closed. It refuses, it says which rule refused, it never repeats what matched,
 * and the existing remediation cap still stops a lane that keeps reintroducing the same material.
 */
const KERNEL = new URL("../scripts/runtime-operator/operational-kernel.mjs", import.meta.url)
const SOURCE = fs.readFileSync(KERNEL, "utf8")

function evaluateNamed(name: string): (message: string) => boolean {
  const start = SOURCE.indexOf(`function ${name}(message) {`)
  if (start < 0) throw new Error(`${name} not found`)
  const end = SOURCE.indexOf("\n}", start) + 2
  // eslint-disable-next-line no-eval
  return eval(`(${SOURCE.slice(start, end)})`) as (message: string) => boolean
}

describe("which patch walls a worker can answer for", () => {
  const isRemediablePatchWall = evaluateNamed("isRemediablePatchWall")

  it("treats content refusals as the worker's to fix", () => {
    for (const wall of [
      "PATCH_SECRET_OR_BINARY_WALL",
      "PATCH_EXACT_PATH_WALL",
      "PATCH_BUDGET_WALL",
      "PATCH_SYMLINK_OR_SUBMODULE_WALL",
      "PATCH_REVIEW_CORRELATION_WALL",
    ]) {
      expect(isRemediablePatchWall(wall)).toBe(true)
    }
  })

  it("does not swallow walls that are not about patch content", () => {
    for (const wall of [
      "PATCH_EMPTY_WALL",
      "CODEX_PATCH_REQUIRED_WALL",
      "AUTHORITY_OWNER_GATE_WALL",
      "RUNTIME_READINESS_WALL",
      "VALIDATION_TEST_WALL",
    ]) {
      expect(isRemediablePatchWall(wall)).toBe(false)
    }
  })
})

describe("what the worker is told", () => {
  const workspaces: string[] = []

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) fs.rmSync(workspace, { recursive: true, force: true })
  })

  function feedbackFor(message: string): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "patch-wall-"))
    workspaces.push(workspace)
    const start = SOURCE.indexOf("function writePatchWallFeedback(workspace, message) {")
    const end = SOURCE.indexOf("\n}", SOURCE.indexOf("} catch { /* feedback is best effort", start)) + 2
    // eslint-disable-next-line no-eval
    const write = eval(`((fs, path) => (${SOURCE.slice(start, end)}))`)(fs, path)
    write(workspace, message)
    return fs.readFileSync(path.join(workspace, ".williamos", "validation-feedback.txt"), "utf8")
  }

  it("names the rule that refused the patch", () => {
    const feedback = feedbackFor("PATCH_SECRET_OR_BINARY_WALL")
    expect(feedback).toContain("PATCH_SECRET_OR_BINARY_WALL")
    expect(feedback).toContain("credential pattern")
  })

  it("never repeats what matched, because it may be a real credential", () => {
    // A wall that catches a secret must not become the thing that copies it into the worktree the
    // worker reads from and may echo back.
    const feedback = feedbackFor("PATCH_SECRET_OR_BINARY_WALL")
    expect(feedback).not.toMatch(/postgres:\/\/|sk-[A-Za-z0-9]|ghp_[A-Za-z0-9]/)
    expect(feedback).toContain("deliberately not repeated")
  })

  it("tells a boundary escape to revert, not to widen", () => {
    expect(feedbackFor("PATCH_EXACT_PATH_WALL")).toContain("only the reserved paths")
  })

  it("writes something even for a wall it has no specific guidance for", () => {
    expect(feedbackFor("PATCH_BUDGET_WALL")).toContain("PATCH_BUDGET_WALL")
  })
})
