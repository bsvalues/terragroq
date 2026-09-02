import { beforeEach, describe, expect, it, vi } from "vitest"

const sessionMocks = vi.hoisted(() => ({ getSession: vi.fn() }))
const bindingMocks = vi.hoisted(() => ({ resolve: vi.fn() }))
const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: sessionMocks.getSession }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({ resolveCanonicalWorkspaceProjectBinding: bindingMocks.resolve }))
vi.mock("node:fs/promises", () => ({ default: fsMocks }))

import { GET } from "@/app/api/loom/files/route"
import { isSensitiveWorkspacePath } from "@/lib/loom/workspace"

const fileEntry = (name: string) => ({ name, isDirectory: () => false })

describe("workspace file API sensitive-path boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionMocks.getSession.mockResolvedValue({ user: { id: "owner-a" } })
    bindingMocks.resolve.mockResolvedValue({ ok: true, binding: {
      workspaceRoot: "C:/project",
      project: { identity: "c:/project", name: "TerraFusion OS" },
    } })
    fsMocks.realpath.mockImplementation(async (candidate: string) => candidate)
    fsMocks.stat.mockResolvedValue({
      isDirectory: () => true,
      size: 0,
      mtime: new Date("2026-08-28T12:00:00.000Z"),
    })
  })

  it.each([
    ["id_rsa", true],
    ["id_rsa.bak", true],
    ["id_rsa_backup", true],
    ["id_dsa", true],
    ["id_dsa.old", true],
    ["id_ecdsa", true],
    ["id_ecdsa-legacy", true],
    ["id_ed25519.bak", true],
    ["keys/ID_ECDSA.BAK", true],
    ["id_rsa.pub", false],
    ["id_dsa.pub", false],
    ["id_ecdsa.pub", false],
    ["id_ed25519.pub", false],
    ["id_rsa.bak.pub", false],
    ["identity_rsa.ts", false],
  ])("classifies canonical private-key path %s as sensitive=%s", (candidate, sensitive) => {
    expect(isSensitiveWorkspacePath(candidate)).toBe(sensitive)
  })

  it("hides secret env variants from a directory while preserving the documented example", async () => {
    fsMocks.readdir.mockResolvedValue([
      fileEntry(".env.local"),
      fileEntry(".env.production"),
      fileEntry("service.env"),
      fileEntry("device.pem"),
      fileEntry("id_ed25519"),
      fileEntry(".env.example"),
      fileEntry("README.md"),
    ])

    const response = await GET(new Request("http://localhost/api/loom/files?path=&projectKey=williamos"))

    expect(response.status).toBe(200)
    expect(bindingMocks.resolve).toHaveBeenCalledWith("owner-a", "williamos")
    expect((await response.json()).entries.map((entry: { name: string }) => entry.name)).toEqual([
      ".env.example",
      "README.md",
    ])
  })

  it("refuses a direct secret env read before touching file contents", async () => {
    fsMocks.stat.mockResolvedValue({
      isDirectory: () => false,
      size: 24,
      mtime: new Date("2026-08-28T12:00:00.000Z"),
    })
    fsMocks.readFile.mockResolvedValue(new TextEncoder().encode("placeholder-not-a-secret"))

    const response = await GET(new Request("http://localhost/api/loom/files?path=.env.local"))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "SENSITIVE_PATH" })
    expect(fsMocks.stat).not.toHaveBeenCalled()
    expect(fsMocks.readFile).not.toHaveBeenCalled()
  })
})
