import { describe, expect, it } from "vitest"

import { changeSetSurfaceModel } from "@/components/workspace-shell/change-set-projection"
import type { CrossRepositoryChangeSetProjection } from "@/lib/environment/cross-repository-change-set"

const projection: CrossRepositoryChangeSetProjection = {
  version: "williamos-cross-repository-change-set.v1",
  worldId: "space-1",
  project: { id: 1, key: "terrafusion", name: "TerraFusion" },
  outcome: { key: "ATLAS-OUTCOME", title: "Atlas parcel projection" },
  units: [
    {
      id: "work-order:7:atlas",
      workOrder: { id: 7, ref: "WO-ATLAS-7", title: "Produce projection", status: "active", result: null },
      repository: { key: "atlas", identity: "bsvalues/terrafusion-atlas" },
      git: { branch: "codex/atlas", revision: "a".repeat(40), pullRequest: 1200, paths: ["src/projection.ts"] },
      validation: { state: "passed", headSha: "a".repeat(40) },
      review: { state: "approved", headSha: "a".repeat(40) },
      delivery: { state: "sealed", headSha: "a".repeat(40) },
      limitations: [],
    },
    {
      id: "work-order:8:os-1",
      workOrder: { id: 8, ref: "WO-OS1-8", title: "Consume projection", status: "queued", result: null },
      repository: { key: "os-1", identity: "bsvalues/terrafusion_os_1.0" },
      git: { branch: null, revision: null, pullRequest: null, paths: [] },
      validation: { state: "pending", headSha: null },
      review: { state: "pending", headSha: null },
      delivery: { state: "pending", headSha: null },
      limitations: ["No persisted revision identity."],
    },
  ],
  dependencies: [{
    contractIdentity: "atlas-feature-projection-v1",
    revisionIdentity: "sha256:contract-1",
    producerWorkOrderId: 7,
    consumerWorkOrderId: 8,
  }],
  limitations: ["Work Order #8 has no persisted revision identity."],
}

describe("Change Set UI projection", () => {
  it("preserves separate repository deliveries and only explicit contract dependencies", () => {
    const model = changeSetSurfaceModel(projection, [
      { key: "atlas", label: "Atlas", role: "suite-source" },
      { key: "os-1", label: "OS 1.0", role: "integrated-runtime" },
    ])

    expect(model.outcome).toBe("Atlas parcel projection")
    expect(model.units).toHaveLength(2)
    expect(model.units[0]).toMatchObject({
      repositoryKey: "atlas",
      state: "delivery-sealed",
      produces: "atlas-feature-projection-v1@sha256:contract-1",
      pullRequest: { number: 1200, status: "recorded" },
    })
    expect(model.units[1]).toMatchObject({
      repositoryKey: "os-1",
      state: "evidence-pending",
      branch: null,
      revision: null,
      consumes: ["atlas-feature-projection-v1@sha256:contract-1"],
      dependsOn: ["work-order:7:atlas"],
    })
    expect(model.limitations).toEqual(projection.limitations)
  })

  it("does not infer a dependency when none is persisted", () => {
    const model = changeSetSurfaceModel({ ...projection, dependencies: [] }, [])
    expect(model.units.every((unit) => !unit.dependsOn?.length && !unit.produces && !unit.consumes?.length)).toBe(true)
  })
})
