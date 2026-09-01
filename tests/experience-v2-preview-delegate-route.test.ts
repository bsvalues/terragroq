import { EventEmitter } from "node:events"

import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  spawn: vi.fn(),
  getSession: vi.fn(),
  loadOwnedWorkingWorld: vi.fn(),
  inspectWorkspaceApp: vi.fn(),
  deriveSpaceMutationAuthority: vi.fn(),
  inspectTarget: vi.fn(),
  createIsolated: vi.fn(),
  inspectIsolated: vi.fn(),
  cleanupIsolated: vi.fn(),
  writeGoverned: vi.fn(),
  poolQuery: vi.fn(),
  recordLoomStart: vi.fn(),
  recordLoomEnd: vi.fn(),
}))

vi.mock("node:child_process", () => ({ spawn: seams.spawn }))
vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveTerraFusionWorkspaceBinding: async () => ({ ok: true, binding: {
    workspaceRoot: process.cwd(), projectId: 7, projectKey: "terrafusion",
    repositoryIdentity: "bsvalues/terrafusion_os_1.0", project: { identity: "c:/terrafusion" },
  } }),
}))
vi.mock("@/lib/environment/space-persistence", () => ({ loadOwnedWorkingWorld: seams.loadOwnedWorkingWorld }))
vi.mock("@/lib/environment/workspace-app", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/environment/workspace-app")>(),
  inspectWorkspaceApp: seams.inspectWorkspaceApp,
}))
vi.mock("@/lib/governance/space-mutation-authority", () => ({
  deriveSpaceMutationAuthority: seams.deriveSpaceMutationAuthority,
  SpaceMutationAuthorityError: class SpaceMutationAuthorityError extends Error { code = "SPACE_MUTATION_AUTHORITY_REFUSED" },
}))
vi.mock("@/lib/loom/codex-assignment", () => ({ inspectCodexAssignmentTarget: seams.inspectTarget }))
vi.mock("@/lib/loom/codex-isolated-workspace", () => ({
  createCodexIsolatedWorkspace: seams.createIsolated,
  inspectCodexIsolatedWorkspace: seams.inspectIsolated,
  cleanupCodexIsolatedWorkspace: seams.cleanupIsolated,
}))
vi.mock("@/lib/loom/workspace-file-write", () => ({
  workspaceFileWriteDependencies: () => ({ authorize: vi.fn(), resolve: vi.fn(), auditStart: vi.fn(), auditFinish: vi.fn() }),
  writeGovernedWorkspaceFile: seams.writeGoverned,
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
    seams.deriveSpaceMutationAuthority.mockResolvedValue({
      owner: "owner-1", worldId: "world-a", worldRevision: 3, projectId: 7,
      projectKey: "terrafusion", repositoryIdentity: "bsvalues/terrafusion_os_1.0",
      outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 51, actor: "claude", selectedPath: "src/app.ts",
    })
    seams.inspectTarget.mockResolvedValue({ content: "before", modifiedAt: "2026-08-30T00:00:00.000Z", digest: "a".repeat(64) })
    seams.createIsolated.mockResolvedValue({ projectRoot: process.cwd(), runtimeRoot: "C:/runtime", root: "C:/runtime/delegate-1", baseSha: "a".repeat(40), selectedPath: "src/app.ts", initialContentDigest: "a".repeat(64) })
    seams.inspectIsolated.mockResolvedValue({ content: "after", digest: "b".repeat(64) })
    seams.cleanupIsolated.mockResolvedValue(undefined)
    seams.writeGoverned.mockResolvedValue({ ok: true, path: "src/app.ts", modifiedAt: "2026-08-30T00:01:00.000Z", name: "app.ts" })
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
    expect(seams.deriveSpaceMutationAuthority).not.toHaveBeenCalled()
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
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "system", subtype: "init", session_id: sessionId })}\n`))
    await Promise.resolve()
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "The runtime is reachable." })}\n`))
    child.emit("close", 0)
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
    expect(events).toEqual([
      { type: "session", sessionId, resumed: false, provider: "Claude", mode: "preview", worldId: "world-a", evidenceFingerprint: fingerprint },
      { type: "event", event: { type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "The runtime is reachable." } },
      { type: "done", reason: null, code: 0 },
    ])
    expect(seams.recordLoomStart).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner-1", subject: sessionId,
      metadata: expect.objectContaining({ provider: "cloud", mode: "preview", worldId: "world-a", evidenceFingerprint: fingerprint }),
    }))
    expect(seams.loadOwnedWorkingWorld.mock.invocationCallOrder.at(-1)).toBeLessThan(seams.recordLoomStart.mock.invocationCallOrder[0])
    expect(seams.inspectWorkspaceApp.mock.invocationCallOrder.at(-1)).toBeLessThan(seams.recordLoomStart.mock.invocationCallOrder[0])
    expect(seams.recordLoomEnd).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner-1", subject: sessionId,
      outcome: expect.objectContaining({ provider: "cloud", mode: "preview", worldId: "world-a", evidenceFingerprint: fingerprint, code: 0, reason: null }),
    }))
  })

  it("refuses absent or non-running active Preview before provider or authority work", async () => {
    seams.loadOwnedWorkingWorld.mockResolvedValueOnce({ space: { activeWindowId: "workspace-editor", windows: [{ id: "workspace-editor", kind: "editor" }] } })
    const response = await POST(request({ mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Diagnose." }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "PREVIEW_NOT_ACTIVE" })
    expect(seams.inspectWorkspaceApp).not.toHaveBeenCalled()
    expect(seams.spawn).not.toHaveBeenCalled()
    expect(seams.deriveSpaceMutationAuthority).not.toHaveBeenCalled()
  })

  it("refuses a minimized running-app at start", async () => {
    seams.loadOwnedWorkingWorld.mockResolvedValueOnce({
      space: { activeWindowId: "workspace-running-app", windows: [{ id: "workspace-running-app", kind: "running-app", minimized: true }] },
    })
    const response = await POST(request({ mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Diagnose." }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "PREVIEW_NOT_ACTIVE" })
    expect(seams.spawn).not.toHaveBeenCalled()
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
    expect(seams.deriveSpaceMutationAuthority).not.toHaveBeenCalled()
    expect(seams.spawn).not.toHaveBeenCalled()
  })

  it("binds a generic Claude turn to the exact server-derived Space selection", async () => {
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)
    const response = await POST(request({
      provider: "cloud", worldId: "world-a", prompt: "Apply the bounded fix.", sessionId, resume: false,
    }))

    expect(response.status).toBe(200)
    expect(seams.deriveSpaceMutationAuthority).toHaveBeenCalledTimes(3)
    expect(seams.deriveSpaceMutationAuthority).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userId: "owner-1", worldId: "world-a", target: { kind: "selected-file" },
    }))
    expect(seams.deriveSpaceMutationAuthority).toHaveBeenNthCalledWith(3, expect.objectContaining({
      worldId: "world-a", target: { kind: "selected-file", requestedPath: "src/app.ts" },
    }))
    const prompt = (seams.spawn.mock.calls[0][1] as string[]).at(-1)
    expect(prompt).toContain("exact server-authorized selected file: src/app.ts")
    expect(prompt).toContain("Do not edit, create, delete, rename, or move any other path")
    child.emit("close", 0)
    await response.text()
    expect(seams.recordLoomStart).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ mode: "agent", worldId: "world-a", path: "src/app.ts" }),
    }))
  })

  it("refuses a resumed Claude thread from a different Space selection", async () => {
    seams.poolQuery.mockResolvedValueOnce({ rows: [{ userId: "owner-1", metadata: {
      provider: "cloud", mode: "agent", worldId: "world-b", path: "src/other.ts",
    } }] })
    const response = await POST(request({
      provider: "cloud", worldId: "world-a", prompt: "Continue.", sessionId, resume: true,
    }))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "THREAD_CONTEXT_MISMATCH" })
    expect(seams.spawn).not.toHaveBeenCalled()
  })

  it("withholds the canonical result when exact Preview evidence changes during inference", async () => {
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)
    seams.inspectWorkspaceApp.mockResolvedValueOnce(evidence).mockResolvedValueOnce({ ...evidence, fingerprint: "b".repeat(64) })
    const response = await POST(request({
      mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Diagnose.", sessionId, resume: false,
    }))
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "system", subtype: "init", session_id: sessionId })}\n`))
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({
      type: "assistant", session_id: sessionId,
      message: { content: [{ type: "text", text: "STALE ANSWER" }] },
    })}\n`))
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({
      type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Now stale",
    })}\n`))
    child.emit("close", 0)

    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
    expect(events).toEqual([{ type: "done", reason: "PREVIEW_CONTEXT_STALE", code: null }])
    expect(events.some((event) => /Now stale|STALE ANSWER/.test(JSON.stringify(event)))).toBe(false)
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.recordLoomEnd).not.toHaveBeenCalled()
  })

  it("materializes no session or receipt when the Claude binary cannot spawn", async () => {
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)
    const responsePromise = POST(request({ mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Diagnose.", sessionId, resume: false }))
    const response = await responsePromise
    child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }))
    child.emit("close", -1)

    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
    expect(events).toEqual([{ type: "done", reason: "AGENT_UNAVAILABLE", code: null }])
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.recordLoomEnd).not.toHaveBeenCalled()
  })

  it("materializes no session or receipt when Claude refuses before exact init", async () => {
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)
    const response = await POST(request({ mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Diagnose.", sessionId, resume: false }))
    child.stderr.emit("data", Buffer.from("Authentication token rejected"))
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({
      type: "result", subtype: "error", is_error: true, session_id: sessionId, result: "Authentication required",
    })}\n`))
    child.emit("close", 1)

    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
    expect(events).toEqual([{ type: "done", reason: "PREVIEW_SESSION_INIT_REQUIRED", code: null }])
    expect(JSON.stringify(events)).not.toMatch(/Authentication required|Authentication token rejected/)
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.recordLoomEnd).not.toHaveBeenCalled()
  })

  it("materializes no session or receipt when Claude initializes before an authentication failure", async () => {
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)
    const response = await POST(request({ mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Diagnose.", sessionId, resume: false }))
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "system", subtype: "init", session_id: sessionId })}\n`))
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({
      type: "result", subtype: "error", is_error: true, session_id: sessionId, result: "Authentication required",
    })}\n`))
    child.emit("close", 1)

    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
    expect(events).toEqual([{ type: "done", reason: "AGENT_UNAVAILABLE", code: 1 }])
    expect(JSON.stringify(events)).not.toContain("Authentication required")
    expect(seams.recordLoomStart).not.toHaveBeenCalled()
    expect(seams.recordLoomEnd).not.toHaveBeenCalled()
  })

  it("fails terminal CAS when the active running-app becomes minimized", async () => {
    const child = new FakeChild()
    seams.spawn.mockReturnValue(child)
    seams.loadOwnedWorkingWorld
      .mockResolvedValueOnce({ space: { activeWindowId: "workspace-running-app", windows: [{ id: "workspace-running-app", kind: "running-app", minimized: false }] } })
      .mockResolvedValueOnce({ space: { activeWindowId: "workspace-running-app", windows: [{ id: "workspace-running-app", kind: "running-app", minimized: true }] } })
    const response = await POST(request({ mode: "preview", provider: "cloud", worldId: "world-a", prompt: "Diagnose.", sessionId, resume: false }))
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "system", subtype: "init", session_id: sessionId })}\n`))
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({
      type: "result", subtype: "success", is_error: false, session_id: sessionId, result: "Now stale",
    })}\n`))
    child.emit("close", 0)

    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
    expect(events.at(-1)).toEqual({ type: "done", reason: "PREVIEW_CONTEXT_STALE", code: null })
    expect(JSON.stringify(events)).not.toContain("Now stale")
  })
})
