import path from "node:path"
import { EventEmitter } from "node:events"
import { spawnSync } from "node:child_process"

import { beforeEach, describe, expect, it, vi } from "vitest"

const terminalRouteSeams = vi.hoisted(() => ({
  spawn: vi.fn(),
  getSession: vi.fn(),
  recordLoomStart: vi.fn(),
  recordLoomEnd: vi.fn(),
  deriveSpaceMutationAuthority: vi.fn(),
  resolveProject: vi.fn(),
}))

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: terminalRouteSeams.spawn,
}))
vi.mock("@/lib/session", () => ({ getSession: terminalRouteSeams.getSession }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveCanonicalWorkspaceProjectBinding: terminalRouteSeams.resolveProject,
}))
vi.mock("@/lib/loom/receipts", () => ({
  recordLoomStart: terminalRouteSeams.recordLoomStart,
  recordLoomEnd: terminalRouteSeams.recordLoomEnd,
}))
vi.mock("@/lib/governance/space-mutation-authority", () => ({
  deriveSpaceMutationAuthority: terminalRouteSeams.deriveSpaceMutationAuthority,
  SpaceMutationAuthorityError: class SpaceMutationAuthorityError extends Error { code = "SPACE_MUTATION_AUTHORITY_REFUSED" },
}))

import { POST } from "@/app/api/loom/run/route"
import { isIgnoredEntry, looksBinary, resolveRealWorkspacePath, resolveWorkspacePath } from "@/lib/loom/workspace"
import { LOOM_OPERATIONS, resolveLoomOperation, resolveProjectTerminalCommand } from "@/lib/loom/operations"

const ROOT = process.platform === "win32" ? "C:\\work\\repo" : "/work/repo"

class FakeTerminalChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}

function terminalRequest(body: Record<string, unknown>) {
  return new Request("http://williamos.test/api/loom/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("Experience V2 bounded Terminal route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalRouteSeams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    terminalRouteSeams.resolveProject.mockResolvedValue({ ok: true, binding: {
      workspaceRoot: ROOT, projectId: 7, projectKey: "terrafusion",
      repositoryIdentity: "bsvalues/terrafusion_os_1.0", project: { identity: "c:/terrafusion" },
    } })
  })

  it("spawns the exact server-derived argv for an allowed read-only inspection command", async () => {
    const child = new FakeTerminalChild()
    terminalRouteSeams.spawn.mockReturnValue(child)

    const response = await POST(terminalRequest({ operation: "repo.status", terminalCommand: "git status --short --branch" }))

    expect(response.status).toBe(200)
    expect(terminalRouteSeams.spawn).toHaveBeenCalledWith("git", ["status", "--short", "--branch"], expect.objectContaining({
      shell: false,
      windowsHide: true,
    }))
    child.stdout.emit("data", Buffer.from("## main\n"))
    child.emit("close", 0)
    expect(await response.text()).toContain('"type":"exit","code":0')
  })

  it("runs project tests in test mode even when WilliamOS itself is a production server", async () => {
    const child = new FakeTerminalChild()
    terminalRouteSeams.spawn.mockReturnValue(child)
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "production"

    try {
      const response = await POST(terminalRequest({ operation: "tests.run" }))

      expect(response.status).toBe(200)
      expect(terminalRouteSeams.spawn).toHaveBeenCalledWith(process.execPath, [
        "node_modules/vitest/vitest.mjs", "run", "--reporter=dot", "--silent",
      ], expect.objectContaining({
        env: expect.objectContaining({ NODE_ENV: "test" }),
      }))
      child.emit("close", 0)
      await response.text()
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it("runs a WilliamOS Space operation only in its server-derived WilliamOS checkout", async () => {
    const child = new FakeTerminalChild()
    terminalRouteSeams.spawn.mockReturnValue(child)
    terminalRouteSeams.resolveProject.mockResolvedValue({ ok: true, binding: {
      workspaceRoot: "C:/HermesLab/williamos-source", projectId: 8, projectKey: "williamos",
      repositoryIdentity: "bsvalues/terragroq", project: { identity: "c:/hermeslab/williamos-source" },
    } })

    const response = await POST(terminalRequest({ operation: "tests.run", projectKey: "williamos" }))

    expect(response.status).toBe(200)
    expect(terminalRouteSeams.resolveProject).toHaveBeenCalledWith("owner-1", "williamos")
    expect(terminalRouteSeams.spawn).toHaveBeenCalledWith(process.execPath, [
      "node_modules/vitest/vitest.mjs", "run", "--reporter=dot", "--silent", "--config", "vitest.ci.config.ts",
    ], expect.objectContaining({
      cwd: "C:/HermesLab/williamos-source",
    }))
    child.emit("close", 0)
    await response.text()
  })

  it("injects the default commit bound when a typed log inspection omits one", async () => {
    const child = new FakeTerminalChild()
    terminalRouteSeams.spawn.mockReturnValue(child)

    const response = await POST(terminalRequest({ operation: "repo.log", terminalCommand: "git log --stat" }))

    expect(response.status).toBe(200)
    expect(terminalRouteSeams.spawn).toHaveBeenCalledWith("git", ["log", "--stat", "-20"], expect.objectContaining({ shell: false }))
    child.emit("close", 0)
    await response.text()
  })

  it.each([
    ["git checkout main", "repo.status"],
    ["git status && whoami", "repo.status"],
    ["git diff ../../secret", "repo.diff"],
  ])("refuses unsupported command text %s before spawning", async (terminalCommand, operation) => {
    const response = await POST(terminalRequest({ operation, terminalCommand }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "UNSUPPORTED_TERMINAL_COMMAND" })
    expect(terminalRouteSeams.spawn).not.toHaveBeenCalled()
  })

  it("refuses an operation id that does not match the server-derived command", async () => {
    const response = await POST(terminalRequest({ operation: "repo.diff", terminalCommand: "git status --short" }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "UNKNOWN_OPERATION" })
    expect(terminalRouteSeams.spawn).not.toHaveBeenCalled()
  })
})

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
  it("turns bounded read-only Terminal text into fixed executable argv without a shell", () => {
    expect(resolveProjectTerminalCommand("git status --short --branch")).toMatchObject({
      id: "repo.status",
      command: "git",
      args: ["status", "--short", "--branch"],
      mutating: false,
    })
    expect(resolveProjectTerminalCommand("git diff --check HEAD")?.args).toEqual(["diff", "--check", "HEAD"])
    expect(resolveProjectTerminalCommand("git log --stat")?.args).toEqual(["log", "--stat", "-20"])
    expect(resolveProjectTerminalCommand("git log --oneline --decorate -100")?.args).toEqual(["log", "--oneline", "--decorate", "-100"])
  })

  it("never lets Terminal text select an executable, path, revision, mutation or shell expression", () => {
    for (const command of [
      "git add .", "git commit", "git reset --hard", "git diff main", "git diff src/file.ts",
      "git status | more", "git status; whoami", "git status > output.txt", "git -c core.pager=cat status",
      "node --version", "powershell Get-ChildItem", "git log -101", "git log -10 -20",
    ]) expect(resolveProjectTerminalCommand(command)).toBeNull()
  })

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

  it("starts the catalogued Test operation with the installed Vitest CLI", () => {
    const operation = LOOM_OPERATIONS.find((candidate) => candidate.id === "tests.run")
    expect(operation).toBeDefined()

    const result = spawnSync(process.execPath, [
      ...operation!.args,
      "--passWithNoTests",
      "tests/__catalogue_smoke_never__.test.ts",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      timeout: 30_000,
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
  })
})

describe("workspace containment survives links", () => {
  // path.resolve reasons about strings, so a link inside the workspace pointing outside it passes a
  // lexical check while the file it names sits on the host. This is the case that let this API read
  // the private key of the CA that signs every device certificate in the lab, so it gets its own
  // assertions. Roots are built with forward slashes and resolved, which is valid on both platforms.
  const linkRoot = path.resolve(process.platform === "win32" ? "C:/work/repo" : "/work/repo")
  const outside = path.resolve(path.dirname(linkRoot), "elsewhere")
  const planted = path.join(linkRoot, "planted-link")

  /** Stands in for fs.realpath: the planted link resolves to a location outside the workspace. */
  const realpath = async (candidate) => {
    if (candidate === planted || candidate.startsWith(planted + path.sep)) {
      return candidate.replace(planted, outside)
    }
    return candidate
  }

  it("refuses a path that leaves the workspace through a link", async () => {
    expect(await resolveRealWorkspacePath(linkRoot, "planted-link/secret.key", realpath))
      .toMatchObject({ ok: false, refusal: "PATH_ESCAPES_WORKSPACE" })
  })

  it("refuses the link itself, not only paths beneath it", async () => {
    expect(await resolveRealWorkspacePath(linkRoot, "planted-link", realpath)).toMatchObject({ ok: false })
  })

  it("still allows ordinary paths inside the workspace", async () => {
    const result = await resolveRealWorkspacePath(linkRoot, "lib/loom/workspace.ts", realpath)
    expect(result.ok).toBe(true)
    expect(result.relative).toBe("lib/loom/workspace.ts")
  })

  it("allows a file that does not exist yet, so new files can still be created", async () => {
    // realpath throws for a missing leaf; the nearest existing ancestor is resolved instead.
    const missingLeaf = async (candidate) => {
      if (candidate.endsWith("brand-new.ts")) throw new Error("ENOENT")
      return realpath(candidate)
    }
    const result = await resolveRealWorkspacePath(linkRoot, "lib/brand-new.ts", missingLeaf)
    expect(result.ok).toBe(true)
    expect(result.relative).toBe("lib/brand-new.ts")
  })

  it("refuses a new file whose missing parent resolves outside the workspace", async () => {
    const missingLeaf = async (candidate) => {
      if (candidate.endsWith("new.ts")) throw new Error("ENOENT")
      return realpath(candidate)
    }
    expect(await resolveRealWorkspacePath(linkRoot, "planted-link/new.ts", missingLeaf))
      .toMatchObject({ ok: false, refusal: "PATH_ESCAPES_WORKSPACE" })
  })
})
