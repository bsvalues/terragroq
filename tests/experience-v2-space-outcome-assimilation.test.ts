import { describe, expect, it } from "vitest"

import {
  assimilateOwnedSpaceOutcome,
  authoritySnapshotRemainsCurrent,
  authorityGrantFactsFromNormalizedRow,
  classifyAuthorityAttachmentFailure,
  resolveSpaceRepositoryIdentities,
  type SpaceOutcomeAuthority,
  type SpaceOutcomeAssimilationDependencies,
} from "@/lib/environment/space-outcome-assimilation"
import {
  createWorkingWorld,
  type WorkingWorldSnapshot,
} from "@/lib/environment/working-world"
import type {
  OwnedWorkingWorldRecord,
  SpaceWorkingWorldStore,
} from "@/lib/environment/space-persistence"

function authority(overrides: Partial<SpaceOutcomeAuthority> = {}): SpaceOutcomeAuthority {
  return {
    selection: {
      projectId: 4,
      projectName: "WilliamOS",
      threadId: "thread-experience-v2",
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
      outcomeTitle: "Finish Experience V2",
      activeWorkOrderId: 41,
    },
    outcome: {
      id: 8,
      userId: "owner-1",
      lifecycleState: "active",
      approvalState: "approved",
      authorityState: "matched",
      authorityLevel: "A2_WRITE_OWN",
      activeWorkOrderId: 41,
      version: 6,
    },
    workOrder: {
      id: 41,
      userId: "owner-1",
      ref: "WO-0041",
      status: "active",
      authorityLevel: "A2_WRITE_OWN",
      authorityGranted: "A2_WRITE_OWN",
      authorityGrantId: 9,
      agent: "local",
      allowedFiles: ["app/api/environment/space/outcome/route.ts", "lib/environment/space-outcome-assimilation.ts"],
      forbiddenFiles: ["scripts/hermes-bridge/**"],
    },
    grant: {
      id: 9,
      userId: "owner-1",
      ref: "GRANT-0009",
      workOrderId: 41,
      grantedBy: "owner-1",
      grantedTo: "local",
      status: "active",
      authorityLevel: "A2_WRITE_OWN",
      allowedActions: ["lib/environment/space-outcome-assimilation.ts", "app/api/environment/space/outcome/route.ts"],
      blockedActions: ["scripts/hermes-bridge/**"],
      expiresAt: null,
      revokedAt: null,
      revokeReason: null,
      contentHash: "grant-content-hash",
    },
    ...overrides,
  }
}

class MemoryWorldStore implements SpaceWorkingWorldStore {
  readonly rows = new Map<string, OwnedWorkingWorldRecord>()
  updates = 0

  constructor(world: WorkingWorldSnapshot = createWorkingWorld({ intent: "Experience V2" })) {
    this.rows.set("space-1", {
      id: "space-1",
      userId: "owner-1",
      intent: world.intent,
      snapshot: JSON.stringify(world),
      updatedAt: new Date("2026-08-29T18:00:00Z"),
    })
  }

  async findOwned(userId: string, worldId: string) {
    const row = this.rows.get(worldId)
    return row?.userId === userId ? row : null
  }

  async findLatestOwned() { return null }
  async findLatestOwnedForProject() { return null }
  async insertOwned() { throw new Error("not used") }

  async updateOwned(userId: string, worldId: string, snapshot: string, intent: string, expectedSnapshot: string) {
    // Mirror the production store's single conditional UPDATE. Yielding between this read and the
    // compare would turn the test double into a non-atomic store and permit two fake CAS winners.
    const row = this.rows.get(worldId)
    if (!row || row.userId !== userId || row.snapshot !== expectedSnapshot) return false
    this.rows.set(worldId, { ...row, snapshot, intent, updatedAt: new Date(row.updatedAt.getTime() + 1) })
    this.updates += 1
    return true
  }
}

function assimilationDependencies(store: MemoryWorldStore, candidate: SpaceOutcomeAuthority | null) {
  return {
    store,
    findActiveAuthorities: async () => candidate ? [{
      ...candidate,
      projectResources: [{ type: "repo", canonicalIdentity: "bsvalues/terragroq", relationship: "primary-repo" }],
    }] : [],
    resolveSpaceRepositoryIdentities: async () => ["bsvalues/terragroq"],
    attachIfAuthorityCurrent: async (input: {
      userId: string
      worldId: string
      expectedSnapshot: string
      nextSnapshot: string
      nextIntent: string
    }) => await store.updateOwned(
      input.userId,
      input.worldId,
      input.nextSnapshot,
      input.nextIntent,
      input.expectedSnapshot,
    ) ? "ATTACHED" as const : "WORLD_CHANGED" as const,
  }
}

describe("durable Space parent-outcome assimilation", () => {
  it("keeps an already-normalized Drizzle grant timestamp at its exact instant", () => {
    const originalTz = process.env.TZ
    process.env.TZ = "America/Los_Angeles"
    try {
      const expiresAt = new Date("2026-08-25T14:05:06.566Z")
      expect(expiresAt.getTimezoneOffset()).toBe(420)
      const facts = authorityGrantFactsFromNormalizedRow({ ...authority().grant, expiresAt })

      expect(facts.expiresAt?.toISOString()).toBe("2026-08-25T14:05:06.566Z")
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    }
  })

  it("does not treat an untyped bare segment pair as a repository identity", async () => {
    await expect(resolveSpaceRepositoryIdentities(["bsvalues/terragroq"]))
      .resolves.toEqual([])
  })

  it("attaches the one active owner outcome and its existing exact reservation without creating authority", async () => {
    const store = new MemoryWorldStore(createWorkingWorld({
      intent: "Experience V2",
      resources: ["repo:terragroq"],
    }))

    const result = await assimilateOwnedSpaceOutcome({ userId: "owner-1", worldId: "space-1" }, {
      ...assimilationDependencies(store, authority()),
    })

    expect(result).toEqual({
      status: "ATTACHED",
      worldId: "space-1",
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
      workOrderId: 41,
      authorityLevel: "A2_WRITE_OWN",
      reservedPaths: [
        "app/api/environment/space/outcome/route.ts",
        "lib/environment/space-outcome-assimilation.ts",
      ],
    })
    const persisted = JSON.parse(store.rows.get("space-1")!.snapshot) as WorkingWorldSnapshot
    expect(persisted.resources).toEqual(["repo:terragroq"])
    expect(persisted.spine).toMatchObject({
      projectId: 4,
      projectName: "WilliamOS",
      threadId: "thread-experience-v2",
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
      workOrderId: 41,
    })
    expect(store.updates).toBe(1)
  })

  it("binds only the active outcome whose project primary repo matches the Space", async () => {
    const store = new MemoryWorldStore(createWorkingWorld({
      intent: "Experience V2",
      resources: ["repo:bsvalues/terragroq"],
    }))
    const terraFusion = authority({
      selection: {
        ...authority().selection,
        projectId: 8,
        projectName: "TerraFusion OS",
        threadId: "thread-terrafusion",
        outcomeKey: "TERRAFUSION_DELIVERY",
        outcomeTitle: "Deliver TerraFusion",
        activeWorkOrderId: 42,
      },
      outcome: { ...authority().outcome, id: 9, activeWorkOrderId: 42 },
      workOrder: { ...authority().workOrder, id: 42, authorityGrantId: 10 },
      grant: { ...authority().grant, id: 10, workOrderId: 42 },
    })

    const dependencies = {
      ...assimilationDependencies(store, null),
      findActiveAuthorities: async () => [
        {
          ...terraFusion,
          projectResources: [{ type: "repo", canonicalIdentity: "bsvalues/terrafusion_os_1.0", relationship: "primary-repo" }],
        },
        {
          ...authority(),
          projectResources: [{ type: "repo", canonicalIdentity: "bsvalues/terragroq", relationship: "primary-repo" }],
        },
      ],
      resolveSpaceRepositoryIdentities: async () => ["bsvalues/terragroq"],
    } satisfies SpaceOutcomeAssimilationDependencies
    const result = await assimilateOwnedSpaceOutcome(
      { userId: "owner-1", worldId: "space-1" },
      dependencies,
    )

    expect(result).toMatchObject({
      status: "ATTACHED",
      outcomeKey: "WILLIAMOS_EXPERIENCE_V2",
      workOrderId: 41,
    })
    const persisted = JSON.parse(store.rows.get("space-1")!.snapshot) as WorkingWorldSnapshot
    expect(persisted.spine).toMatchObject({ projectId: 4, threadId: "thread-experience-v2" })
  })

  it("fails closed when the Space cannot be matched to exactly one project", async () => {
    const store = new MemoryWorldStore(createWorkingWorld({
      intent: "Experience V2",
      resources: ["repo:bsvalues/shared"],
    }))
    const candidates = [4, 8].map((projectId) => ({
      ...authority({ selection: { ...authority().selection, projectId } }),
      projectResources: [{ type: "repo", canonicalIdentity: "bsvalues/shared", relationship: "primary-repo" }],
    }))

    const dependencies = {
      ...assimilationDependencies(store, null),
      findActiveAuthorities: async () => candidates,
      resolveSpaceRepositoryIdentities: async () => ["bsvalues/shared"],
    } satisfies SpaceOutcomeAssimilationDependencies
    const result = await assimilateOwnedSpaceOutcome(
      { userId: "owner-1", worldId: "space-1" },
      dependencies,
    )

    expect(result).toEqual({ status: "MISSING_AUTHORITY", reason: "AUTHORITY_BINDING_INVALID" })
    expect(store.updates).toBe(0)
  })

  it("fails closed when the matched project declares more than one primary repository", async () => {
    const store = new MemoryWorldStore(createWorkingWorld({
      intent: "Experience V2",
      resources: ["repo:bsvalues/terragroq"],
    }))
    const candidate = {
      ...authority(),
      projectResources: [
        { type: "repo", canonicalIdentity: "bsvalues/terragroq", relationship: "primary-repo" },
        { type: "repo", canonicalIdentity: "bsvalues/other", relationship: "primary-repo" },
      ],
    }
    const dependencies = {
      ...assimilationDependencies(store, null),
      findActiveAuthorities: async () => [candidate],
      resolveSpaceRepositoryIdentities: async () => ["bsvalues/terragroq"],
    } satisfies SpaceOutcomeAssimilationDependencies

    const result = await assimilateOwnedSpaceOutcome(
      { userId: "owner-1", worldId: "space-1" },
      dependencies,
    )

    expect(result).toEqual({ status: "MISSING_AUTHORITY", reason: "AUTHORITY_BINDING_INVALID" })
    expect(store.updates).toBe(0)
  })

  it("refuses a Space whose workspace-root origin and explicit repo declaration disagree", async () => {
    const root = process.cwd().replace(/\\/g, "/")
    const store = new MemoryWorldStore(createWorkingWorld({
      intent: "Foreign project",
      resources: [
        `williamos-workspace-root:v1:${root}`,
        "repo:bsvalues/other",
      ],
    }))
    const candidate = {
      ...authority(),
      projectResources: [{ type: "repo", canonicalIdentity: "bsvalues/other", relationship: "primary-repo" }],
    }
    const dependencies = {
      ...assimilationDependencies(store, null),
      findActiveAuthorities: async () => [candidate],
      resolveSpaceRepositoryIdentities,
    } satisfies SpaceOutcomeAssimilationDependencies

    const result = await assimilateOwnedSpaceOutcome(
      { userId: "owner-1", worldId: "space-1" },
      dependencies,
    )

    expect(result).toEqual({ status: "MISSING_AUTHORITY", reason: "AUTHORITY_BINDING_INVALID" })
    expect(store.updates).toBe(0)
  })

  it("reselects after a lost Space CAS and refuses when the durable project identity changed", async () => {
    const store = new MemoryWorldStore(createWorkingWorld({
      intent: "Experience V2",
      resources: ["repo:bsvalues/terragroq"],
    }))
    const other = {
      ...authority({
        selection: {
          ...authority().selection,
          projectId: 8,
          projectName: "TerraFusion OS",
          threadId: "thread-terrafusion",
          outcomeKey: "TERRAFUSION_DELIVERY",
          outcomeTitle: "Deliver TerraFusion",
          activeWorkOrderId: 42,
        },
        outcome: { ...authority().outcome, id: 9, activeWorkOrderId: 42 },
        workOrder: { ...authority().workOrder, id: 42, authorityGrantId: 10 },
        grant: { ...authority().grant, id: 10, workOrderId: 42 },
      }),
      projectResources: [{ type: "repo", canonicalIdentity: "bsvalues/terrafusion_os_1.0", relationship: "primary-repo" }],
    }
    const william = {
      ...authority(),
      projectResources: [{ type: "repo", canonicalIdentity: "bsvalues/terragroq", relationship: "primary-repo" }],
    }
    let attachmentAttempts = 0
    const dependencies = {
      store,
      findActiveAuthorities: async () => [william, other],
      resolveSpaceRepositoryIdentities: async (resources: readonly string[]) =>
        resources.includes("repo:bsvalues/terragroq") ? ["bsvalues/terragroq"] : ["bsvalues/terrafusion_os_1.0"],
      attachIfAuthorityCurrent: async () => {
        attachmentAttempts += 1
        const row = store.rows.get("space-1")!
        const moved = createWorkingWorld({ intent: "TerraFusion", resources: ["repo:bsvalues/terrafusion_os_1.0"] })
        store.rows.set("space-1", { ...row, intent: moved.intent, snapshot: JSON.stringify(moved) })
        return "WORLD_CHANGED"
      },
    }

    const result = await assimilateOwnedSpaceOutcome(
      { userId: "owner-1", worldId: "space-1" },
      dependencies as never,
    )

    expect(result).toEqual({ status: "MISSING_AUTHORITY", reason: "AUTHORITY_BINDING_INVALID" })
    expect(attachmentAttempts).toBe(1)
    expect(store.updates).toBe(0)
  })

  it.each([
    ["grant revoked", (current: SpaceOutcomeAuthority) => ({
      ...current,
      grant: { ...current.grant, status: "revoked", revokedAt: new Date("2026-08-29T18:00:00Z") },
    })],
    ["active Work Order switched", (current: SpaceOutcomeAuthority) => ({
      ...current,
      outcome: { ...current.outcome, activeWorkOrderId: 42, version: current.outcome.version + 1 },
    })],
    ["reservation changed", (current: SpaceOutcomeAuthority) => ({
      ...current,
      workOrder: { ...current.workOrder, allowedFiles: ["app/**"] },
      grant: { ...current.grant, allowedActions: ["app/**"] },
    })],
  ] as const)(
    "refuses attachment when %s at the atomic authority boundary",
    async (_label, mutate) => {
      const store = new MemoryWorldStore(createWorkingWorld({
        intent: "Experience V2",
        resources: ["repo:bsvalues/terragroq"],
      }))
      const dependencies = {
        ...assimilationDependencies(store, authority()),
        attachIfAuthorityCurrent: async (input: { authority: SpaceOutcomeAuthority }) =>
          authoritySnapshotRemainsCurrent("owner-1", input.authority, mutate(input.authority))
            ? "ATTACHED"
            : "AUTHORITY_CHANGED",
      }

      const result = await assimilateOwnedSpaceOutcome(
        { userId: "owner-1", worldId: "space-1" },
        dependencies as never,
      )

      expect(result).toEqual({ status: "MISSING_AUTHORITY", reason: "AUTHORITY_BINDING_INVALID" })
      expect(store.updates).toBe(0)
    },
  )

  it("retries one serialization failure and then attaches", async () => {
    const store = new MemoryWorldStore(createWorkingWorld({
      intent: "Experience V2",
      resources: ["repo:bsvalues/terragroq"],
    }))
    let attempts = 0
    const dependencies = {
      ...assimilationDependencies(store, authority()),
      attachIfAuthorityCurrent: async (input: {
        userId: string
        worldId: string
        expectedSnapshot: string
        nextSnapshot: string
        nextIntent: string
      }) => {
        attempts += 1
        if (attempts === 1) return classifyAuthorityAttachmentFailure({ code: "40001" })
        const attached = await store.updateOwned(
          input.userId,
          input.worldId,
          input.nextSnapshot,
          input.nextIntent,
          input.expectedSnapshot,
        )
        return attached ? "ATTACHED" : "WORLD_CHANGED"
      },
    }

    const result = await assimilateOwnedSpaceOutcome(
      { userId: "owner-1", worldId: "space-1" },
      dependencies as never,
    )

    expect(result.status).toBe("ATTACHED")
    expect(attempts).toBe(2)
    expect(store.updates).toBe(1)
  })

  it("recognizes retryable SQLSTATEs wrapped by the Drizzle adapter", () => {
    expect(classifyAuthorityAttachmentFailure({
      name: "DrizzleQueryError",
      cause: { code: "40001" },
    })).toBe("RETRYABLE")
    expect(classifyAuthorityAttachmentFailure({
      name: "DrizzleQueryError",
      cause: { cause: { code: "40P01" } },
    })).toBe("RETRYABLE")
    expect(classifyAuthorityAttachmentFailure({
      name: "DrizzleQueryError",
      cause: { code: "42P01" },
    })).toBe("UNAVAILABLE")
  })

  it("returns typed unavailable after one permanent attachment failure", async () => {
    const store = new MemoryWorldStore(createWorkingWorld({
      intent: "Experience V2",
      resources: ["repo:bsvalues/terragroq"],
    }))
    let attempts = 0
    const dependencies = {
      ...assimilationDependencies(store, authority()),
      attachIfAuthorityCurrent: async () => {
        attempts += 1
        return classifyAuthorityAttachmentFailure({ code: "42P01" })
      },
    }

    const result = await assimilateOwnedSpaceOutcome(
      { userId: "owner-1", worldId: "space-1" },
      dependencies as never,
    )

    expect(result).toEqual({ status: "SPACE_AUTHORITY_UNAVAILABLE" })
    expect(attempts).toBe(1)
    expect(store.updates).toBe(0)
  })

  it("is exactly-once when two assimilation requests race", async () => {
    const store = new MemoryWorldStore()
    const run = () => assimilateOwnedSpaceOutcome({ userId: "owner-1", worldId: "space-1" }, {
      ...assimilationDependencies(store, authority()),
    })

    const results = await Promise.all([run(), run()])

    expect(results.map((result) => result.status).sort()).toEqual(["ALREADY_ATTACHED", "ATTACHED"])
    expect(store.updates).toBe(1)
  })

  it("returns typed missing authority and leaves the Space unchanged when no legitimate parent exists", async () => {
    const store = new MemoryWorldStore()
    const before = store.rows.get("space-1")!.snapshot

    const result = await assimilateOwnedSpaceOutcome({ userId: "owner-1", worldId: "space-1" }, {
      ...assimilationDependencies(store, null),
    })

    expect(result).toEqual({ status: "MISSING_AUTHORITY", reason: "NO_ACTIVE_OWNER_OUTCOME" })
    expect(store.rows.get("space-1")!.snapshot).toBe(before)
    expect(store.updates).toBe(0)
  })

  it.each([
    ["inactive work order", authority({ workOrder: { ...authority().workOrder, status: "review" } })],
    ["foreign grant", authority({ grant: { ...authority().grant, userId: "owner-2" } })],
    ["widened grant reservation", authority({ grant: { ...authority().grant, allowedActions: ["app/**"] } })],
    ["provider mismatch", authority({ grant: { ...authority().grant, grantedTo: "codex" } })],
  ])("fails mutation closed for %s", async (_label, candidate) => {
    const store = new MemoryWorldStore()

    const result = await assimilateOwnedSpaceOutcome({ userId: "owner-1", worldId: "space-1" }, {
      ...assimilationDependencies(store, candidate),
    })

    expect(result).toEqual({ status: "MISSING_AUTHORITY", reason: "AUTHORITY_BINDING_INVALID" })
    expect(store.updates).toBe(0)
  })

  it("does not overwrite a Space already bound to different work", async () => {
    const occupied = createWorkingWorld({ intent: "Other work" })
    const store = new MemoryWorldStore({
      ...occupied,
      spine: {
        ...occupied.spine,
        projectId: 2,
        projectName: "Other",
        threadId: "thread-other",
        outcomeKey: "OTHER_OUTCOME",
        outcomeTitle: "Other outcome",
        workOrderId: 12,
      },
    })

    const result = await assimilateOwnedSpaceOutcome({ userId: "owner-1", worldId: "space-1" }, {
      ...assimilationDependencies(store, authority()),
    })

    expect(result).toEqual({ status: "SPACE_ALREADY_BOUND", outcomeKey: "OTHER_OUTCOME", workOrderId: 12 })
    expect(store.updates).toBe(0)
  })
})
