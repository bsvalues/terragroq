import { describe, expect, it, vi } from "vitest"

import { recordDeliverySealWithAuthorityFence } from "@/lib/governance/delivery-seal-runtime"
import type { WilliamOSDeliverySeal } from "@/lib/governance/delivery-seal"

const digest = (value: string) => value.repeat(64).slice(0, 64)
const baseSha = "1".repeat(40)
const commitSha = "2".repeat(40)

const assignmentMetadata = {
  assignmentVersion: "loom-codex-assignment.v1",
  owner: "owner-1",
  provider: "Codex",
  mode: "delegate",
  workspace: "C:/repo",
  threadId: "thread-1",
  worldId: "space-1",
  spaceRevision: 7,
  outcome: { id: 11, key: "EXPERIENCE_V2", version: 3 },
  workOrder: { id: 22, ref: "WO-22", version: "2026-08-29T00:00:00.000Z" },
  grant: { id: 33, ref: "GRANT-33", version: digest("a") },
  reservation: { allowed: ["src/selected.ts"], forbidden: ["infra/**"], version: digest("b") },
  promotionPath: "src/selected.ts",
  assignmentHash: digest("c"),
  task: { digest: digest("d"), text: "Implement the selected capability" },
  executionBindingHash: digest("e"),
  isolatedBaseSha: baseSha,
}

const readyMetadata = {
  committed: true,
  assignmentHash: assignmentMetadata.assignmentHash,
  selectedPath: assignmentMetadata.promotionPath,
  taskDigest: assignmentMetadata.task.digest,
  executionBindingHash: assignmentMetadata.executionBindingHash,
  promotionDigest: digest("f"),
  baseSha,
}

const seal: WilliamOSDeliverySeal = {
  payload: {
    version: "williamos-delivery-seal.v1",
    issuer: "WilliamOS",
    keyId: "key-1",
    issuedAt: "2026-08-29T00:00:00.000Z",
    assignment: {
      assignmentHash: assignmentMetadata.assignmentHash,
      owner: assignmentMetadata.owner,
      worldId: assignmentMetadata.worldId,
      spaceRevision: assignmentMetadata.spaceRevision,
      outcome: assignmentMetadata.outcome,
      workOrder: assignmentMetadata.workOrder,
      grant: assignmentMetadata.grant,
      reservation: assignmentMetadata.reservation,
      task: assignmentMetadata.task,
      session: { threadId: assignmentMetadata.threadId, executionBindingHash: assignmentMetadata.executionBindingHash },
    },
    delivery: {
      repository: "https://github.com/example/repo",
      baseSha,
      commitSha,
      paths: [assignmentMetadata.promotionPath],
      patchDigest: digest("9"),
      contentDigest: readyMetadata.promotionDigest,
    },
  },
  signature: "signed",
}

function lockedAuthority(currentAllowed = assignmentMetadata.reservation.allowed) {
  return {
    assignmentMetadata,
    readyMetadata,
    currentWorldSnapshot: {
      spine: { outcomeKey: assignmentMetadata.outcome.key, workOrderId: assignmentMetadata.workOrder.id },
      space: {
        revision: assignmentMetadata.spaceRevision,
        activePaneId: "pane-1",
        panes: [{ id: "pane-1", filePath: assignmentMetadata.promotionPath }],
      },
    },
    currentOutcomeId: assignmentMetadata.outcome.id,
    currentOutcomeKey: assignmentMetadata.outcome.key,
    currentOutcomeVersion: assignmentMetadata.outcome.version,
    currentOutcomeState: "active",
    currentActiveWorkOrderId: assignmentMetadata.workOrder.id,
    currentWorkOrderId: assignmentMetadata.workOrder.id,
    currentWorkOrderRef: assignmentMetadata.workOrder.ref,
    currentWorkOrderStatus: "active",
    currentWorkOrderUpdatedAt: assignmentMetadata.workOrder.version,
    currentWorkOrderGrantId: assignmentMetadata.grant.id,
    currentWorkOrderAgent: "Codex",
    currentAllowed,
    currentForbidden: assignmentMetadata.reservation.forbidden,
    currentGrantId: assignmentMetadata.grant.id,
    currentGrantRef: assignmentMetadata.grant.ref,
    currentGrantWorkOrderId: assignmentMetadata.workOrder.id,
    currentGrantTo: "Codex",
    currentGrantStatus: "active",
    currentGrantRevokedAt: null,
    currentGrantContentHash: assignmentMetadata.grant.version,
    currentGrantCreatedAt: "2026-08-29T00:00:00.000Z",
    currentGrantAllowed: currentAllowed,
    currentGrantBlocked: assignmentMetadata.reservation.forbidden,
  }
}

describe("delivery seal final authority fence", () => {
  it("rolls back without inserting when authority drifts after Git inspection", async () => {
    const statements: string[] = []
    const query = vi.fn(async (sql: string) => {
      statements.push(sql)
      if (sql.includes("SELECT assignment_event")) {
        return { rows: [lockedAuthority(["src/other.ts"])] }
      }
      return { rows: [] }
    })
    const release = vi.fn()

    await expect(recordDeliverySealWithAuthorityFence({
      userId: assignmentMetadata.owner,
      threadId: assignmentMetadata.threadId,
      assignmentEventId: 101,
      readyEventId: 102,
      seal,
    }, {
      connect: async () => ({ query, release }),
    })).rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_STALE" })

    expect(statements.some((sql) => sql.includes("BEGIN ISOLATION LEVEL SERIALIZABLE"))).toBe(true)
    expect(statements.some((sql) => sql.includes("FOR UPDATE OF"))).toBe(true)
    expect(statements.some((sql) => sql.includes("INSERT INTO \"governance_event\""))).toBe(false)
    expect(statements.some((sql) => sql === "COMMIT")).toBe(false)
    expect(statements.some((sql) => sql === "ROLLBACK")).toBe(true)
    expect(release).toHaveBeenCalledOnce()
  })
})
