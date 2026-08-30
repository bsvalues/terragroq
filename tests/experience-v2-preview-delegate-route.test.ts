import { EventEmitter } from "node:events"

import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  spawn: vi.fn(),
  getSession: vi.fn(),
  loadOwnedWorkingWorld: vi.fn(),
  inspectWorkspaceApp: vi.fn(),
  requireWorkContext: vi.fn(),
  poolQuery: vi.fn(),
  recordLoomStart: vi.fn(),
  recordLoomEnd: vi.fn(),
}))

vi.mock("node:child_process", () => ({ spawn: seams.spawn }))
vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/environment/space-persistence", () => ({ loadOwnedWorkingWorld: seams.loadOwnedWorkingWorld }))
vi.mock("@/lib/environment/workspace-app", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/environment/workspace-app")>(),
  inspectWorkspaceApp: seams.inspectWorkspaceApp,
}))
vi.mock("@/lib/governance/work-context-gate", () => ({
  requireWorkContext: seams.requireWorkContext,
  workContextRefusal: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ pool: { query: seams.poolQuery } }))
vi.mock("@/lib/loom/receipts", () => ({ recordLoomStart: seams.recordLoomStart, recordLoomEnd: seams.recordLoomEnd }))

import { POST } from "@/app/api/loom/agent/route"

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = { end: vi.fn() }
  kill = vi.fn()
}

const sessionId = "123e4567-e89b-42d3-a456-426614174000"
const fingerprint = "a".repeat(64)
const evidence = {
  schemaVersion: 1, status: "attached", reason: null,
  configuredUrl: "http://tf.test:5000/app", admittedUrl: "http://tf.test:5000/app",
  origin: "http://tf.test:5000", identity: "TerraFusion", reachable: true, frameable: true,
  checkedAt: "2026-08-30T03:00:00.000Z",
  limitations: { dom: "unavailable", console: "unavailable", network: "unavailable" }, fingerprint,
} as const

function request(body: Record<string, unknown>) {
  return new Request("http://williamos.test/api/loom/agent", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })
}

describe("Preview debugger route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    seams.loadOwnedWorkingWorld.mockResolvedValue({
      space: { activeWindowId: "workspace-running-app", windows: [{ id: "workspace-running-app", kind: "running-app" }] },
    })
    seams.inspectWorkspaceApp.mockResolvedValue(evidence)
    seams.recordLoomStart.mockResolvedValue(undefined)
    seams.poolQuery.mockResolvedValue({ rows: [{ userId: "owner-1", metadata: {
      provider: "cloud", mode: "preview", worldId: "world-a", evidenceFingerprint: fingerprint,
    } }] })
  })

  it("derives exact Preview evidence server-side and invokes Claude with no tools", async () => {
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)
    const response = await POST(request({
      mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Find the likely blocker.",
      sessionId, resume: false,
      configuredUrl: "https://attacker.test/?token=secret", status: "attached", identity: "Fake",
    }))

    expect(response.status).toBe(200)
    expect(seams.loadOwnedWorkingWorld).toHaveBeenCalledWith("owner-1", "world-a")
    expect(seams.requireWorkContext).not.toHaveBeenCalled()
    const args = seams.spawn.mock.calls[0][1] as string[]
    expect(args).toContain("plan")
    expect(args).toContain("")
    expect(args).not.toContain("acceptEdits")
    const groundedPrompt = args.at(-1)!
    expect(groundedPrompt).toContain("http://tf.test:5000/app")
    expect(groundedPrompt).toContain(`Evidence fingerprint: ${fingerprint}`)
    expect(groundedPrompt).toContain("DOM unavailable; console unavailable; network unavailable")
    expect(groundedPrompt).not.toContain("attacker.test")
    expect(groundedPrompt).not.toContain("Fake")
    expect(seams.recordLoomStart).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner-1", subject: sessionId,
      metadata: expect.objectContaining({ provider: "cloud", mode: "preview", worldId: "world-a", evidenceFingerprint: fingerprint }),
    }))

    child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "The runtime is reachable." })}\n`))
    child.emit("close", 0)
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
    expect(events[0]).toEqual({ type: "session", sessionId, resumed: false, provider: "Claude", mode: "preview", worldId: "world-a", evidenceFingerprint: fingerprint })
  })

  it("refuses absent or non-running active Preview before provider or authority work", async () => {
    seams.loadOwnedWorkingWorld.mockResolvedValueOnce({ space: { activeWindowId: "workspace-editor", windows: [{ id: "workspace-editor", kind: "editor" }] } })
    const response = await POST(request({ mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Diagnose." }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "PREVIEW_NOT_ACTIVE" })
    expect(seams.inspectWorkspaceApp).not.toHaveBeenCalled()
    expect(seams.spawn).not.toHaveBeenCalled()
    expect(seams.requireWorkContext).not.toHaveBeenCalled()
  })

  it.each([
    ["foreign owner", { userId: "owner-2", metadata: { provider: "cloud", mode: "preview", worldId: "world-a", evidenceFingerprint: fingerprint } }, "THREAD_NOT_YOURS"],
    ["wrong world", { userId: "owner-1", metadata: { provider: "cloud", mode: "preview", worldId: "world-b", evidenceFingerprint: fingerprint } }, "THREAD_DESCRIPTOR_MISMATCH"],
    ["wrong mode", { userId: "owner-1", metadata: { provider: "cloud", mode: "agent", worldId: "world-a" } }, "THREAD_DESCRIPTOR_MISMATCH"],
  ])("refuses %s Preview resume", async (_label, row, error) => {
    seams.poolQuery.mockResolvedValueOnce({ rows: [row] })
    const response = await POST(request({ mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Continue.", sessionId, resume: true }))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error })
    expect(seams.spawn).not.toHaveBeenCalled()
  })

  it("does not allow a Preview thread to fall through the generic mutation route", async () => {
    const response = await POST(request({ provider: "cloud", prompt: "Edit files.", sessionId, resume: true }))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "THREAD_DESCRIPTOR_MISMATCH" })
    expect(seams.requireWorkContext).not.toHaveBeenCalled()
    expect(seams.spawn).not.toHaveBeenCalled()
  })

  it("withholds the canonical result when exact Preview evidence changes during inference", async () => {
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)
    seams.inspectWorkspaceApp.mockResolvedValueOnce(evidence).mockResolvedValueOnce({ ...evidence, fingerprint: "b".repeat(64) })
    const response = await POST(request({
      mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Diagnose.", sessionId, resume: false,
    }))
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({
      type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Now stale",
    })}\n`))
    child.emit("close", 0)

    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
    expect(events).toEqual([
      { type: "session", sessionId, resumed: false, provider: "Claude", mode: "preview", worldId: "world-a", evidenceFingerprint: fingerprint },
      { type: "done", reason: "PREVIEW_CONTEXT_STALE", code: null },
    ])
    expect(events.some((event) => JSON.stringify(event).includes("Now stale"))).toBe(false)
  })
})
