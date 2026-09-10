import { describe, expect, it } from "vitest"

import {
  projectCrossRepositoryChangeSet,
  type CrossRepositoryChangeSetFacts,
} from "@/lib/environment/cross-repository-change-set"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const ADOPTION_HASH = "1".repeat(64)

function facts(overrides: Partial<CrossRepositoryChangeSetFacts> = {}): CrossRepositoryChangeSetFacts {
  return {
    worldId: "space-1",
    project: { id: 7, key: "terrafusion", name: "TerraFusion" },
    outcome: { key: "ATLAS_PROJECTION", title: "Atlas parcel projection" },
    workOrders: [],
    evidence: [],
    events: [],
    ...overrides,
  }
}

function correlatedDeliveryEvents(overrides: {
  authorizationRepository?: string
  authorizationArtifact?: Record<string, unknown>
  validation?: Record<string, unknown>
  review?: Record<string, unknown>
  delivery?: Record<string, unknown>
  sealedArtifact?: Record<string, unknown>
} = {}): CrossRepositoryChangeSetFacts["events"] {
  const artifact = { pullRequest: 1401, headSha: SHA_A, paths: ["src/projection.ts"] }
  return [
    {
      id: 501,
      eventType: "ARTIFACT_ADOPTION_AUTHORIZED",
      entityType: "williamos_artifact_adoption_authorization",
      metadata: {
        adoptionHash: ADOPTION_HASH,
        context: { worldId: "space-1", outcome: { key: "ATLAS_PROJECTION" }, workOrder: { id: 31 }, repository: overrides.authorizationRepository ?? "bsvalues/terrafusion-atlas" },
        artifact: { ...artifact, ...overrides.authorizationArtifact },
      },
      createdAt: "2026-09-01T10:10:00.000Z",
    },
    {
      id: 502,
      eventType: "ARTIFACT_ADOPTION_VALIDATED",
      entityType: "williamos_artifact_adoption_validation",
      metadata: {
        adoptionHash: ADOPTION_HASH,
        evidence: {
          ...artifact,
          checksComplete: true,
          checksGreen: true,
          ...overrides.validation,
        },
      },
      createdAt: "2026-09-01T10:11:00.000Z",
    },
    {
      id: 503,
      eventType: "ARTIFACT_ADOPTION_REVIEWED",
      entityType: "williamos_artifact_adoption_review",
      metadata: {
        adoptionHash: ADOPTION_HASH,
        evidence: {
          ...artifact,
          reviewed: true,
          reviewCompleted: true,
          reviewDecision: "APPROVED",
          unresolvedThreadCount: 0,
          ...overrides.review,
        },
      },
      createdAt: "2026-09-01T10:12:00.000Z",
    },
    {
      id: 504,
      eventType: "EVIDENCE_RECORDED",
      entityType: "williamos_delivery_seal",
      metadata: {
        adoptionHash: ADOPTION_HASH,
        seal: {
          payload: {
            version: "williamos-delivery-seal.v2",
            adoption: {
              worldId: "space-1",
              outcome: { key: "ATLAS_PROJECTION" },
              workOrder: { id: 31 },
              adoptionHash: ADOPTION_HASH,
              artifact: { ...artifact, ...overrides.sealedArtifact },
            },
            delivery: {
              repository: "https://github.com/bsvalues/terrafusion-atlas",
              commitSha: SHA_A,
              paths: ["src/projection.ts"],
              ...overrides.delivery,
            },
          },
        },
      },
      createdAt: "2026-09-01T10:13:00.000Z",
    },
  ]
}

function correlatedFacts(events: CrossRepositoryChangeSetFacts["events"]): CrossRepositoryChangeSetFacts {
  return facts({
    workOrders: [{ id: 31, ref: "WO-ATLAS-031", title: "Produce Atlas projection", status: "closed", result: "PASS", commitRef: SHA_A }],
    evidence: [{
      id: 501,
      workOrderId: 31,
      result: "PASS",
      repository: "bsvalues/terrafusion-atlas",
      branch: "feature/atlas",
      revision: SHA_A,
      filesChanged: ["src/projection.ts"],
      createdAt: "2026-09-01T10:00:00.000Z",
    }],
    events,
  })
}

describe("Experience V2 cross-repository Change Set projection", () => {
  it("returns a truthful empty projection when the Space has no repository-qualified evidence", () => {
    expect(projectCrossRepositoryChangeSet(facts())).toEqual({
      version: "williamos-cross-repository-change-set.v1",
      worldId: "space-1",
      project: { id: 7, key: "terrafusion", name: "TerraFusion" },
      outcome: { key: "ATLAS_PROJECTION", title: "Atlas parcel projection" },
      units: [],
      dependencies: [],
      limitations: ["No repository-qualified delivery evidence is persisted for this outcome."],
    })
  })

  it("keeps separate Git deliveries and projects only exact persisted delivery, test, and review facts", () => {
    const projection = projectCrossRepositoryChangeSet(facts({
      workOrders: [
        { id: 11, ref: "WO-ATLAS-001", title: "Produce Atlas projection", status: "closed", result: "PASS", commitRef: SHA_A },
        { id: 12, ref: "WO-OS1-001", title: "Consume Atlas projection", status: "review", result: null, commitRef: null },
      ],
      evidence: [
        { id: 101, workOrderId: 11, result: "PASS", repository: "https://github.com/bsvalues/terrafusion-atlas.git", branch: "feature/atlas", revision: SHA_A, filesChanged: ["src/projection.ts"], createdAt: "2026-09-01T10:00:00.000Z" },
        { id: 102, workOrderId: 12, result: "PASS", repository: "bsvalues/terrafusion_os_1.0", branch: "feature/os1", revision: SHA_B, filesChanged: ["backend/AtlasConsumer.cs"], createdAt: "2026-09-01T10:05:00.000Z" },
      ],
      events: [
        {
          id: 201,
          eventType: "EVIDENCE_RECORDED",
          entityType: "loom_codex_assignment",
          metadata: {
            worldId: "space-1", outcome: { key: "ATLAS_PROJECTION" }, workOrder: { id: 11 },
            reservation: { contracts: [{ contractIdentity: "atlas-projection-v1", revisionIdentity: "r1", role: "producer" }] },
          },
          createdAt: "2026-09-01T09:00:00.000Z",
        },
        {
          id: 202,
          eventType: "EVIDENCE_RECORDED",
          entityType: "loom_codex_assignment",
          metadata: {
            worldId: "space-1", outcome: { key: "ATLAS_PROJECTION" }, workOrder: { id: 12 },
            reservation: { contracts: [{ contractIdentity: "atlas-projection-v1", revisionIdentity: "r1", role: "consumer" }] },
          },
          createdAt: "2026-09-01T09:01:00.000Z",
        },
        {
          id: 203,
          eventType: "ARTIFACT_ADOPTION_AUTHORIZED",
          entityType: "williamos_artifact_adoption_authorization",
          metadata: {
            adoptionHash: ADOPTION_HASH,
            context: { worldId: "space-1", outcome: { key: "ATLAS_PROJECTION" }, workOrder: { id: 11 }, repository: "bsvalues/terrafusion-atlas" },
            artifact: { pullRequest: 1401, headSha: SHA_A, paths: ["src/projection.ts"] },
          },
          createdAt: "2026-09-01T10:10:00.000Z",
        },
        {
          id: 204,
          eventType: "ARTIFACT_ADOPTION_VALIDATED",
          entityType: "williamos_artifact_adoption_validation",
          metadata: {
            adoptionHash: ADOPTION_HASH,
            evidence: { pullRequest: 1401, headSha: SHA_A, paths: ["src/projection.ts"], checksComplete: true, checksGreen: true },
          },
          createdAt: "2026-09-01T10:11:00.000Z",
        },
        {
          id: 205,
          eventType: "ARTIFACT_ADOPTION_REVIEWED",
          entityType: "williamos_artifact_adoption_review",
          metadata: {
            adoptionHash: ADOPTION_HASH,
            evidence: { pullRequest: 1401, headSha: SHA_A, paths: ["src/projection.ts"], reviewed: true, reviewCompleted: true, reviewDecision: "APPROVED", unresolvedThreadCount: 0 },
          },
          createdAt: "2026-09-01T10:12:00.000Z",
        },
        {
          id: 206,
          eventType: "EVIDENCE_RECORDED",
          entityType: "williamos_delivery_seal",
          metadata: {
            adoptionHash: ADOPTION_HASH,
            seal: {
              payload: {
                version: "williamos-delivery-seal.v2",
                adoption: { adoptionHash: ADOPTION_HASH, worldId: "space-1", outcome: { key: "ATLAS_PROJECTION" }, workOrder: { id: 11 }, artifact: { pullRequest: 1401, headSha: SHA_A, paths: ["src/projection.ts"] } },
                delivery: { repository: "https://github.com/bsvalues/terrafusion-atlas", commitSha: SHA_A, paths: ["src/projection.ts"] },
              },
            },
          },
          createdAt: "2026-09-01T10:13:00.000Z",
        },
      ],
    }))

    expect(projection.units).toHaveLength(2)
    expect(projection.units[0]).toMatchObject({
      workOrder: { id: 11, ref: "WO-ATLAS-001" },
      repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas" },
      git: { branch: "feature/atlas", revision: SHA_A, pullRequest: 1401 },
      validation: { state: "passed", headSha: SHA_A },
      review: { state: "approved", headSha: SHA_A },
      delivery: { state: "sealed", headSha: SHA_A },
    })
    expect(projection.units[1]).toMatchObject({
      workOrder: { id: 12, ref: "WO-OS1-001" },
      repository: { key: "os-1", identity: "bsvalues/terrafusion_os_1.0" },
      git: { branch: "feature/os1", revision: SHA_B, pullRequest: null },
      validation: { state: "pending", headSha: null },
      review: { state: "pending", headSha: null },
      delivery: { state: "pending", headSha: null },
    })
    expect(projection.dependencies).toEqual([{
      contractIdentity: "atlas-projection-v1",
      revisionIdentity: "r1",
      producerWorkOrderId: 11,
      consumerWorkOrderId: 12,
    }])
    expect(projection.limitations).toContain("Work Order #12 has no persisted pull-request identity.")
    expect(projection.limitations).not.toContain(expect.stringContaining("combined Git"))
  })

  it("does not invent a unit or dependency from missing, conflicting, or prose-only facts", () => {
    const projection = projectCrossRepositoryChangeSet(facts({
      workOrders: [
        { id: 21, ref: null, title: "Ambiguous delivery", status: "active", result: null, commitRef: null },
        { id: 22, ref: null, title: "No repository", status: "active", result: null, commitRef: null },
      ],
      evidence: [
        { id: 301, workOrderId: 21, result: "PASS", repository: "bsvalues/terrafusion-atlas", branch: "a", revision: SHA_A, filesChanged: [], createdAt: "2026-09-01T10:00:00.000Z" },
        { id: 302, workOrderId: 21, result: "PASS", repository: "bsvalues/terrafusion-forge", branch: "b", revision: SHA_B, filesChanged: [], createdAt: "2026-09-01T10:01:00.000Z" },
      ],
      events: [{
        id: 401,
        eventType: "EVIDENCE_RECORDED",
        entityType: "loom_codex_assignment",
        metadata: {
          worldId: "space-1", outcome: { key: "ATLAS_PROJECTION" }, workOrder: { id: 22 },
          task: { text: "Atlas produces the thing and OS consumes it" },
        },
        createdAt: "2026-09-01T09:00:00.000Z",
      }],
    }))

    expect(projection.units).toEqual([])
    expect(projection.dependencies).toEqual([])
    expect(projection.limitations).toEqual(expect.arrayContaining([
      "Work Order #21 has conflicting repository identities and is omitted.",
      "Work Order #22 has no repository-qualified delivery evidence and is omitted.",
    ]))
  })

  it.each([
    ["validation PR", { validation: { pullRequest: 1402 } }, "validation", "pending"],
    ["validation paths", { validation: { paths: ["src/other.ts"] } }, "validation", "pending"],
    ["validation invalid paths", { validation: { paths: ["src/projection.ts", "../outside.ts"] } }, "validation", "pending"],
    ["review head", { review: { headSha: SHA_B } }, "review", "pending"],
    ["review paths", { review: { paths: ["src/other.ts"] } }, "review", "pending"],
  ] as const)("fails closed when %s does not match the authorized artifact", (_name, eventOverride, field, expected) => {
    const projection = projectCrossRepositoryChangeSet(correlatedFacts(correlatedDeliveryEvents(eventOverride)))

    expect(projection.units).toHaveLength(1)
    expect(projection.units[0][field]).toMatchObject({ state: expected, headSha: null })
    expect(projection.units[0].delivery).toEqual({ state: "pending", headSha: null })
    expect(projection.units[0].limitations).toEqual(expect.arrayContaining([
      expect.stringContaining(`${field} evidence does not match the authorized repository, pull request, head, and paths`),
    ]))
  })

  it.each([
    ["repository", { delivery: { repository: "bsvalues/terrafusion-forge" } }],
    ["head", { delivery: { commitSha: SHA_B } }],
    ["paths", { delivery: { paths: ["src/other.ts"] } }],
    ["invalid paths", { delivery: { paths: ["src/projection.ts", "../outside.ts"] } }],
    ["pull request", { sealedArtifact: { pullRequest: 1402 } }],
  ] as const)("does not project a sealed delivery when its %s differs from the authorization", (_name, eventOverride) => {
    const projection = projectCrossRepositoryChangeSet(correlatedFacts(correlatedDeliveryEvents(eventOverride)))

    expect(projection.units).toHaveLength(1)
    expect(projection.units[0].delivery).toEqual({ state: "pending", headSha: null })
    expect(projection.units[0].limitations).toEqual(expect.arrayContaining([
      expect.stringContaining("delivery-seal evidence does not match the authorized repository, pull request, head, and paths"),
    ]))
  })

  it("keeps the entire evidence chain pending when the authorization repository differs from the persisted unit", () => {
    const projection = projectCrossRepositoryChangeSet(correlatedFacts(correlatedDeliveryEvents({
      authorizationRepository: "bsvalues/terrafusion-forge",
    })))

    expect(projection.units).toHaveLength(1)
    expect(projection.units[0]).toMatchObject({
      repository: { identity: "bsvalues/terrafusion-atlas" },
      validation: { state: "pending", headSha: null },
      review: { state: "pending", headSha: null },
      delivery: { state: "pending", headSha: null },
    })
    expect(projection.units[0].limitations).toEqual(expect.arrayContaining([
      expect.stringContaining("artifact authorization does not match the projected repository"),
    ]))
  })

  it("rejects an authorization whose path list is not an exact canonical set", () => {
    const projection = projectCrossRepositoryChangeSet(correlatedFacts(correlatedDeliveryEvents({
      authorizationArtifact: { paths: ["src/projection.ts", "../outside.ts"] },
    })))

    expect(projection.units).toHaveLength(1)
    expect(projection.units[0]).toMatchObject({
      validation: { state: "pending", headSha: null },
      review: { state: "pending", headSha: null },
      delivery: { state: "pending", headSha: null },
    })
    expect(projection.units[0].limitations).toEqual(expect.arrayContaining([
      expect.stringContaining("artifact authorization does not match the projected repository or lacks an exact pull request, head, and path set"),
    ]))
  })
})
