import { describe, expect, it } from "vitest"

import {
  deriveSpaceMutationAuthority,
  SpaceMutationAuthorityError,
  type SpaceMutationAuthorityRecord,
} from "@/lib/governance/space-mutation-authority"

const binding = {
  projectId: 7,
  projectKey: "terrafusion",
  repositoryIdentity: "bsvalues/terrafusion_os_1.0",
  spaceIdentity: "c:/terrafusion",
}

function record(overrides: Partial<SpaceMutationAuthorityRecord> = {}): SpaceMutationAuthorityRecord {
  return {
    world: {
      revision: 12,
      projectId: 7,
      outcomeKey: "OUTCOME-1",
      workOrderId: 41,
      resources: ["williamos-workspace-root:v1:c:/terrafusion"],
      selectedPath: "src/app.ts",
    },
    project: { id: 7, key: "terrafusion", repositoryIdentity: "bsvalues/terrafusion_os_1.0" },
    outcome: { outcomeKey: "OUTCOME-1", lifecycleState: "active", activeWorkOrderId: 41 },
    workOrder: {
      id: 41, status: "active", authorityLevel: "A2_WRITE_OWN", authorityGrantId: 51,
      agent: "claude", allowed: ["src/app.ts"], forbidden: ["secrets/**"],
    },
    grant: {
      id: 51, userId: "owner-1", workOrderId: 41, grantedTo: "claude", status: "active",
      authorityLevel: "A2_WRITE_OWN", allowed: ["src/app.ts"], blocked: ["secrets/**"],
      expiresAt: new Date("2099-01-01T00:00:00.000Z"), revokedAt: null,
    },
    ...overrides,
  }
}

const dependencies = (value: SpaceMutationAuthorityRecord | null) => ({
  loadRecord: async () => value,
  now: () => new Date("2030-01-01T00:00:00.000Z"),
})

describe("server-derived Space mutation authority", () => {
  it("authorizes the exact persisted selected file without trusting a browser authority claim", async () => {
    await expect(deriveSpaceMutationAuthority({
      userId: "owner-1", worldId: "space-1", binding,
      target: { kind: "selected-file", requestedPath: "src/app.ts" },
    }, dependencies(record()))).resolves.toMatchObject({
      worldId: "space-1", selectedPath: "src/app.ts", workOrderId: 41, grantId: 51,
    })
  })

  it.each([
    ["another Space selection", { world: { ...record().world, selectedPath: "src/other.ts" } }],
    ["foreign Project", { project: { ...record().project, repositoryIdentity: "owner/other" } }],
    ["inactive outcome", { outcome: { ...record().outcome, lifecycleState: "complete" } }],
    ["expired grant", { grant: { ...record().grant, expiresAt: new Date("2029-01-01T00:00:00.000Z") } }],
    ["mismatched reservation", { grant: { ...record().grant, allowed: ["src/other.ts"] } }],
    ["forbidden selection", {
      world: { ...record().world, selectedPath: "secrets/key.ts" },
      workOrder: { ...record().workOrder, allowed: ["secrets/key.ts"], forbidden: ["secrets/**"] },
      grant: { ...record().grant, allowed: ["secrets/key.ts"], blocked: ["secrets/**"] },
    }],
  ])("fails closed for %s", async (_label, overrides) => {
    await expect(deriveSpaceMutationAuthority({
      userId: "owner-1", worldId: "space-1", binding,
      target: { kind: "selected-file", requestedPath: "src/app.ts" },
    }, dependencies(record(overrides as Partial<SpaceMutationAuthorityRecord>))))
      .rejects.toBeInstanceOf(SpaceMutationAuthorityError)
  })

  it("requires a runtime mutation to be reserved as the exact operation in both Work Order and grant", async () => {
    const runtime = record({
      workOrder: { ...record().workOrder, allowed: ["operation:service.restart"], forbidden: [] },
      grant: { ...record().grant, allowed: ["operation:service.restart"], blocked: [] },
    })
    await expect(deriveSpaceMutationAuthority({
      userId: "owner-1", worldId: "space-1", binding,
      target: { kind: "operation", operation: "service.restart" },
    }, dependencies(runtime))).resolves.toMatchObject({ operation: "service.restart" })
  })

  it.each([
    [["service.restart"], ["service.restart"]],
    [["operation:service.*"], ["operation:service.*"]],
    [["operation:service.restart"], ["operation:service.status"]],
  ])("does not widen operation authority from non-exact or mismatched reservations", async (workAllowed, grantAllowed) => {
    const runtime = record({
      workOrder: { ...record().workOrder, allowed: workAllowed, forbidden: [] },
      grant: { ...record().grant, allowed: grantAllowed, blocked: [] },
    })
    await expect(deriveSpaceMutationAuthority({
      userId: "owner-1", worldId: "space-1", binding,
      target: { kind: "operation", operation: "service.restart" },
    }, dependencies(runtime))).rejects.toBeInstanceOf(SpaceMutationAuthorityError)
  })
})
