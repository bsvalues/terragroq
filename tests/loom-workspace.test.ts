import { describe, expect, it } from "vitest"

import { isIgnoredEntry, looksBinary, resolveWorkspacePath } from "@/lib/loom/workspace"
import { LOOM_OPERATIONS, resolveLoomOperation } from "@/lib/loom/operations"

const ROOT = process.platform === "win32" ? "C:\\work\\repo" : "/work/repo"

describe("workspace path containment", () => {
  it("resolves ordinary paths inside the workspace", () => {
    const result = resolveWorkspacePath(ROOT, "lib/loom/operations.ts")
    expect(result.ok).toBe(true)
    expect(result.relative).toBe("lib/loom/operations.ts")
  })

  it("treats an empty path as the workspace root", () => {
    for (const value of ["", ".", "  "]) {
      const result = resolveWorkspacePath(ROOT, value)
      expect(result.ok).toBe(true)
      expect(result.relative).toBe("")
    }
  })

  it("refuses to climb out of the workspace", () => {
    for (const value of ["../secrets", "lib/../../secrets", "a/b/../../../etc/passwd", "..", "../"]) {
      expect(resolveWorkspacePath(ROOT, value)).toMatchObject({ ok: false, refusal: "PATH_ESCAPES_WORKSPACE" })
    }
  })

  it("refuses absolute, drive-qualified, UNC and NUL-bearing paths", () => {
    for (const value of ["/etc/passwd", "C:\\Windows\\System32", "//server/share", "lib/a\0b"]) {
      expect(resolveWorkspacePath(ROOT, value).ok).toBe(false)
    }
  })

  it("refuses a sibling directory that merely shares the root's prefix", () => {
    // path.resolve of "../repo-backup/x" lands next to the root, not inside it. Comparing without a
    // trailing separator would accept this, which is the classic containment bug.
    expect(resolveWorkspacePath(ROOT, "../repo-backup/secret").ok).toBe(false)
  })

  it("refuses non-strings rather than coercing them", () => {
    for (const value of [null, undefined, 7, {}, ["lib"]]) {
      expect(resolveWorkspacePath(ROOT, value)).toMatchObject({ ok: false, refusal: "PATH_INVALID" })
    }
  })

  it("normalises windows separators so both spellings reach the same file", () => {
    expect(resolveWorkspacePath(ROOT, "lib\\loom\\workspace.ts").relative).toBe("lib/loom/workspace.ts")
  })
})

describe("workspace listing and content", () => {
  it("hides the directories that would swamp the tree", () => {
    expect(isIgnoredEntry("node_modules")).toBe(true)
    expect(isIgnoredEntry(".git")).toBe(true)
    expect(isIgnoredEntry(".next")).toBe(true)
    expect(isIgnoredEntry("lib")).toBe(false)
  })

  it("detects binary content by NUL rather than by extension", () => {
    expect(looksBinary(new TextEncoder().encode("export const a = 1\n"))).toBe(false)
    expect(looksBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x00, 0x41]))).toBe(true)
    expect(looksBinary(new Uint8Array())).toBe(false)
  })
})

describe("operation catalogue", () => {
  it("refuses anything not in the catalogue", () => {
    for (const value of ["rm -rf /", "repo.status; whoami", "", null, 42]) {
      expect(resolveLoomOperation(value)).toMatchObject({ ok: false, refusal: "UNKNOWN_OPERATION" })
    }
  })

  it("will not run a mutating operation without explicit confirmation", () => {
    const mutating = LOOM_OPERATIONS.find((operation) => operation.mutating)
    expect(mutating).toBeDefined()
    expect(resolveLoomOperation(mutating!.id)).toMatchObject({ ok: false, refusal: "CONFIRMATION_REQUIRED" })
    expect(resolveLoomOperation(mutating!.id, { confirmed: true }).ok).toBe(true)
    // Only a real boolean counts; a truthy string arriving from JSON must not authorise a mutation.
    expect(resolveLoomOperation(mutating!.id, { confirmed: "yes" as unknown as boolean }).ok).toBe(false)
  })

  it("never routes an operation through a shell interpreter", () => {
    for (const operation of LOOM_OPERATIONS) {
      expect(["git", "node", "powershell"]).toContain(operation.command)
      expect(operation.args.every((argument) => typeof argument === "string")).toBe(true)
    }
  })
})
