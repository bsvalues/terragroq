import { EventEmitter } from "node:events"

import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  spawn: vi.fn(),
  getSession: vi.fn(),
  requireWorkContext: vi.fn(),
  resolveRealWorkspacePath: vi.fn(),
  recordLoomStart: vi.fn(),
  recordLoomEnd: vi.fn(),
  recordLoomEvidence: vi.fn(),
}))

vi.mock("node:child_process", () => ({ spawn: seams.spawn }))
vi.mock("node:fs/promises", () => ({ default: { realpath: vi.fn() } }))
vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/governance/work-context-gate", () => ({
  requireWorkContext: seams.requireWorkContext,
  workContextRefusal: vi.fn(),
}))
vi.mock("@/lib/loom/workspace", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/loom/workspace")>(),
  resolveRealWorkspacePath: seams.resolveRealWorkspacePath,
}))
vi.mock("@/lib/loom/receipts", () => ({
  recordLoomStart: seams.recordLoomStart,
  recordLoomEnd: seams.recordLoomEnd,
  recordLoomEvidence: seams.recordLoomEvidence,
}))

import { POST } from "@/app/api/loom/edit/route"

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = { end: vi.fn() }
  kill = vi.fn()
}

const request = (path: string) => new Request("http://williamos.test/api/loom/edit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ path, task: "Apply the selected change." }),
})

describe("selected-file Change sensitive-path boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    seams.requireWorkContext.mockResolvedValue({ ok: true })
    seams.resolveRealWorkspacePath.mockImplementation(async (_root: string, selectedPath: string) => ({
      ok: true,
      absolute: `C:/workspace/${selectedPath}`,
      relative: selectedPath,
    }))
  })

  it.each([".env.local", "keys/id_ecdsa.bak"])("refuses sensitive Change path %s before filesystem access or SEA spawn", async (selectedPath) => {
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)

    const response = await POST(request(selectedPath))
    if (response.status === 200) {
      child.emit("close", 0)
      await response.text()
    }

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "SENSITIVE_PATH" })
    expect(seams.resolveRealWorkspacePath).not.toHaveBeenCalled()
    expect(seams.spawn).not.toHaveBeenCalled()
  })

  it("refuses a safe-looking alias whose canonical Change path is sensitive before SEA spawn", async () => {
    seams.resolveRealWorkspacePath.mockResolvedValueOnce({
      ok: true,
      absolute: "C:/workspace/keys/id_dsa.old",
      relative: "keys/id_dsa.old",
    })
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)

    const response = await POST(request("safe-link"))
    if (response.status === 200) {
      child.emit("close", 0)
      await response.text()
    }

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "SENSITIVE_PATH" })
    expect(seams.spawn).not.toHaveBeenCalled()
  })
})
