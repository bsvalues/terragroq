import { describe, expect, it, vi } from "vitest"

import { createWorkingWorld } from "@/lib/environment/working-world"
import { createDefaultSpace } from "@/lib/environment/space-persistence"
import {
  deriveCodexPathEvidence,
  planCodexContinuation,
  prepareCodexContinuation,
  readCodexContinuation,
  selectContinuationPath,
} from "@/lib/loom/codex-continuation"

describe("Experience V2 Codex continuation", () => {
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

    const first = await readCodexContinuation("owner", "experience-v2", { load, persist: vi.fn() })
    const restored = await readCodexContinuation("owner", "experience-v2", { load, persist: vi.fn() })

    expect(restored).toEqual(first)
    expect(first).toMatchObject({ status: "NEXT_ASSIGNMENT", selectedPath: "b.ts" })
  })
})
