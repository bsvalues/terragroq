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
  loadOwnedWorkingWorld: vi.fn(),
  deriveWorkspaceFileDiff: vi.fn(),
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
vi.mock("@/lib/environment/space-persistence", () => ({ loadOwnedWorkingWorld: seams.loadOwnedWorkingWorld }))
vi.mock("@/lib/loom/workspace-diff", () => ({ deriveWorkspaceFileDiff: seams.deriveWorkspaceFileDiff }))

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

const improveRequest = (overrides: Record<string, unknown> = {}) => new Request("http://williamos.test/api/loom/edit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    path: "src/app.ts",
    task: "Improve the exact current patch.",
    intent: "improve-diff",
    worldId: "world-a",
    expectedDiffFingerprint: "exact-live-diff",
    ...overrides,
  }),
})

const liveDiffSnapshot = {
  path: "src/app.ts",
  state: "modified",
  status: " M src/app.ts",
  patch: "-before\n+current",
  baseHash: "base",
  indexHash: "index",
  patchHash: "patch",
  fingerprint: "exact-live-diff",
  reason: null,
} as const

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
    seams.loadOwnedWorkingWorld.mockResolvedValue({
      space: {
        activeWindowId: "workspace-diff",
        windows: [{ id: "workspace-diff", minimized: false }],
        selection: { filePath: "src/app.ts", anchor: 0, head: 0 },
      },
    })
    seams.deriveWorkspaceFileDiff.mockResolvedValue(liveDiffSnapshot)
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

  it("re-derives the exact live diff immediately before spawning Improve", async () => {
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)

    const response = await POST(improveRequest())
    expect(response.status).toBe(200)
    expect(seams.loadOwnedWorkingWorld).toHaveBeenCalledWith("owner-1", "world-a")
    expect(seams.deriveWorkspaceFileDiff).toHaveBeenCalledWith(expect.any(String), "src/app.ts")
    expect(seams.deriveWorkspaceFileDiff.mock.invocationCallOrder[0]).toBeLessThan(seams.spawn.mock.invocationCallOrder[0])
    child.stdout.emit("data", Buffer.from(JSON.stringify({ success: true })))
    child.emit("close", 0)
    await response.text()
  })

  it.each([
    ["fingerprint changed", {}, { fingerprint: "new-live-diff" }],
    ["patch became clean", {}, { state: "clean", patch: "", fingerprint: "clean-diff" }],
    ["selected path changed", {}, null],
    ["Space changed", { worldId: "world-b" }, "missing-world"],
  ])("returns DIFF_CONTEXT_STALE with no spawn when %s", async (_reason, requestOverrides, diffOverride) => {
    if (diffOverride === null) {
      seams.loadOwnedWorkingWorld.mockResolvedValueOnce({
        space: {
          activeWindowId: "workspace-diff",
          windows: [{ id: "workspace-diff", minimized: false }],
          selection: { filePath: "src/other.ts", anchor: 0, head: 0 },
        },
      })
    } else if (diffOverride === "missing-world") {
      seams.loadOwnedWorkingWorld.mockResolvedValueOnce(null)
    } else if (typeof diffOverride === "object") {
      seams.deriveWorkspaceFileDiff.mockResolvedValueOnce({
        ...liveDiffSnapshot,
        ...diffOverride,
      })
    }

    const response = await POST(improveRequest(requestOverrides))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "DIFF_CONTEXT_STALE" })
    expect(seams.spawn).not.toHaveBeenCalled()
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
  })

  it("refuses minimized or unfocused Changes before diff derivation or spawn", async () => {
    seams.loadOwnedWorkingWorld.mockResolvedValueOnce({
      space: {
        activeWindowId: "workspace-editor",
        windows: [{ id: "workspace-diff", minimized: true }],
        selection: { filePath: "src/app.ts", anchor: 0, head: 0 },
      },
    })

    const response = await POST(improveRequest())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "DIFF_CONTEXT_STALE" })
    expect(seams.deriveWorkspaceFileDiff).not.toHaveBeenCalled()
    expect(seams.spawn).not.toHaveBeenCalled()
  })

  it("rechecks the exact owned Changes selection after diff derivation and before spawn", async () => {
    seams.loadOwnedWorkingWorld
      .mockResolvedValueOnce({
        space: {
          activeWindowId: "workspace-diff",
          windows: [{ id: "workspace-diff", minimized: false }],
          selection: { filePath: "src/app.ts", anchor: 0, head: 0 },
        },
      })
      .mockResolvedValueOnce({
        space: {
          activeWindowId: "workspace-editor",
          windows: [{ id: "workspace-diff", minimized: false }],
          selection: { filePath: "src/app.ts", anchor: 0, head: 0 },
        },
      })

    const response = await POST(improveRequest())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "DIFF_CONTEXT_STALE" })
    expect(seams.deriveWorkspaceFileDiff).toHaveBeenCalledTimes(1)
    expect(seams.spawn).not.toHaveBeenCalled()
  })
})
