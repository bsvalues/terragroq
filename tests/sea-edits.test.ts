import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { applyEditSet, validateEditSet } from "../scripts/hermes-bridge/sea-edits.mjs"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function workspace(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sea-edits-")); roots.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return root
}

const read = (root: string, relative: string) => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8")

describe("SEA edit validation", () => {
  it("accepts a well-formed edit whose oldText occurs exactly once", () => {
    const root = workspace({ "a.txt": "alpha\nbeta\ngamma\n" })
    const result = validateEditSet([{ path: "a.txt", oldText: "beta", newText: "delta" }], root)
    expect(result.ok).toBe(true)
  })

  it("rejects an oldText that matches more than once, and reports the count", () => {
    // The battery's hard failure: asked to change a setting appearing twice, the model returned an
    // oldText matching 2 locations. The count is part of the error because the repair loop needs to
    // tell the model "matched 2 locations, add surrounding context".
    const root = workspace({ "compose.yaml": "a:\n  pids_limit: 512\nb:\n  pids_limit: 512\n" })
    const result = validateEditSet([{ path: "compose.yaml", oldText: "  pids_limit: 512", newText: "  pids_limit: 256" }], root)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({ code: "SEA_OLDTEXT_AMBIGUOUS", occurrences: 2, index: 0 })
  })

  it("rejects an oldText that is not present at all", () => {
    const root = workspace({ "a.txt": "alpha\n" })
    const result = validateEditSet([{ path: "a.txt", oldText: "nope", newText: "x" }], root)
    expect(result.errors[0]).toMatchObject({ code: "SEA_OLDTEXT_NOT_FOUND", occurrences: 0 })
  })

  it("rejects a missing newText, which the model omitted entirely in the battery", () => {
    const root = workspace({ "a.txt": "alpha\n" })
    const result = validateEditSet([{ path: "a.txt", oldText: "alpha" } as never], root)
    expect(result.errors[0]).toMatchObject({ code: "SEA_EDIT_SHAPE" })
  })

  it("accepts an empty newText as a deletion, which is different from a missing one", () => {
    const root = workspace({ "a.txt": "alpha\nbeta\n" })
    expect(validateEditSet([{ path: "a.txt", oldText: "beta\n", newText: "" }], root).ok).toBe(true)
  })

  it("refuses paths that escape the workspace", () => {
    const root = workspace({ "a.txt": "alpha\n" })
    for (const escape of ["../outside.txt", "sub/../../outside.txt", "C:\\Windows\\system32\\drivers\\etc\\hosts", "/etc/passwd"]) {
      const result = validateEditSet([{ path: escape, oldText: "x", newText: "y" }], root)
      expect(result.ok).toBe(false)
      expect(["SEA_PATH_OUTSIDE_ROOT", "SEA_PATH_NOT_FOUND"]).toContain(result.errors[0].code)
    }
  })

  it("refuses two edits whose matched regions overlap", () => {
    const root = workspace({ "a.txt": "alpha beta gamma\n" })
    const result = validateEditSet([
      { path: "a.txt", oldText: "alpha beta", newText: "x" },
      { path: "a.txt", oldText: "beta gamma", newText: "y" },
    ], root)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({ code: "SEA_EDITS_OVERLAP" })
  })

  it("accepts two non-overlapping edits in the same file", () => {
    const root = workspace({ "a.txt": "alpha\nbeta\ngamma\n" })
    expect(validateEditSet([
      { path: "a.txt", oldText: "alpha", newText: "ALPHA" },
      { path: "a.txt", oldText: "gamma", newText: "GAMMA" },
    ], root).ok).toBe(true)
  })

  it("matches regardless of the line endings the model used", () => {
    // The battery's other finding: the model sent \r\n in oldText but \n in newText. Matching must
    // not depend on the model guessing the file's convention.
    const root = workspace({ "crlf.txt": "one\r\ntwo\r\nthree\r\n" })
    expect(validateEditSet([{ path: "crlf.txt", oldText: "one\ntwo", newText: "ONE\nTWO" }], root).ok).toBe(true)
    const lf = workspace({ "lf.txt": "one\ntwo\nthree\n" })
    expect(validateEditSet([{ path: "lf.txt", oldText: "one\r\ntwo", newText: "X" }], lf).ok).toBe(true)
  })
})

describe("SEA edit application", () => {
  it("applies a validated set and returns the changed paths", () => {
    const root = workspace({ "a.txt": "alpha\nbeta\n" })
    const result = applyEditSet([{ path: "a.txt", oldText: "beta", newText: "delta" }], root)
    expect(result.ok).toBe(true)
    expect(result.changedPaths).toEqual(["a.txt"])
    expect(read(root, "a.txt")).toBe("alpha\ndelta\n")
  })

  it("writes newText using the file's own line endings, not the model's", () => {
    const root = workspace({ "crlf.txt": "one\r\ntwo\r\n" })
    applyEditSet([{ path: "crlf.txt", oldText: "one\r\ntwo", newText: "one\nTWO\nthree" }], root)
    const after = read(root, "crlf.txt")
    expect(after).toBe("one\r\nTWO\r\nthree\r\n")
    expect(after).not.toMatch(/[^\r]\n/)
  })

  it("applies several edits to one file against original offsets", () => {
    const root = workspace({ "a.txt": "alpha\nbeta\ngamma\n" })
    applyEditSet([
      { path: "a.txt", oldText: "alpha", newText: "AAAAAAAAAA" },
      { path: "a.txt", oldText: "gamma", newText: "G" },
    ], root)
    expect(read(root, "a.txt")).toBe("AAAAAAAAAA\nbeta\nG\n")
  })

  it("writes nothing at all when any edit in the set is invalid", () => {
    // "an invalid edit rolls back with no partial write" — WO §4's acceptance criterion. The whole
    // set is validated before a single byte is written.
    const root = workspace({ "a.txt": "alpha\n", "b.txt": "beta\n" })
    const result = applyEditSet([
      { path: "a.txt", oldText: "alpha", newText: "CHANGED" },
      { path: "b.txt", oldText: "absent", newText: "x" },
    ], root)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({ code: "SEA_OLDTEXT_NOT_FOUND" })
    expect(read(root, "a.txt")).toBe("alpha\n")
    expect(read(root, "b.txt")).toBe("beta\n")
  })

  it("restores every file it already wrote when a later write fails", () => {
    const root = workspace({ "a.txt": "alpha\n", "b.txt": "beta\n" })
    const failing = {
      ...fs,
      writeFileSync: (target: fs.PathLike | number, data: string | NodeJS.ArrayBufferView, options?: unknown) => {
        if (String(target).includes("b.txt")) throw new Error("disk full")
        return (fs.writeFileSync as never as typeof fs.writeFileSync)(target as fs.PathOrFileDescriptor, data, options as never)
      },
    } as unknown as typeof fs
    const result = applyEditSet([
      { path: "a.txt", oldText: "alpha", newText: "CHANGED" },
      { path: "b.txt", oldText: "beta", newText: "ALSO" },
    ], root, { fsApi: failing })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({ code: "SEA_APPLY_FAILED" })
    expect(read(root, "a.txt")).toBe("alpha\n")
    expect(read(root, "b.txt")).toBe("beta\n")
  })

  it("refuses an empty edit set rather than silently succeeding", () => {
    const root = workspace({ "a.txt": "alpha\n" })
    const result = applyEditSet([], root)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({ code: "SEA_NO_EDITS" })
  })
})
