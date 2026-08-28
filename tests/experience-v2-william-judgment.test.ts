import { describe, expect, it } from "vitest"

import {
  createWorkingWorld,
  validateWorkingWorld,
  type SpaceState,
} from "@/lib/environment/working-world"
import {
  loadOrCreateOwnedSpace,
  saveOwnedJudgment,
  saveOwnedLineWorld,
  type OwnedWorkingWorldRecord,
  type SpaceWorkingWorldStore,
} from "@/lib/environment/space-persistence"
import {
  deriveWilliamSafetyFacts,
  requestWilliamJudgment,
  williamJudgmentBasisFingerprint,
} from "@/lib/environment/william-judgment"

class MemoryStore implements SpaceWorkingWorldStore {
  readonly rows = new Map<string, OwnedWorkingWorldRecord>()

  async findOwned(userId: string, worldId: string) {
    const row = this.rows.get(worldId)
    return row?.userId === userId ? row : null
  }

  async findLatestOwned(userId: string) {
    return [...this.rows.values()].find((row) => row.userId === userId) ?? null
  }

  async findLatestOwnedForProject(userId: string) {
    return this.findLatestOwned(userId)
  }

  async insertOwned(row: OwnedWorkingWorldRecord) {
    this.rows.set(row.id, row)
  }

  async updateOwned(userId: string, worldId: string, snapshot: string, intent: string, expectedSnapshot: string) {
    const row = await this.findOwned(userId, worldId)
    if (!row || row.snapshot !== expectedSnapshot) return false
    this.rows.set(worldId, { ...row, snapshot, intent, updatedAt: new Date(row.updatedAt.getTime() + 1) })
    return true
  }
}

function space(): SpaceState {
  return {
    schemaVersion: 1,
    revision: 3,
    windows: [
      { id: "source", kind: "editor", title: "Source", frame: { x: 10, y: 20, width: 700, height: 500 }, z: 2, minimized: false },
      { id: "preview", kind: "running-app", title: "Preview", frame: { x: 720, y: 20, width: 700, height: 500 }, z: 1, minimized: false },
    ],
    openFiles: ["src/search.ts"],
    panes: [{ id: "pane-a", filePath: "src/search.ts", selection: { anchor: 4, head: 12 } }],
    selection: { filePath: "src/search.ts", anchor: 4, head: 12 },
    activeWindowId: "source",
    activePaneId: "pane-a",
    runningAppUrl: "https://preview.terrafusion.test/",
  }
}

describe("Experience V2 persistent William judgment", () => {
  it("grounds model judgment only in separately derived deterministic world facts", async () => {
    const world = validateWorkingWorld({
      ...createWorkingWorld({ intent: "Improve TerraFusion search" }),
      spine: {
        ...createWorkingWorld({ intent: "source" }).spine,
        projectName: "TerraFusion",
        execution: "validating",
      },
      space: space(),
      lastRedValidation: { ref: "vitest:search", at: "2026-08-27T17:59:00.000Z" },
    })
    const safetyFacts = deriveWilliamSafetyFacts(world)

    expect(safetyFacts).toEqual(expect.arrayContaining([
      { key: "active-file", label: "Active file", value: "src/search.ts", source: "deterministic" },
      { key: "preview", label: "Developer preview", value: "attached", source: "deterministic" },
      { key: "execution", label: "Execution", value: "validating", source: "deterministic" },
      { key: "last-red-validation", label: "Last red validation", value: "vitest:search at 2026-08-27T17:59:00.000Z", source: "deterministic" },
    ]))

    const judgment = await requestWilliamJudgment(world, {
      baseUrl: "http://inference.test/v1",
      model: "local-model",
      apiKey: "local-test-key",
      now: () => "2026-08-27T18:00:00.000Z",
      fetchImpl: async (_input, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer local-test-key")
        const request = JSON.parse(String(init?.body)) as { messages: { content: string }[] }
        expect(request.messages[1]?.content).toContain("active-file")
        expect(request.messages[1]?.content).toContain("last-red-validation")
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          recommendation: "Do not merge this yet.",
          rationale: "The selected search file still has a red validation.",
          basisKeys: ["active-file", "last-red-validation"],
          confidence: 0.91,
        }) } }] })
      },
    })

    expect(judgment).toEqual({
      recommendation: "Do not merge this yet.",
      rationale: "The selected search file still has a red validation.",
      basis: [
        { key: "active-file", label: "Active file", value: "src/search.ts" },
        { key: "last-red-validation", label: "Last red validation", value: "vitest:search at 2026-08-27T17:59:00.000Z" },
      ],
      confidence: 0.91,
      generatedAt: "2026-08-27T18:00:00.000Z",
      basisFingerprint: williamJudgmentBasisFingerprint(world),
      provenance: { provider: "williamos-inference", model: "local-model" },
    })
  })

  it("truthfully refuses malformed or ungrounded inference output", async () => {
    const world = validateWorkingWorld({ ...createWorkingWorld({ intent: "TerraFusion" }), space: space() })

    await expect(requestWilliamJudgment(world, {
      baseUrl: "http://inference.test/v1",
      model: "local-model",
      fetchImpl: async () => Response.json({ choices: [{ message: { content: JSON.stringify({
        recommendation: "Ship it.",
        rationale: "Everything is green.",
        basisKeys: ["invented-green-build"],
        confidence: 1,
      }) } }] }),
    })).rejects.toThrow("JUDGMENT_BASIS_UNKNOWN")

    await expect(requestWilliamJudgment(world, {
      baseUrl: "http://inference.test/v1",
      model: "local-model",
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    })).rejects.toThrow("JUDGMENT_INFERENCE_UNAVAILABLE")
  })

  it("persists judgment without losing Space state and restores it in the Space envelope", async () => {
    const store = new MemoryStore()
    const world = validateWorkingWorld({ ...createWorkingWorld({ intent: "TerraFusion" }), space: space() })
    store.rows.set("world-a", {
      id: "world-a",
      userId: "owner-a",
      intent: world.intent,
      snapshot: JSON.stringify(world),
      updatedAt: new Date("2026-08-27T17:00:00.000Z"),
    })
    const judgment = {
      recommendation: "Inspect the failing validation before changing the search path.",
      rationale: "The current red result is newer than the last green result.",
      basis: [{ key: "last-red-validation", label: "Last red validation", value: "vitest:search at 2026-08-27T17:59:00.000Z" }],
      confidence: 0.86,
      generatedAt: "2026-08-27T18:00:00.000Z",
      basisFingerprint: williamJudgmentBasisFingerprint(world),
      provenance: { provider: "williamos-inference", model: "local-model" },
    } as const

    await saveOwnedJudgment({
      userId: "owner-a", worldId: "world-a", judgment,
      expectedBasisFingerprint: williamJudgmentBasisFingerprint(world),
    }, store)
    const reopened = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      worldId: "world-a",
      workspaceAppUrl: "https://preview.terrafusion.test/",
    }, store)

    expect(reopened).toMatchObject({ worldId: "world-a", space: { revision: 3 }, judgment })
    expect(JSON.parse(store.rows.get("world-a")!.snapshot).space.selection.filePath).toBe("src/search.ts")
  })

  it("does not restore a preview-grounded judgment when the admitted preview changed", async () => {
    const store = new MemoryStore()
    const attachedWorld = validateWorkingWorld({
      ...createWorkingWorld({ intent: "TerraFusion" }),
      space: space(),
    })
    const judgment = {
      recommendation: "Keep the live preview beside the selected source.",
      rationale: "The developer preview is attached.",
      basis: [{ key: "preview", label: "Developer preview", value: "attached" }],
      confidence: 0.82,
      generatedAt: "2026-08-27T18:00:00.000Z",
      basisFingerprint: williamJudgmentBasisFingerprint(attachedWorld),
      provenance: { provider: "williamos-inference", model: "local-model" },
    } as const
    const persisted = validateWorkingWorld({ ...attachedWorld, judgment })
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: persisted.intent,
      snapshot: JSON.stringify(persisted), updatedAt: new Date("2026-08-27T18:01:00.000Z"),
    })

    const reopened = await loadOrCreateOwnedSpace({
      userId: "owner-a",
      worldId: "world-a",
      workspaceAppUrl: null,
    }, store)

    expect(reopened?.space.runningAppUrl).toBeNull()
    expect(reopened?.judgment).toBeNull()
  })

  it("preserves a newer judgment when a stale Line turn saves afterward", async () => {
    const store = new MemoryStore()
    const staleLineWorld = validateWorkingWorld({ ...createWorkingWorld({ intent: "TerraFusion" }), space: space() })
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: staleLineWorld.intent,
      snapshot: JSON.stringify(staleLineWorld), updatedAt: new Date("2026-08-27T17:00:00.000Z"),
    })
    const judgment = {
      recommendation: "Keep the preview beside the selected source.",
      rationale: "Both are active in the current Space.",
      basis: [{ key: "preview", label: "Developer preview", value: "attached" }],
      confidence: 0.8,
      generatedAt: "2026-08-27T18:00:00.000Z",
      basisFingerprint: williamJudgmentBasisFingerprint(staleLineWorld),
      provenance: { provider: "williamos-inference", model: "local-model" },
    } as const
    await saveOwnedJudgment({
      userId: "owner-a", worldId: "world-a", judgment,
      expectedBasisFingerprint: williamJudgmentBasisFingerprint(staleLineWorld),
    }, store)

    await saveOwnedLineWorld({
      userId: "owner-a",
      worldId: "world-a",
      world: { ...staleLineWorld, conversation: [{ role: "owner", content: "review this", at: "2026-08-27T18:01:00.000Z" }] },
      isNew: false,
    }, store)

    expect(JSON.parse(store.rows.get("world-a")!.snapshot).judgment).toEqual(judgment)
  })

  it("refuses to attach a completed inference to world facts that changed while it ran", async () => {
    const store = new MemoryStore()
    const original = validateWorkingWorld({ ...createWorkingWorld({ intent: "TerraFusion" }), space: space() })
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: original.intent,
      snapshot: JSON.stringify(original), updatedAt: new Date("2026-08-27T17:00:00.000Z"),
    })
    const originalFingerprint = williamJudgmentBasisFingerprint(original)
    const judgment = {
      recommendation: "Keep the preview beside the selected source.",
      rationale: "Both were active when reasoning began.",
      basis: [{ key: "preview", label: "Developer preview", value: "attached" }],
      confidence: 0.8,
      generatedAt: "2026-08-27T18:00:00.000Z",
      basisFingerprint: originalFingerprint,
      provenance: { provider: "williamos-inference", model: "local-model" },
    } as const
    const changed = validateWorkingWorld({
      ...original,
      space: { ...space(), runningAppUrl: null },
    })
    store.rows.set("world-a", { ...store.rows.get("world-a")!, snapshot: JSON.stringify(changed) })

    await expect(saveOwnedJudgment({
      userId: "owner-a", worldId: "world-a", judgment,
      expectedBasisFingerprint: originalFingerprint,
    }, store)).rejects.toThrow("JUDGMENT_BASIS_STALE")
    expect(JSON.parse(store.rows.get("world-a")!.snapshot).judgment).toBeNull()
  })

  it("clears a persisted judgment when a Line mutation changes hidden basis facts", async () => {
    const store = new MemoryStore()
    const original = validateWorkingWorld({ ...createWorkingWorld({ intent: "TerraFusion" }), space: space() })
    const judgment = {
      recommendation: "Continue with the selected source.",
      rationale: "No validation failure was recorded.",
      basis: [{ key: "active-file", label: "Active file", value: "src/search.ts" }],
      confidence: 0.7,
      generatedAt: "2026-08-27T18:00:00.000Z",
      basisFingerprint: williamJudgmentBasisFingerprint(original),
      provenance: { provider: "williamos-inference", model: "local-model" },
    } as const
    const persisted = validateWorkingWorld({ ...original, judgment })
    store.rows.set("world-a", {
      id: "world-a", userId: "owner-a", intent: original.intent,
      snapshot: JSON.stringify(persisted), updatedAt: new Date("2026-08-27T17:00:00.000Z"),
    })

    await saveOwnedLineWorld({
      userId: "owner-a",
      worldId: "world-a",
      world: { ...original, lastRedValidation: { ref: "vitest:search", at: "2026-08-27T18:01:00.000Z" } },
      isNew: false,
    }, store)

    expect(JSON.parse(store.rows.get("world-a")!.snapshot).judgment).toBeNull()
  })
})
