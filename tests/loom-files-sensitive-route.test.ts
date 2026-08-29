import { beforeEach, describe, expect, it, vi } from "vitest"

const sessionMocks = vi.hoisted(() => ({ getSession: vi.fn() }))
const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: sessionMocks.getSession }))
vi.mock("node:fs/promises", () => ({ default: fsMocks }))

import { GET } from "@/app/api/loom/files/route"

const fileEntry = (name: string) => ({ name, isDirectory: () => false })

describe("workspace file API sensitive-path boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionMocks.getSession.mockResolvedValue({ user: { id: "owner-a" } })
    fsMocks.realpath.mockImplementation(async (candidate: string) => candidate)
    fsMocks.stat.mockResolvedValue({
      isDirectory: () => true,
      size: 0,
      mtime: new Date("2026-08-28T12:00:00.000Z"),
    })
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

    const response = await GET(new Request("http://localhost/api/loom/files?path="))

    expect(response.status).toBe(200)
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
