import fs from "node:fs/promises"
import nodeFs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import { createWorkingWorld, type SpaceState } from "@/lib/environment/working-world"

const harness = vi.hoisted(() => ({ snapshot: "", selectCount: 0, save: vi.fn(), diff: vi.fn() }))

vi.mock("@/lib/session", () => ({ getUserId: vi.fn(async () => "owner-a") }))
vi.mock("@/lib/environment/space-persistence", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/environment/space-persistence")>(),
  saveOwnedLineWorld: harness.save,
}))
vi.mock("@/lib/loom/workspace-diff", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/loom/workspace-diff")>(),
  deriveWorkspaceFileDiff: harness.diff,
}))
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      harness.selectCount += 1
      const rows = harness.selectCount === 1 ? [{ snapshot: harness.snapshot }] : []
      const query = {
        from: () => query,
        where: () => query,
        limit: () => Promise.resolve(rows),
        then: (resolve: (value: unknown[]) => unknown) => resolve(rows),
      }
      return query
    }),
  },
}))

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  harness.save.mockReset()
  harness.diff.mockReset()
  harness.selectCount = 0
  delete process.env.WILLIAMOS_PROJECT_ROOT
  delete process.env.WILLIAMOS_WORKSPACE_APP_URL
  delete process.env.BETTER_AUTH_URL
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  vi.resetModules()
})

describe("server-derived Line selected-object grounding", () => {
  it.each(["unchanged", "evidence", "configuration", "secret-configuration", "secret-to-valid"] as const)("grounds Preview and fences %s evidence during inference", async (change) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-line-preview-context-"))
    roots.push(root)
    await fs.mkdir(path.join(root, "src"), { recursive: true })
    await fs.writeFile(path.join(root, "src", "authoritative.ts"), "export const preview = 'selected-source'\n")
    const space: SpaceState = {
      schemaVersion: 1,
      revision: 12,
      windows: [
        { id: "workspace-editor", kind: "editor", title: "Source", frame: { x: 24, y: 18, width: 800, height: 600 }, z: 4, minimized: false },
        { id: "workspace-running-app", kind: "running-app", title: "TerraFusion", frame: { x: 840, y: 18, width: 600, height: 600 }, z: 5, minimized: false },
      ],
      openFiles: ["src/authoritative.ts"],
      panes: [{ id: "workspace-pane", filePath: "src/authoritative.ts", selection: { anchor: 0, head: 12 } }],
      selection: { filePath: "src/authoritative.ts", anchor: 0, head: 12 },
      activeWindowId: "workspace-running-app",
      activePaneId: "workspace-pane",
      runningAppUrl: "http://tf.test:5000/real-preview",
    }
    harness.snapshot = JSON.stringify({ ...createWorkingWorld({ intent: "TerraFusion" }), space })
    process.env.WILLIAMOS_PROJECT_ROOT = root
    process.env.WILLIAMOS_WORKSPACE_APP_URL = change === "secret-configuration" || change === "secret-to-valid"
      ? "http://tf.test:5000/real-preview?token=server-secret"
      : "http://tf.test:5000/real-preview"
    process.env.BETTER_AUTH_URL = "https://williamos.test"
    harness.save.mockImplementationOnce(async (input: {
      expectedSelectedContext?: string
      deriveSelectedContext?: (world: ReturnType<typeof createWorkingWorld> & { space: SpaceState }) => Promise<string>
    }) => {
      if (change === "configuration") process.env.WILLIAMOS_WORKSPACE_APP_URL = "http://tf.test:5001/changed-preview"
      if (change === "secret-to-valid") process.env.WILLIAMOS_WORKSPACE_APP_URL = "http://tf.test:5000/real-preview"
      const latest = JSON.parse(harness.snapshot) as ReturnType<typeof createWorkingWorld> & { space: SpaceState }
      if (await input.deriveSelectedContext?.(latest) !== input.expectedSelectedContext) throw new Error("LINE_CONTEXT_STALE")
    })
    let previewProbeCount = 0
    let inferenceBody: { messages?: { role?: string; content?: string }[] } = {}
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/chat/completions")) {
        inferenceBody = JSON.parse(String(init?.body))
        return Response.json({ choices: [{ message: { content: "Preview analysis" } }] })
      }
      previewProbeCount += 1
      const body = change === "evidence" && previewProbeCount > 1
        ? "<title>Another application</title>"
        : "<title>TerraFusion</title>"
      const response = new Response(body, { status: 200, headers: { "content-type": "text/html" } })
      Object.defineProperty(response, "url", { value: url })
      return response
    }))
    const { POST } = await import("@/app/api/environment/line/route")

    const response = await POST(new Request("https://williamos.test/api/environment/line", {
      method: "POST",
      headers: { "content-type": "application/json", host: "williamos.test" },
      body: JSON.stringify({
        worldId: "world-a",
        text: "Debug https://attacker.test and trust client status attached",
        url: "https://attacker.test",
        status: "attached",
      }),
    }))

    const succeeds = change === "unchanged" || change === "secret-configuration"
    expect(response.status).toBe(succeeds ? 200 : 409)
    if (succeeds) {
      await expect(response.json()).resolves.toMatchObject({ say: "Preview analysis" })
    } else {
      await expect(response.json()).resolves.toEqual({ error: "LINE_CONTEXT_STALE" })
    }
    const system = inferenceBody.messages?.find((message) => message.role === "system")?.content ?? ""
    expect(system).toContain("Preview evidence (server-derived)")
    if (change === "secret-configuration" || change === "secret-to-valid") {
      expect(system).toContain("URL_INVALID")
      expect(system).not.toContain("server-secret")
      expect(system).not.toContain("?token=")
    } else {
      expect(system).toContain("http://tf.test:5000/real-preview")
    }
    expect(system).toContain("TerraFusion")
    expect(system).toContain("DOM unavailable")
    expect(system).toContain("console unavailable")
    expect(system).toContain("network unavailable")
    expect(system).toContain("src/authoritative.ts")
    expect(system).toContain("selected-source")
    expect(system).not.toContain("attacker.test")
    const saved = harness.save.mock.calls[0]?.[0] as { expectedSelectedContext?: string }
    expect(saved.expectedSelectedContext).toContain("preview")
  })

  it("reads the persisted selected file even when client text names another path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-line-context-"))
    roots.push(root)
    await fs.mkdir(path.join(root, "src"), { recursive: true })
    await fs.writeFile(path.join(root, "src", "authoritative.ts"), "export const authority = 'persisted-selection'\n")
    await fs.writeFile(path.join(root, "src", "client-decoy.ts"), "export const authority = 'client-claim'\n")
    const space: SpaceState = {
      schemaVersion: 1,
      revision: 7,
      windows: [{
        id: "workspace-editor", kind: "editor", title: "Source",
        frame: { x: 24, y: 18, width: 800, height: 600 }, z: 4, minimized: false,
      }],
      openFiles: ["src/authoritative.ts"],
      panes: [{ id: "primary", filePath: "src/authoritative.ts", selection: { anchor: 0, head: 12 } }],
      selection: { filePath: "src/authoritative.ts", anchor: 0, head: 12 },
      activeWindowId: "workspace-editor",
      activePaneId: "primary",
      runningAppUrl: null,
    }
    harness.snapshot = JSON.stringify({ ...createWorkingWorld({ intent: "TerraFusion" }), space })
    const authoritativePath = path.join(root, "src", "authoritative.ts")
    const beforeBytes = await fs.readFile(authoritativePath)
    harness.save.mockImplementationOnce(async (input: {
      expectedSelectedContext?: string
      deriveSelectedContext?: (world: ReturnType<typeof createWorkingWorld> & { space: SpaceState }) => Promise<string>
    }) => {
      await fs.writeFile(authoritativePath, "export const authority = 'changed-during-inference'\n")
      const latest = JSON.parse(harness.snapshot) as ReturnType<typeof createWorkingWorld> & { space: SpaceState }
      const actual = await input.deriveSelectedContext?.(latest)
      if (actual !== input.expectedSelectedContext) throw new Error("LINE_CONTEXT_STALE")
    })
    process.env.WILLIAMOS_PROJECT_ROOT = root
    let inferenceBody: { messages?: { role?: string; content?: string }[] } = {}
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      inferenceBody = JSON.parse(String(init?.body)) as typeof inferenceBody
      return Response.json({ choices: [{ message: { content: "Grounded answer" } }] })
    }))
    const { POST } = await import("@/app/api/environment/line/route")

    const response = await POST(new Request("http://localhost/api/environment/line", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({ worldId: "world-a", text: "Review src/client-decoy.ts" }),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "LINE_CONTEXT_STALE" })
    const system = inferenceBody.messages?.find((message) => message.role === "system")?.content ?? ""
    expect(system).toContain("src/authoritative.ts")
    expect(system).toContain("persisted-selection")
    expect(system).not.toContain("client-decoy.ts")
    expect(system).not.toContain("client-claim")
    const saved = harness.save.mock.calls[0]?.[0] as { expectedSelectedContext?: string; deriveSelectedContext?: unknown }
    expect(saved).toEqual(expect.objectContaining({
      worldId: "world-a",
      expectedSelectedContext: expect.any(String),
    }))
    expect(saved.expectedSelectedContext).toContain(createHash("sha256").update(beforeBytes).digest("hex"))
    expect(saved.deriveSelectedContext).toEqual(expect.any(Function))
  })

  it("grounds Changes actions from the persisted path and rejects a patch that changes during inference", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-line-diff-context-"))
    roots.push(root)
    await fs.mkdir(path.join(root, "src"), { recursive: true })
    await fs.writeFile(path.join(root, "src", "authoritative.ts"), "export const value = 'current-file-content'\n")
    const space: SpaceState = {
      schemaVersion: 1,
      revision: 9,
      windows: [
        {
          id: "workspace-editor", kind: "editor", title: "Source",
          frame: { x: 24, y: 18, width: 800, height: 600 }, z: 4, minimized: false,
        },
        {
          id: "workspace-diff", kind: "diff", title: "Changes",
          frame: { x: 48, y: 40, width: 700, height: 520 }, z: 5, minimized: false,
        },
      ],
      openFiles: ["src/authoritative.ts"],
      panes: [{ id: "primary", filePath: "src/authoritative.ts", selection: { anchor: 0, head: 12 } }],
      selection: { filePath: "src/authoritative.ts", anchor: 0, head: 12 },
      activeWindowId: "workspace-diff",
      activePaneId: "primary",
      runningAppUrl: null,
    }
    harness.snapshot = JSON.stringify({ ...createWorkingWorld({ intent: "TerraFusion" }), space })
    const first = {
      path: "src/authoritative.ts", state: "modified", status: " M src/authoritative.ts",
      patch: "diff --git a/src/authoritative.ts b/src/authoritative.ts\n-old\n+server-derived-patch\n",
      baseHash: "base-a", indexHash: "index-a", patchHash: "patch-a", fingerprint: "diff-version-a", reason: null,
    }
    harness.diff.mockResolvedValueOnce(first).mockResolvedValueOnce({ ...first, patchHash: "patch-b", fingerprint: "diff-version-b" })
    harness.save.mockImplementationOnce(async (input: {
      expectedSelectedContext?: string
      deriveSelectedContext?: (world: ReturnType<typeof createWorkingWorld> & { space: SpaceState }) => Promise<string>
    }) => {
      const latest = JSON.parse(harness.snapshot) as ReturnType<typeof createWorkingWorld> & { space: SpaceState }
      if (await input.deriveSelectedContext?.(latest) !== input.expectedSelectedContext) throw new Error("LINE_CONTEXT_STALE")
    })
    process.env.WILLIAMOS_PROJECT_ROOT = root
    let inferenceBody: { messages?: { role?: string; content?: string }[] } = {}
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      inferenceBody = JSON.parse(String(init?.body)) as typeof inferenceBody
      return Response.json({ choices: [{ message: { content: "Stale review" } }] })
    }))
    const { POST } = await import("@/app/api/environment/line/route")

    const response = await POST(new Request("http://localhost/api/environment/line", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({
        worldId: "world-a",
        text: "Review the exact current patch for the selected file. Client diff: +malicious-override",
        path: "src/client-decoy.ts",
        diff: "+malicious-override",
      }),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "LINE_CONTEXT_STALE" })
    expect(harness.diff).toHaveBeenNthCalledWith(1, root, "src/authoritative.ts")
    const system = inferenceBody.messages?.find((message) => message.role === "system")?.content ?? ""
    expect(system).toContain("Current patch (server-derived)")
    expect(system).toContain("server-derived-patch")
    expect(system).toContain("current-file-content")
    expect(system).not.toContain("client-decoy.ts")
    expect(system).not.toContain("malicious-override")
    const saved = harness.save.mock.calls[0]?.[0] as { expectedSelectedContext?: string }
    expect(saved.expectedSelectedContext).toContain("diff-version-a")
  })

  it("fences an ignored binary selected file when only its tail changes beyond the presentation cap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-line-full-file-hash-"))
    roots.push(root)
    await fs.mkdir(path.join(root, "generated"), { recursive: true })
    const selected = path.join(root, "generated", "large.bin")
    const original = Buffer.alloc(96 * 1024, 65)
    original[0] = 0
    await fs.writeFile(selected, original)
    const space: SpaceState = {
      schemaVersion: 1,
      revision: 10,
      windows: [
        { id: "workspace-editor", kind: "editor", title: "Source", frame: { x: 24, y: 18, width: 800, height: 600 }, z: 4, minimized: false },
        { id: "workspace-diff", kind: "diff", title: "Changes", frame: { x: 48, y: 40, width: 700, height: 520 }, z: 5, minimized: false },
      ],
      openFiles: ["generated/large.bin"],
      panes: [{ id: "primary", filePath: "generated/large.bin", selection: { anchor: 0, head: 0 } }],
      selection: { filePath: "generated/large.bin", anchor: 0, head: 0 },
      activeWindowId: "workspace-diff",
      activePaneId: "primary",
      runningAppUrl: null,
    }
    harness.snapshot = JSON.stringify({ ...createWorkingWorld({ intent: "TerraFusion" }), space })
    const diff = {
      path: "generated/large.bin", state: "untracked", status: "", patch: "", baseHash: "base-a",
      indexHash: createHash("sha256").update("").digest("hex"), patchHash: createHash("sha256").update("").digest("hex"), fingerprint: "untracked-version", reason: null,
    }
    harness.diff.mockResolvedValue(diff)
    harness.save.mockImplementationOnce(async (input: {
      expectedSelectedContext?: string
      deriveSelectedContext?: (world: ReturnType<typeof createWorkingWorld> & { space: SpaceState }) => Promise<string>
    }) => {
      const changed = Buffer.from(original)
      changed[changed.length - 1] = 66
      await fs.writeFile(selected, changed)
      const latest = JSON.parse(harness.snapshot) as ReturnType<typeof createWorkingWorld> & { space: SpaceState }
      if (await input.deriveSelectedContext?.(latest) !== input.expectedSelectedContext) throw new Error("LINE_CONTEXT_STALE")
    })
    process.env.WILLIAMOS_PROJECT_ROOT = root
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "Stale binary review" } }] })))
    const { POST } = await import("@/app/api/environment/line/route")

    const response = await POST(new Request("http://localhost/api/environment/line", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({ worldId: "world-a", text: "Review the current ignored binary change" }),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "LINE_CONTEXT_STALE" })
    const saved = harness.save.mock.calls[0]?.[0] as { expectedSelectedContext?: string }
    expect(saved.expectedSelectedContext).toContain(createHash("sha256").update(original).digest("hex"))
  })

  it("rejects the same MM status and patch when the exact staged index identity changes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-line-index-context-"))
    roots.push(root)
    await fs.mkdir(path.join(root, "src"), { recursive: true })
    await fs.writeFile(path.join(root, "src", "authoritative.ts"), "export const value = 'worktree'\n")
    const space: SpaceState = {
      schemaVersion: 1, revision: 11,
      windows: [
        { id: "workspace-editor", kind: "editor", title: "Source", frame: { x: 24, y: 18, width: 800, height: 600 }, z: 4, minimized: false },
        { id: "workspace-diff", kind: "diff", title: "Changes", frame: { x: 48, y: 40, width: 700, height: 520 }, z: 5, minimized: false },
      ],
      openFiles: ["src/authoritative.ts"], panes: [{ id: "primary", filePath: "src/authoritative.ts" }],
      selection: { filePath: "src/authoritative.ts", anchor: 0, head: 0 }, activeWindowId: "workspace-diff", activePaneId: "primary", runningAppUrl: null,
    }
    harness.snapshot = JSON.stringify({ ...createWorkingWorld({ intent: "TerraFusion" }), space })
    const first = {
      path: "src/authoritative.ts", state: "modified", status: "MM src/authoritative.ts",
      patch: "+same-worktree\n", baseHash: "base-a", indexHash: "index-a", patchHash: "patch-same",
      fingerprint: JSON.stringify({ baseHash: "base-a", indexHash: "index-a", patchHash: "patch-same" }), reason: null,
    }
    harness.diff.mockResolvedValueOnce(first).mockResolvedValueOnce({
      ...first, indexHash: "index-b",
      fingerprint: JSON.stringify({ baseHash: "base-a", indexHash: "index-b", patchHash: "patch-same" }),
    })
    harness.save.mockImplementationOnce(async (input: {
      expectedSelectedContext?: string
      deriveSelectedContext?: (world: ReturnType<typeof createWorkingWorld> & { space: SpaceState }) => Promise<string>
    }) => {
      const latest = JSON.parse(harness.snapshot) as ReturnType<typeof createWorkingWorld> & { space: SpaceState }
      if (await input.deriveSelectedContext?.(latest) !== input.expectedSelectedContext) throw new Error("LINE_CONTEXT_STALE")
    })
    process.env.WILLIAMOS_PROJECT_ROOT = root
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "Stale staged review" } }] })))
    const { POST } = await import("@/app/api/environment/line/route")

    const response = await POST(new Request("http://localhost/api/environment/line", {
      method: "POST", headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({ worldId: "world-a", text: "Review the current staged change" }),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "LINE_CONTEXT_STALE" })
    const saved = harness.save.mock.calls[0]?.[0] as { expectedSelectedContext?: string }
    expect(saved.expectedSelectedContext).toContain("index-a")
  })

  it.each(["huge", "directory"])("refuses %s selected-file identity before inference or persistence", async (kind) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-line-identity-refusal-"))
    roots.push(root)
    await fs.mkdir(path.join(root, "generated"), { recursive: true })
    const selected = path.join(root, "generated", kind === "huge" ? "huge.txt" : "special")
    if (kind === "huge") {
      await fs.writeFile(selected, "bounded-prefix")
      await fs.truncate(selected, 40 * 1024 * 1024)
    } else {
      await fs.mkdir(selected)
    }
    const selectedPath = `generated/${path.basename(selected)}`
    const space: SpaceState = {
      schemaVersion: 1, revision: 12,
      windows: [
        { id: "workspace-editor", kind: "editor", title: "Source", frame: { x: 24, y: 18, width: 800, height: 600 }, z: 4, minimized: false },
        { id: "workspace-diff", kind: "diff", title: "Changes", frame: { x: 48, y: 40, width: 700, height: 520 }, z: 5, minimized: false },
      ],
      openFiles: [selectedPath], panes: [{ id: "primary", filePath: selectedPath }],
      selection: { filePath: selectedPath, anchor: 0, head: 0 }, activeWindowId: "workspace-diff", activePaneId: "primary", runningAppUrl: null,
    }
    harness.snapshot = JSON.stringify({ ...createWorkingWorld({ intent: "TerraFusion" }), space })
    process.env.WILLIAMOS_PROJECT_ROOT = root
    const inference = vi.fn(async () => Response.json({ choices: [{ message: { content: "must not run" } }] }))
    vi.stubGlobal("fetch", inference)
    const open = vi.spyOn(nodeFs.promises, "open")
    const { POST } = await import("@/app/api/environment/line/route")

    const response = await POST(new Request("http://localhost/api/environment/line", {
      method: "POST", headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({ worldId: "world-a", text: "Review the current change" }),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "LINE_CONTEXT_UNAVAILABLE" })
    expect(inference).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(harness.diff).not.toHaveBeenCalled()
    expect(harness.save).not.toHaveBeenCalled()
  })

  it("bounds a delayed selected-file open within the total identity deadline", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-line-delayed-open-"))
    roots.push(root)
    await fs.mkdir(path.join(root, "src"), { recursive: true })
    const selected = path.join(root, "src", "slow.ts")
    await fs.writeFile(selected, "export const slow = true\n")
    const selectedStat = await fs.lstat(selected)
    const delayedHandle = await fs.open(selected, "r")
    const space: SpaceState = {
      schemaVersion: 1, revision: 13,
      windows: [
        { id: "workspace-editor", kind: "editor", title: "Source", frame: { x: 24, y: 18, width: 800, height: 600 }, z: 4, minimized: false },
        { id: "workspace-diff", kind: "diff", title: "Changes", frame: { x: 48, y: 40, width: 700, height: 520 }, z: 5, minimized: false },
      ],
      openFiles: ["src/slow.ts"], panes: [{ id: "primary", filePath: "src/slow.ts" }],
      selection: { filePath: "src/slow.ts", anchor: 0, head: 0 }, activeWindowId: "workspace-diff", activePaneId: "primary", runningAppUrl: null,
    }
    harness.snapshot = JSON.stringify({ ...createWorkingWorld({ intent: "TerraFusion" }), space })
    harness.diff.mockResolvedValue({
      path: "src/slow.ts", state: "modified", status: " M src/slow.ts", patch: "+slow\n",
      baseHash: "base", indexHash: "index", patchHash: "patch", fingerprint: "diff", reason: null,
    })
    process.env.WILLIAMOS_PROJECT_ROOT = root
    const inference = vi.fn(async () => Response.json({ choices: [{ message: { content: "must not run" } }] }))
    vi.stubGlobal("fetch", inference)
    vi.useFakeTimers()
    vi.spyOn(nodeFs.promises, "realpath")
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce(selected)
    vi.spyOn(nodeFs.promises, "lstat").mockResolvedValue(selectedStat)
    const open = vi.spyOn(nodeFs.promises, "open").mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(delayedHandle), 6_000)
    }) as ReturnType<typeof nodeFs.promises.open>)
    const { POST } = await import("@/app/api/environment/line/route")

    const pending = POST(new Request("http://localhost/api/environment/line", {
      method: "POST", headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify({ worldId: "world-a", text: "Review the current change" }),
    }))
    await vi.advanceTimersByTimeAsync(0)
    expect(open).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(6_000)
    const response = await pending

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "LINE_CONTEXT_UNAVAILABLE" })
    expect(inference).not.toHaveBeenCalled()
    expect(harness.diff).not.toHaveBeenCalled()
    expect(harness.save).not.toHaveBeenCalled()
  })
})
