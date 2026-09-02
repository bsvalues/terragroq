import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it, vi } from "vitest"

import { deriveWorkspaceFileDiff, MAX_WORKSPACE_PATCH_BYTES, streamWorkspacePatch } from "@/lib/loom/workspace-diff"

const execute = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  delete process.env.WILLIAMOS_TERRAFUSION_ROOT
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("server-derived workspace diff grounding", () => {
  it("derives a bounded tracked patch and fingerprint from fixed git argv", async () => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "status") return { stdout: " M src/app.ts\n", stderr: "" }
      if (args[0] === "ls-files" && args[1] === "--error-unmatch") return { stdout: "src/app.ts\n", stderr: "" }
      if (args[0] === "ls-files" && args[1] === "--stage") return { stdout: `100644 ${"1".repeat(40)} 0\tsrc/app.ts\0`, stderr: "" }
      if (args[0] === "rev-parse") return { stdout: "abc123\n", stderr: "" }
      throw new Error(`unexpected argv: ${args.join(" ")}`)
    })
    const stream = vi.fn(async () => ({
      patch: "diff --git a/src/app.ts b/src/app.ts\n-old\n+new\n",
      patchHash: "a".repeat(64),
      indexHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      totalBytes: 52,
      oversize: false,
      resourceLimited: false,
    }))

    const snapshot = await deriveWorkspaceFileDiff("C:\\repo", "src/app.ts", run, stream)

    expect(snapshot).toEqual(expect.objectContaining({
      state: "modified",
      path: "src/app.ts",
      status: " M src/app.ts",
      baseHash: "abc123",
      patch: expect.stringContaining("+new"),
      patchHash: "a".repeat(64),
      fingerprint: expect.stringContaining('"baseHash":"abc123"'),
    }))
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ["status", "--porcelain=v1", "--untracked-files=all", "--", "src/app.ts"],
      ["ls-files", "--error-unmatch", "--", "src/app.ts"],
      ["rev-parse", "--verify", "HEAD"],
      ["ls-files", "--stage", "-z", "--", "src/app.ts"],
    ])
    expect(stream).toHaveBeenCalledWith("git", ["diff", "--patch", "--no-color", "abc123", "--", "src/app.ts"], expect.objectContaining({ cwd: "C:\\repo" }))
  })

  it("pins the patch to the one resolved base even if HEAD moves before diff", async () => {
    let head = "base-before"
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "status") return { stdout: " M src/app.ts\n", stderr: "" }
      if (args[0] === "ls-files" && args[1] === "--error-unmatch") return { stdout: "src/app.ts\n", stderr: "" }
      if (args[0] === "ls-files" && args[1] === "--stage") return { stdout: `100644 ${"1".repeat(40)} 0\tsrc/app.ts\0`, stderr: "" }
      if (args[0] === "rev-parse") { const resolved = head; head = "base-after"; return { stdout: `${resolved}\n`, stderr: "" } }
      throw new Error("unexpected")
    })
    const stream = vi.fn(async () => ({ patch: "+new\n", patchHash: "b".repeat(64), totalBytes: 5, oversize: false, resourceLimited: false }))

    const snapshot = await deriveWorkspaceFileDiff("C:\\repo", "src/app.ts", run, stream)

    expect(snapshot.baseHash).toBe("base-before")
    expect(stream).toHaveBeenCalledWith("git", ["diff", "--patch", "--no-color", "base-before", "--", "src/app.ts"], expect.any(Object))
    expect(run.mock.calls.filter((call) => call[1][0] === "rev-parse")).toHaveLength(1)
  })

  it.each([
    { name: "clean", status: "", tracked: true, patch: "", state: "clean" },
    { name: "untracked", status: "?? src/new.ts\n", tracked: false, patch: "", state: "untracked" },
    { name: "ignored untracked", status: "", tracked: false, patch: "", state: "untracked" },
  ])("reports $name truth explicitly", async ({ status, tracked, patch, state }) => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "status") return { stdout: status, stderr: "" }
      if (args[0] === "ls-files" && args[1] === "--error-unmatch") {
        if (!tracked) throw Object.assign(new Error("not tracked"), { code: 1 })
        return { stdout: "src/app.ts\n", stderr: "" }
      }
      if (args[0] === "ls-files" && args[1] === "--stage") return { stdout: `100644 ${"1".repeat(40)} 0\tsrc/app.ts\0`, stderr: "" }
      if (args[0] === "rev-parse") return { stdout: "abc123\n", stderr: "" }
      throw new Error("unexpected")
    })
    const stream = vi.fn(async () => ({
      patch,
      patchHash: createHash("sha256").update(patch).digest("hex"),
      totalBytes: Buffer.byteLength(patch),
      oversize: false,
      resourceLimited: false,
    }))

    await expect(deriveWorkspaceFileDiff("C:\\repo", tracked ? "src/app.ts" : "src/new.ts", run, stream))
      .resolves.toEqual(expect.objectContaining({ state }))
  })

  it("types an oversized patch without returning partial patch content", async () => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "status") return { stdout: " M src/app.ts\n", stderr: "" }
      if (args[0] === "ls-files" && args[1] === "--error-unmatch") return { stdout: "src/app.ts\n", stderr: "" }
      if (args[0] === "ls-files" && args[1] === "--stage") return { stdout: `100644 ${"1".repeat(40)} 0\tsrc/app.ts\0`, stderr: "" }
      if (args[0] === "rev-parse") return { stdout: "abc123\n", stderr: "" }
      throw new Error("unexpected")
    })
    const stream = vi.fn(async () => ({
      patch: "", patchHash: "c".repeat(64), totalBytes: MAX_WORKSPACE_PATCH_BYTES + 1,
      oversize: true, resourceLimited: false,
    }))

    await expect(deriveWorkspaceFileDiff("C:\\repo", "src/app.ts", run, stream)).resolves.toEqual(expect.objectContaining({
      state: "oversize",
      patch: "",
      patchHash: "c".repeat(64),
    }))
  })

  it("types git unavailability without leaking command failure detail", async () => {
    const run = vi.fn(async () => { throw new Error("secret host detail") })

    await expect(deriveWorkspaceFileDiff("C:\\repo", "src/app.ts", run)).resolves.toEqual(expect.objectContaining({
      state: "git-unavailable",
      patch: "",
      patchHash: null,
      reason: "GIT_UNAVAILABLE",
    }))
  })

  it("fails closed when the bounded exact index identity is malformed", async () => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "status") return { stdout: "MM src/app.ts\n", stderr: "" }
      if (args[0] === "ls-files" && args[1] === "--error-unmatch") return { stdout: "src/app.ts\n", stderr: "" }
      if (args[0] === "rev-parse") return { stdout: "abc123\n", stderr: "" }
      if (args[0] === "ls-files" && args[1] === "--stage") return { stdout: "unbounded-or-malformed", stderr: "" }
      throw new Error("unexpected")
    })
    const stream = vi.fn()

    await expect(deriveWorkspaceFileDiff("C:\\repo", "src/app.ts", run, stream)).resolves.toEqual(expect.objectContaining({
      state: "git-unavailable", indexHash: null,
    }))
    expect(stream).not.toHaveBeenCalled()
  })

  it("hashes the complete real patch while returning only bounded patch text", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-workspace-diff-"))
    roots.push(root)
    await execute("git", ["init", "--quiet"], { cwd: root, windowsHide: true })
    await fs.mkdir(path.join(root, "src"), { recursive: true })
    await fs.writeFile(path.join(root, "src", "app.ts"), "export const value = 'old'\n")
    await execute("git", ["add", "--", "src/app.ts"], { cwd: root, windowsHide: true })
    await execute("git", ["-c", "user.name=WilliamOS Test", "-c", "user.email=test@williamos.invalid", "commit", "--quiet", "-m", "base"], { cwd: root, windowsHide: true })
    await fs.writeFile(path.join(root, "src", "app.ts"), "export const value = 'new'\n")

    const snapshot = await deriveWorkspaceFileDiff(root, "src/app.ts")

    expect(snapshot).toEqual(expect.objectContaining({
      state: "modified",
      path: "src/app.ts",
      patch: expect.stringContaining("+export const value = 'new'"),
      baseHash: expect.stringMatching(/^[a-f0-9]{40,64}$/),
      patchHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
  })

  it("uses bounded streaming rather than materializing patch output in a temporary file", async () => {
    const source = await fs.readFile(path.join(process.cwd(), "lib/loom/workspace-diff.ts"), "utf8")
    expect(source).toContain("spawn(")
    expect(source).toContain("MAX_WORKSPACE_PATCH_STREAM_BYTES")
    expect(source).toContain("child.kill")
    expect(source).not.toContain("mkdtemp")
    expect(source).not.toContain("--output=")
  })

  it("hashes the complete child stream while retaining no partial oversized presentation", async () => {
    const complete = Buffer.from("0123456789abcdef")
    const streamed = await streamWorkspacePatch(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(complete.toString("utf8"))})`], {
      cwd: process.cwd(), windowsHide: true, maxPresentationBytes: 8, maxStreamBytes: 64, timeoutMs: 5_000,
    })

    expect(streamed).toEqual({
      patch: "",
      patchHash: createHash("sha256").update(complete).digest("hex"),
      totalBytes: complete.length,
      oversize: true,
      resourceLimited: false,
    })
  })

  it("terminates a child that crosses the hard stream limit", async () => {
    const streamed = await streamWorkspacePatch(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)"], {
      cwd: process.cwd(), windowsHide: true, maxPresentationBytes: 8, maxStreamBytes: 64, timeoutMs: 5_000,
    })

    expect(streamed).toEqual(expect.objectContaining({
      patch: "", patchHash: null, oversize: true, resourceLimited: true,
    }))
  })

  it.each([".env", "config/.env.production", "secrets/private.pem"])("refuses sensitive diff path %s before derivation", async (sensitivePath) => {
    const derive = vi.fn()
    vi.resetModules()
    vi.doMock("@/lib/session", () => ({ getSession: vi.fn(async () => ({ user: { id: "owner-a" } })) }))
    vi.doMock("@/lib/projects/workspace-project-binding", () => ({
      resolveCanonicalWorkspaceProjectBinding: async () => ({ ok: true, binding: { workspaceRoot: process.cwd() } }),
    }))
    vi.doMock("@/lib/loom/workspace-diff", () => ({ deriveWorkspaceFileDiff: derive }))
    const { GET } = await import("@/app/api/loom/diff/route")

    const response = await GET(new Request(`http://localhost/api/loom/diff?path=${encodeURIComponent(sensitivePath)}`))
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(payload).toEqual({ error: "SENSITIVE_PATH" })
    expect(payload).not.toHaveProperty("patch")
    expect(payload).not.toHaveProperty("status")
    expect(payload).not.toHaveProperty("patchHash")
    expect(derive).not.toHaveBeenCalled()
    vi.doUnmock("@/lib/session")
    vi.doUnmock("@/lib/loom/workspace-diff")
  })

  it.each([
    "http://localhost/api/loom/diff",
    "http://localhost/api/loom/diff?path=",
  ])("refuses unscoped whole-repository diff %s without metadata", async (url) => {
    const derive = vi.fn()
    vi.resetModules()
    vi.doMock("@/lib/session", () => ({ getSession: vi.fn(async () => ({ user: { id: "owner-a" } })) }))
    vi.doMock("@/lib/projects/workspace-project-binding", () => ({
      resolveCanonicalWorkspaceProjectBinding: async () => ({ ok: true, binding: { workspaceRoot: process.cwd() } }),
    }))
    vi.doMock("@/lib/loom/workspace-diff", () => ({ deriveWorkspaceFileDiff: derive }))
    const { GET } = await import("@/app/api/loom/diff/route")

    const response = await GET(new Request(url))
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(payload).toEqual({ error: "DIFF_PATH_REQUIRED" })
    expect(payload).not.toHaveProperty("patch")
    expect(payload).not.toHaveProperty("diff")
    expect(payload).not.toHaveProperty("status")
    expect(payload).not.toHaveProperty("patchHash")
    expect(derive).not.toHaveBeenCalled()
    vi.doUnmock("@/lib/session")
    vi.doUnmock("@/lib/loom/workspace-diff")
  })

  it("never exposes a tracked sensitive file through an unscoped repository request", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-unscoped-sensitive-diff-"))
    roots.push(root)
    await execute("git", ["init", "--quiet"], { cwd: root, windowsHide: true })
    await fs.writeFile(path.join(root, ".env"), "SECRET_MUST_NOT_LEAVE_SERVER=true\n")
    await execute("git", ["add", "--", ".env"], { cwd: root, windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } })
    process.env.WILLIAMOS_TERRAFUSION_ROOT = root
    vi.resetModules()
    vi.doMock("@/lib/session", () => ({ getSession: vi.fn(async () => ({ user: { id: "owner-a" } })) }))
    vi.doMock("@/lib/projects/workspace-project-binding", () => ({
      resolveCanonicalWorkspaceProjectBinding: async () => ({ ok: true, binding: { workspaceRoot: process.cwd() } }),
    }))
    const { GET } = await import("@/app/api/loom/diff/route")

    const response = await GET(new Request("http://localhost/api/loom/diff"))
    const raw = await response.text()

    expect(response.status).toBe(400)
    expect(JSON.parse(raw)).toEqual({ error: "DIFF_PATH_REQUIRED" })
    expect(raw).not.toContain("SECRET_MUST_NOT_LEAVE_SERVER")
    vi.doUnmock("@/lib/session")
  })
})
