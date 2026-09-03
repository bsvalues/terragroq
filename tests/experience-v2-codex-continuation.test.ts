import { describe, expect, it, vi } from "vitest"

import { createWorkingWorld } from "@/lib/environment/working-world"
import { createDefaultSpace } from "@/lib/environment/space-persistence"
import {
  codexContinuationEvidenceEvent,
  deriveCodexPathEvidence,
  planCodexContinuation,
  prepareCodexContinuation,
  readCodexContinuation,
  selectContinuationPath,
} from "@/lib/loom/codex-continuation"

describe("Experience V2 Codex continuation", () => {
  it("reads the canonical nested assignment receipt shape and top-level ready receipt shape", () => {
    const recordedAt = "2026-08-31T17:00:00.000Z"
    expect([
      codexContinuationEvidenceEvent({
        eventType: "EVIDENCE_RECORDED",
        entityType: "loom_codex_assignment",
        entityId: "thread-live",
        createdAt: recordedAt,
        metadata: {
          worldId: "world-1",
          outcome: { key: "OUTCOME-1" },
          workOrder: { id: 42 },
          grant: { id: 17 },
          promotionPath: "b.ts",
        },
      }),
      codexContinuationEvidenceEvent({
        eventType: "EVIDENCE_RECORDED",
        entityType: "loom_codex_ready",
        entityId: "thread-ready",
        createdAt: recordedAt,
        metadata: { selectedPath: "a.ts", committed: true },
      }),
    ]).toEqual([
      { entityType: "loom_codex_assignment", entityId: "thread-live", selectedPath: "b.ts", committed: false, terminal: false, recordedAt },
      { entityType: "loom_codex_ready", entityId: "thread-ready", selectedPath: "a.ts", committed: true, terminal: false, recordedAt },
    ])
  })

  it("does not leave a terminal failed assignment permanently in flight", () => {
    expect(deriveCodexPathEvidence([
      { entityType: "loom_codex_assignment", entityId: "thread-failed", selectedPath: "b.ts" },
      { entityType: "loom_agent", entityId: "thread-failed", terminal: true },
      { entityType: "loom_codex_assignment", entityId: "thread-live", selectedPath: "c.ts" },
      { entityType: "loom_codex_ready", entityId: "thread-ready", selectedPath: "a.ts", committed: true },
    ])).toEqual({
      assignedPaths: ["c.ts"],
      completedPaths: ["a.ts"],
    })
  })

  it("releases an abandoned assignment after the bounded execution lease", () => {
    expect(deriveCodexPathEvidence([
      {
        entityType: "loom_codex_assignment",
        entityId: "thread-abandoned",
        selectedPath: "b.ts",
        recordedAt: "2026-08-31T15:00:00.000Z",
      },
    ], Date.parse("2026-08-31T17:00:01.000Z"))).toEqual({
      assignedPaths: [],
      completedPaths: [],
    })
  })

  it("selects the next unfinished path in the immutable Work Order reservation", () => {
    expect(planCodexContinuation({
      worldId: "experience-v2",
      outcomeKey: "OUTCOME-EXPERIENCE-V2",
      workOrderId: 42,
      grantId: 17,
      title: "Finish seamless continuation",
      objective: "Carry the active objective forward without owner ceremony.",
      acceptanceCriteria: [
        "The next bounded assignment starts automatically.",
        "Reload restores the continued Space.",
      ],
      validators: ["pnpm vitest run tests/experience-v2-codex-continuation.test.ts"],
      allowedPaths: [
        "lib/loom/codex-continuation.ts",
        "app/api/loom/codex/route.ts",
        "components/workspace-shell/agent-sessions.tsx",
      ],
      completedPaths: ["lib/loom/codex-continuation.ts"],
      assignedPaths: [],
    })).toEqual({
      status: "NEXT_ASSIGNMENT",
      selectedPath: "app/api/loom/codex/route.ts",
      task: [
        "Continue Work Order 42: Finish seamless continuation.",
        "Work only in app/api/loom/codex/route.ts.",
        "Objective: Carry the active objective forward without owner ceremony.",
        "Acceptance criteria:",
        "- The next bounded assignment starts automatically.",
        "- Reload restores the continued Space.",
        "Validators:",
        "- pnpm vitest run tests/experience-v2-codex-continuation.test.ts",
        "Implement the part of this already-authorized Work Order that belongs in the selected file. Do not widen scope.",
      ].join("\n"),
    })
  })

  it("does not let a stale assignment suppress a path that already completed", () => {
    expect(planCodexContinuation({
      worldId: "experience-v2",
      outcomeKey: "OUTCOME-EXPERIENCE-V2",
      workOrderId: 42,
      grantId: 17,
      title: "Finish seamless continuation",
      objective: "Carry the active objective forward.",
      acceptanceCriteria: ["Continue safely."],
      validators: ["pnpm test"],
      allowedPaths: ["a.ts", "b.ts", "c.ts"],
      completedPaths: ["a.ts"],
      assignedPaths: ["a.ts"],
    })).toMatchObject({ status: "NEXT_ASSIGNMENT", selectedPath: "b.ts" })
  })

  it.each(["lib/environment/", "tests/**", "src/[legacy].ts"])(
    "does not turn a broad reservation into a literal file assignment: %s",
    (reservation) => {
      expect(planCodexContinuation({
        worldId: "experience-v2",
        outcomeKey: "OUTCOME-EXPERIENCE-V2",
        workOrderId: 42,
        grantId: 17,
        title: "Continue safely",
        objective: "Use only a concrete file.",
        acceptanceCriteria: ["Do not dispatch a broad reservation."],
        validators: ["pnpm test"],
        allowedPaths: ["a.ts", reservation],
        completedPaths: ["a.ts"],
        assignedPaths: [],
      })).toEqual({ status: "PATH_RESERVATION_NOT_EXACT", reservation })
    },
  )

  it("settles when every reserved path has durable completion evidence", () => {
    expect(planCodexContinuation({
      worldId: "experience-v2",
      outcomeKey: "OUTCOME-EXPERIENCE-V2",
      workOrderId: 42,
      grantId: 17,
      title: "Finish seamless continuation",
      objective: "Carry the active objective forward.",
      acceptanceCriteria: ["Continue safely."],
      validators: ["pnpm test"],
      allowedPaths: ["a.ts", "b.ts"],
      completedPaths: ["a.ts", "b.ts"],
      assignedPaths: [],
    })).toEqual({ status: "WORK_ORDER_PATHS_COMPLETE" })
  })

  it("does not auto-start the first assignment before a Space-bound slice completes", () => {
    expect(planCodexContinuation({
      worldId: "experience-v2",
      outcomeKey: "OUTCOME-EXPERIENCE-V2",
      workOrderId: 42,
      grantId: 17,
      title: "Finish seamless continuation",
      objective: "Carry the active objective forward.",
      acceptanceCriteria: ["Continue safely."],
      validators: ["pnpm test"],
      allowedPaths: ["a.ts", "b.ts"],
      completedPaths: [],
      assignedPaths: [],
    })).toEqual({ status: "WAITING_FOR_FIRST_ASSIGNMENT" })
  })

  it("fails closed when an in-flight assignment is the only unfinished path", () => {
    expect(planCodexContinuation({
      worldId: "experience-v2",
      outcomeKey: "OUTCOME-EXPERIENCE-V2",
      workOrderId: 42,
      grantId: 17,
      title: "Finish seamless continuation",
      objective: "Carry the active objective forward.",
      acceptanceCriteria: ["Continue safely."],
      validators: ["pnpm test"],
      allowedPaths: ["a.ts", "b.ts"],
      completedPaths: ["a.ts"],
      assignedPaths: ["b.ts"],
    })).toEqual({ status: "ASSIGNMENT_IN_FLIGHT", selectedPath: "b.ts" })
  })

  it("persists the next selected path into the existing Space without inventing new chrome", () => {
    const world = {
      ...createWorkingWorld({ intent: "Finish Experience V2" }),
      space: createDefaultSpace(null),
    }
    const selected = selectContinuationPath(world, "app/api/loom/codex/route.ts")

    expect(selected.space).toMatchObject({
      revision: 1,
      activeWindowId: "workspace-editor",
      activePaneId: "workspace-pane",
      openFiles: ["app/api/loom/codex/route.ts"],
      selection: { filePath: "app/api/loom/codex/route.ts", anchor: 0, head: 0 },
      panes: [{
        id: "workspace-pane",
        filePath: "app/api/loom/codex/route.ts",
        selection: { anchor: 0, head: 0 },
      }],
    })
    expect(selected.space?.windows).toEqual(world.space.windows)
  })

  it("keeps the continuation selection bound to the active repository mount and revision", () => {
    const activeFileRef = {
      projectIdentity: "/srv/williamos/projects/terrafusion",
      repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: null,
      observedRevision: "a".repeat(40),
      path: "src/previous.ts",
    }
    const initialSpace = createDefaultSpace(null)
    const world = {
      ...createWorkingWorld({ intent: "Finish Experience V2" }),
      space: {
        ...initialSpace,
        openFiles: [activeFileRef.path],
        fileRefs: [activeFileRef],
        panes: [{
          id: "workspace-pane",
          filePath: activeFileRef.path,
          fileRef: activeFileRef,
          selection: { anchor: 4, head: 4 },
        }],
        selection: { filePath: activeFileRef.path, fileRef: activeFileRef, anchor: 4, head: 4 },
      },
    }

    const selected = selectContinuationPath(world, "src/next.ts")
    const expectedFileRef = { ...activeFileRef, path: "src/next.ts" }

    expect(selected.space).toMatchObject({
      openFiles: ["src/previous.ts", "src/next.ts"],
      fileRefs: [activeFileRef, expectedFileRef],
      selection: { filePath: "src/next.ts", fileRef: expectedFileRef, anchor: 0, head: 0 },
      panes: [{
        id: "workspace-pane",
        filePath: "src/next.ts",
        fileRef: expectedFileRef,
        selection: { anchor: 0, head: 0 },
      }],
    })
  })

  it("restores the same pending assignment without generating another Space revision", () => {
    const world = {
      ...createWorkingWorld({ intent: "Finish Experience V2" }),
      space: createDefaultSpace(null),
    }
    const selected = selectContinuationPath(world, "lib/loom/codex-continuation.ts")

    expect(selectContinuationPath(selected, "lib/loom/codex-continuation.ts")).toBe(selected)
  })

  it("rechecks the exact binding and atomically persists the server-selected next assignment", async () => {
    const world = {
      ...createWorkingWorld({ intent: "Finish Experience V2" }),
      space: createDefaultSpace(null),
    }
    const snapshot = JSON.stringify(world)
    const persist = vi.fn().mockResolvedValue("PERSISTED")

    const result = await prepareCodexContinuation({
      userId: "owner",
      worldId: "experience-v2",
      outcomeKey: "OUTCOME-EXPERIENCE-V2",
      workOrderId: 42,
      grantId: 17,
      completedPath: "lib/loom/codex-continuation.ts",
    }, {
      load: vi.fn().mockResolvedValue({
        snapshot,
        authorityVersion: "authority-v1",
        world,
        outcomeKey: "OUTCOME-EXPERIENCE-V2",
        workOrderId: 42,
        grantId: 17,
        title: "Finish seamless continuation",
        objective: "Carry the objective forward.",
        acceptanceCriteria: ["Continue automatically."],
        validators: ["pnpm test"],
        allowedPaths: ["lib/loom/codex-continuation.ts", "app/api/loom/codex/route.ts"],
        completedPaths: ["lib/loom/codex-continuation.ts"],
        assignedPaths: [],
      }),
      inspectTarget: vi.fn().mockResolvedValue(true),
      persist,
    })

    expect(result).toMatchObject({ status: "NEXT_ASSIGNMENT", selectedPath: "app/api/loom/codex/route.ts" })
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner",
      worldId: "experience-v2",
      expectedSnapshot: snapshot,
      outcomeKey: "OUTCOME-EXPERIENCE-V2",
      workOrderId: 42,
      grantId: 17,
      authorityVersion: "authority-v1",
    }))
    const persistedWorld = JSON.parse(persist.mock.calls[0][0].nextSnapshot)
    expect(persistedWorld.space.selection.filePath).toBe("app/api/loom/codex/route.ts")
  })

  it("refuses continuation when the completed receipt does not match current Space authority", async () => {
    const world = {
      ...createWorkingWorld({ intent: "Finish Experience V2" }),
      space: createDefaultSpace(null),
    }
    await expect(prepareCodexContinuation({
      userId: "owner",
      worldId: "experience-v2",
      outcomeKey: "OUTCOME-OLD",
      workOrderId: 41,
      grantId: 16,
      completedPath: "a.ts",
    }, {
      load: vi.fn().mockResolvedValue({
        snapshot: JSON.stringify(world),
        authorityVersion: "authority-current",
        world,
        outcomeKey: "OUTCOME-CURRENT",
        workOrderId: 42,
        grantId: 17,
        title: "Current",
        objective: "Current objective",
        acceptanceCriteria: ["Current acceptance"],
        validators: ["pnpm test"],
        allowedPaths: ["a.ts", "b.ts"],
        completedPaths: ["a.ts"],
        assignedPaths: [],
      }),
      inspectTarget: vi.fn().mockResolvedValue(true),
      persist: vi.fn(),
    })).rejects.toThrow("CODEX_CONTINUATION_AUTHORITY_CHANGED")
  })

  it("re-derives the same pending task after reload instead of accepting browser task text", async () => {
    const world = selectContinuationPath({
      ...createWorkingWorld({ intent: "Finish Experience V2" }),
      space: createDefaultSpace(null),
    }, "b.ts")
    const load = vi.fn().mockResolvedValue({
      snapshot: JSON.stringify(world),
      authorityVersion: "authority-v1",
      world,
      outcomeKey: "OUTCOME-EXPERIENCE-V2",
      workOrderId: 42,
      grantId: 17,
      title: "Continue",
      objective: "Keep building.",
      acceptanceCriteria: ["Start the next slice."],
      validators: ["pnpm test"],
      allowedPaths: ["a.ts", "b.ts"],
      completedPaths: ["a.ts"],
      assignedPaths: [],
    })

    const inspectTarget = vi.fn().mockResolvedValue(true)
    const first = await readCodexContinuation("owner", "experience-v2", { load, inspectTarget, persist: vi.fn() })
    const restored = await readCodexContinuation("owner", "experience-v2", { load, inspectTarget, persist: vi.fn() })

    expect(restored).toEqual(first)
    expect(first).toMatchObject({ status: "NEXT_ASSIGNMENT", selectedPath: "b.ts" })
  })

  it("does not persist or restore a syntactically exact reservation unless it is a tracked regular file", async () => {
    const world = {
      ...createWorkingWorld({ intent: "Finish Experience V2" }),
      space: createDefaultSpace(null),
    }
    const load = vi.fn().mockResolvedValue({
      snapshot: JSON.stringify(world),
      authorityVersion: "authority-v1",
      world,
      outcomeKey: "OUTCOME-EXPERIENCE-V2",
      workOrderId: 42,
      grantId: 17,
      title: "Continue",
      objective: "Keep building.",
      acceptanceCriteria: ["Start only a real file."],
      validators: ["pnpm test"],
      allowedPaths: ["a.ts", "missing-file.ts"],
      completedPaths: ["a.ts"],
      assignedPaths: [],
    })
    const inspectTarget = vi.fn().mockResolvedValue(false)
    const persist = vi.fn()

    await expect(prepareCodexContinuation({
      userId: "owner",
      worldId: "experience-v2",
      outcomeKey: "OUTCOME-EXPERIENCE-V2",
      workOrderId: 42,
      grantId: 17,
      completedPath: "a.ts",
    }, { load, inspectTarget, persist })).resolves.toEqual({
      status: "PATH_RESERVATION_UNAVAILABLE",
      selectedPath: "missing-file.ts",
    })
    await expect(readCodexContinuation("owner", "experience-v2", {
      load, inspectTarget, persist,
    })).resolves.toEqual({
      status: "PATH_RESERVATION_UNAVAILABLE",
      selectedPath: "missing-file.ts",
    })
    expect(persist).not.toHaveBeenCalled()
  })
})
