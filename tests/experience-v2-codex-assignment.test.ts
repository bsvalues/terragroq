import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it } from "vitest"

import {
  deriveCodexAssignment,
  inspectCodexAssignmentTarget,
  revalidateCodexAssignment,
  type CodexAssignmentRecord,
} from "@/lib/loom/codex-assignment"
import { createWorkingWorld, type WorkingWorldSnapshot } from "@/lib/environment/working-world"

const run = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function repositoryFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-assignment-"))
  roots.push(root)
  await run("git", ["init", "--quiet", root])
  await run("git", ["-C", root, "config", "user.email", "test@example.test"])
  await run("git", ["-C", root, "config", "user.name", "Test"])
  await fs.mkdir(path.join(root, "src"), { recursive: true })
  await fs.writeFile(path.join(root, "src", "selected.ts"), "export const selected = true\n", "utf8")
  await run("git", ["-C", root, "add", "--", "src/selected.ts"])
  await run("git", ["-C", root, "commit", "--quiet", "-m", "fixture"])
  return root
}

function world(selectedPath = "src/selected.ts", revision = 7): WorkingWorldSnapshot {
  return {
    ...createWorkingWorld({ intent: "Implement the active outcome" }),
    spine: {
      projectId: 1,
      projectName: "WilliamOS",
      threadId: "thread-1",
      outcomeKey: "OUTCOME-1",
      outcomeTitle: "Selected-file change",
      workOrderId: 41,
      execution: "implementing",
      worker: null,
      evidence: [],
    },
    space: {
      schemaVersion: 1,
      revision,
      windows: [{
        id: "workspace-editor", kind: "editor", title: "Source",
        frame: { x: 0, y: 0, width: 800, height: 600 }, z: 1, minimized: false,
      }],
      openFiles: [selectedPath],
      panes: [{ id: "workspace-pane", filePath: selectedPath, selection: null }],
      selection: null,
      activeWindowId: "workspace-editor",
      activePaneId: "workspace-pane",
      runningAppUrl: null,
    },
  }
}

function record(overrides: Partial<CodexAssignmentRecord> = {}): CodexAssignmentRecord {
  return {
    world: world(),
    outcome: {
      id: 5, outcomeKey: "OUTCOME-1", lifecycleState: "active", activeWorkOrderId: 41, version: 3,
    },
    workOrder: {
      id: 41,
      ref: "WO-0041",
      status: "active",
      authorityLevel: "A2_WRITE_OWN",
      authorityGrantId: 9,
      agent: "codex",
      allowedFiles: ["src/selected.ts"],
      forbiddenFiles: ["src/forbidden.ts"],
      updatedAt: "2026-08-28T12:00:00.000Z",
    },
    grant: {
      id: 9,
      ref: "GRANT-0009",
      userId: "owner-1",
      workOrderId: 41,
      grantedTo: "codex",
      status: "active",
      authorityLevel: "A2_WRITE_OWN",
      scope: "Implement the selected source change",
      allowedActions: ["src/selected.ts"],
      blockedActions: ["src/forbidden.ts"],
      expiresAt: null,
      revokedAt: null,
      contentHash: "grant-hash",
      createdAt: "2026-08-28T11:00:00.000Z",
    },
    ...overrides,
  }
}

const target = {
  content: "export const selected = true\n",
  modifiedAt: "2026-08-28T12:30:00.000Z",
  digest: "a".repeat(64),
}

describe("server-derived Codex assignment", () => {
  it("binds the persisted active Space file to its outcome, work order, grant, and reservation", async () => {
    const assignment = await deriveCodexAssignment({
      userId: "owner-1",
      worldId: "world-1",
      projectRoot: "C:/workspace",
    }, {
      loadRecord: async () => record(),
      inspectTarget: async () => target,
    })

    expect(assignment).toMatchObject({
      owner: "owner-1",
      worldId: "world-1",
      outcomeKey: "OUTCOME-1",
      workOrderId: 41,
      grantId: 9,
      selectedPath: "src/selected.ts",
      allowed: ["src/selected.ts"],
      forbidden: ["src/forbidden.ts"],
      binding: {
        spaceRevision: 7,
        outcomeId: 5,
        outcomeVersion: 3,
        workOrderRef: "WO-0041",
        workOrderVersion: "2026-08-28T12:00:00.000Z",
        grantRef: "GRANT-0009",
      },
      target,
    })
    expect(assignment.assignmentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(assignment.binding.reservationVersion).toMatch(/^[0-9a-f]{64}$/)
    expect(assignment.binding.grantVersion).toBe("grant-hash")
  })

  it("accepts a normalized multi-path Work Order reservation while promoting only the selected file", async () => {
    const assignment = await deriveCodexAssignment({
      userId: "owner-1", worldId: "world-1", projectRoot: "C:/workspace",
    }, {
      loadRecord: async () => record({
        workOrder: {
          ...record().workOrder,
          allowedFiles: ["src/selected.ts", "src/other.ts"],
          forbiddenFiles: ["src/generated/**", "src/forbidden.ts"],
        },
        grant: {
          ...record().grant,
          allowedActions: ["src\\other.ts", "src/selected.ts"],
          blockedActions: ["src/forbidden.ts", "src\\generated/**"],
        },
      }),
      inspectTarget: async () => target,
    })

    expect(assignment.selectedPath).toBe("src/selected.ts")
    expect(assignment.allowed).toEqual(["src/other.ts", "src/selected.ts"])
    expect(assignment.forbidden).toEqual(["src/forbidden.ts", "src/generated/**"])
  })

  it.each([
    ["outcome is not active", { outcome: { ...record().outcome, lifecycleState: "approved" } }],
    ["world work order differs", { world: world(), outcome: { ...record().outcome, activeWorkOrderId: 42 } }],
    ["work order is not active", { workOrder: { ...record().workOrder, status: "review" } }],
    ["grant belongs to another owner", { grant: { ...record().grant, userId: "owner-2" } }],
    ["grant is not bound to the active work order", { grant: { ...record().grant, workOrderId: null } }],
    ["grant is not issued to an implementation-capable role", { grant: { ...record().grant, grantedTo: "reviewer" } }],
    ["grant is below A2 write authority", { grant: { ...record().grant, authorityLevel: "A1_PROPOSE" } }],
    ["grant is revoked", { grant: { ...record().grant, status: "revoked", revokedAt: "2026-08-28T12:10:00.000Z" } }],
    ["selected path is forbidden by the work order", {
      workOrder: { ...record().workOrder, forbiddenFiles: ["src/selected.ts"] },
      grant: { ...record().grant, blockedActions: ["src/selected.ts"] },
    }],
    ["grant subject is the operator instead of exact Codex", { grant: { ...record().grant, grantedTo: "operator" } }],
    ["grant allowed reservation differs from the active work order", {
      grant: { ...record().grant, allowedActions: ["src/other.ts"] },
    }],
    ["grant forbidden reservation differs from the active work order", {
      grant: { ...record().grant, blockedActions: ["src/other-forbidden.ts"] },
    }],
    ["work order has no writable reservation", {
      workOrder: { ...record().workOrder, allowedFiles: [] },
      grant: { ...record().grant, allowedActions: [] },
    }],
  ])("fails closed when %s", async (_label, overrides) => {
    await expect(deriveCodexAssignment({
      userId: "owner-1", worldId: "world-1", projectRoot: "C:/workspace",
    }, {
      loadRecord: async () => record(overrides as Partial<CodexAssignmentRecord>),
      inspectTarget: async () => target,
    })).rejects.toMatchObject({ code: "CODEX_ASSIGNMENT_REFUSED" })
  })

  it("rejects a stale authority snapshot or target before promotion", async () => {
    let revision = 7
    const dependencies = {
      loadRecord: async () => record({ world: world("src/selected.ts", revision) }),
      inspectTarget: async () => target,
    }
    const assignment = await deriveCodexAssignment({
      userId: "owner-1", worldId: "world-1", projectRoot: "C:/workspace",
    }, dependencies)
    revision = 8

    await expect(revalidateCodexAssignment(assignment, dependencies)).rejects.toMatchObject({
      code: "CODEX_ASSIGNMENT_STALE",
    })
  })

  it("inspects only a tracked regular UTF-8 file no larger than the V1 limit", async () => {
    const root = await repositoryFixture()

    const inspected = await inspectCodexAssignmentTarget(root, "src/selected.ts")

    expect(inspected.content).toBe("export const selected = true\n")
    expect(inspected.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(inspected.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each([
    ["untracked", async (root: string) => fs.writeFile(path.join(root, "src", "other.ts"), "text\n"), "src/other.ts"],
    ["binary", async (root: string) => {
      await fs.writeFile(path.join(root, "src", "selected.ts"), Buffer.from([0x41, 0, 0x42]))
    }, "src/selected.ts"],
    ["hard-linked", async (root: string) => {
      const selected = path.join(root, "src", "selected.ts")
      await fs.link(selected, path.join(root, "src", "alias.ts"))
    }, "src/selected.ts"],
  ] as const)("refuses a %s target", async (_label, arrange, selectedPath) => {
    const root = await repositoryFixture()
    await arrange(root)

    await expect(inspectCodexAssignmentTarget(root, selectedPath)).rejects.toMatchObject({
      code: "CODEX_ASSIGNMENT_REFUSED",
    })
  })
})
