import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import { createWorkingWorld, type SpaceState } from "@/lib/environment/working-world"

const harness = vi.hoisted(() => ({ snapshot: "", selectCount: 0, save: vi.fn() }))

vi.mock("@/lib/session", () => ({ getUserId: vi.fn(async () => "owner-a") }))
vi.mock("@/lib/environment/space-persistence", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/environment/space-persistence")>(),
  saveOwnedLineWorld: harness.save,
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
  vi.unstubAllGlobals()
  harness.save.mockReset()
  harness.selectCount = 0
  delete process.env.WILLIAMOS_PROJECT_ROOT
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  vi.resetModules()
})

describe("server-derived Line selected-object grounding", () => {
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
})
