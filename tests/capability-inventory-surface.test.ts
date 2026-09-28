import path from "node:path"
import { describe, expect, it } from "vitest"

import * as registry from "@/components/operator/multi-agent-capability-registry"
import { COMPUTE_CAPABILITY_WORKLOADS, projectComputeCapabilities, type CapabilitySurfaceRow } from "@/lib/environment/capability-inventory-surface"

/**
 * The capability surface's whole claim is that it shows the SAME thing dispatch enforces. These
 * tests prove it structurally (same module object, same gate), by behavior (a flipped device probe
 * changes the surface because the surface reads the probe, not a copy), and by honesty (an
 * unreachable device is shown as unhealthy — never assumed).
 */

const HEALTHY = {
  deviceHealthy: true, deviceQuerySucceeded: true,
  cumlVersion: "26.08.00", cudfVersion: "26.08.01",
}
const DOWN = { deviceHealthy: false, deviceQuerySucceeded: false, probeError: "forced-offline" }

async function project(probe: () => Promise<Record<string, unknown>>) {
  return projectComputeCapabilities({ probe })
}

describe("capability inventory surface", () => {
  it("projects the five COMPUTE_CAPABILITY records from the registry itself — no second inventory", async () => {
    const result = await project(async () => HEALTHY)
    const live = registry.MULTI_AGENT_CAPABILITY_INVENTORY.filter(
      (entry) => entry.kind === "COMPUTE_CAPABILITY")
    expect(result.capabilities).toHaveLength(live.length)
    expect(result.capabilities.map((row: CapabilitySurfaceRow) => row.capabilityId).sort()).toEqual(
      live.map((entry) => entry.capabilityId).sort())
    expect(result.source).toContain("multi-agent-capability-registry")
    // Contract 2: every displayed identity/state field IS the registry record, not a restatement.
    for (const row of result.capabilities) {
      const record = registry.capability(row.capabilityId)!
      expect(row.status).toBe(record.status)
      expect(row.executionClass).toBe(record.executionClass)
      expect(row.claim).toBe(record.claim)
      expect(row.reasonCode).toBe(record.reasonCode)
      expect(row.restrictions).toEqual([...record.restrictions])
    }
  }, 120_000)

  it("dispatch decision and displayed eligibility agree (contract 6)", async () => {
    const result = await project(async () => HEALTHY)
    for (const row of result.capabilities as CapabilitySurfaceRow[]) {
      const decision = registry.evaluateCapabilityDispatch(registry.capability(row.capabilityId))
      expect(row.dispatch).toEqual(decision)
    }
  }, 120_000)

  it("a healthy device yields GPU placement on the surface exactly where dispatch would run GPU", async () => {
    const result = await project(async () => HEALTHY)
    const byId = new Map<string, CapabilitySurfaceRow>(result.capabilities.map((row: CapabilitySurfaceRow) => [row.capabilityId, row]))
    expect(byId.get("gpu-tabular-ml")!.placementProbe!.placement).toBe("CUDA_DEVICE")
    expect(byId.get("gpu-clustering")!.placementProbe!.placement).toBe("CUDA_DEVICE")
    expect(byId.get("gpu-aggregation")!.placementProbe!.placement).toBe("CUDA_DEVICE")
    expect(byId.get("gpu-anomaly-screening")!.placementProbe!.placement).toBe("SCREENING_ONLY")
    expect(byId.get("gpu-dimensional-reduction")!.placementProbe!.placement).toBe("CPU")
    for (const row of result.capabilities) expect(row.binding.healthy).toBe(true)
    // Contract 3 (review thread, P2): the LIVE probe observation is displayed, not just the
    // reviewed constants, and agreement with the reviewed binding is explicit.
    const gpu = byId.get("gpu-tabular-ml")!
    expect(gpu.binding.observed).toBe("cuml 26.08.00 · cudf 26.08.01")
    expect(gpu.binding.matchesReview).toBe(true)
    // Contract 3 (review thread, P2): curve validity is scoped to curve-gated capabilities. The
    // screening and measured-refusal rows' decisions read no curve, so the banner must not claim
    // curve evidence for them.
    expect(byId.get("gpu-anomaly-screening")!.evidenceState.state).toBe("DECISION_INDEPENDENT_OF_CURVE")
    expect(byId.get("gpu-dimensional-reduction")!.evidenceState.state).toBe("DECISION_INDEPENDENT_OF_CURVE")
  }, 120_000)

  it("device state change reaches the surface from the probe, and recovery restores it (contracts 4/5)", async () => {
    const before = await project(async () => HEALTHY)
    expect(before.capabilities[0]!.binding.healthy).toBe(true)

    const flipped = await project(async () => DOWN)
    for (const row of flipped.capabilities) {
      expect(row.binding.healthy).toBe(false)
      // Never assumed: an unread device can only ever show the CPU path with a typed reason.
      if (COMPUTE_CAPABILITY_WORKLOADS[row.capabilityId] && row.dispatch.allowed) {
        expect(row.placementProbe!.placement).toBe("CPU")
        expect(row.placementProbe!.reasonCode).toBe("CPU_DEFAULT_BINDING_UNAVAILABLE")
      }
    }

    const after = await project(async () => HEALTHY)
    expect(after.capabilities[0]!.binding.healthy).toBe(true)
    expect(after.capabilities[0]!.placementProbe!.placement).toBe("CUDA_DEVICE")
  }, 180_000)

  it("threshold and evidence state come from the measured curve through the reviewed loader (contract 3)", async () => {
    const adapter = await import("../scripts/execution-fabric/gpu-tabular-capability.mjs")
    const curvePath = path.resolve(
      "scripts/execution-fabric/gpu-tabular-bench/evidence/placement-curve.json")
    const evidence = adapter.loadPlacementEvidence(curvePath)
    expect(evidence.ok).toBe(true)
    const result = await project(async () => HEALTHY)
    const regression = result.capabilities.find(
      (row: CapabilitySurfaceRow) => row.capabilityId === "gpu-tabular-ml")!
    expect(regression.thresholdRows)
      .toBe(adapter.thresholdRowsFor("regression", evidence))
    expect(regression.evidenceState).toMatchObject({ state: "VALID", digest: evidence.digest })
    // Refused classes carry their reason instead of a threshold, and say why.
    const pca = result.capabilities.find(
      (row: CapabilitySurfaceRow) => row.capabilityId === "gpu-dimensional-reduction")!
    expect(pca.thresholdRows).toBeNull()
    expect(pca.placementProbe!.reasonCode).toBe("CPU_MEASURED_NO_GPU_BENEFIT")
  }, 120_000)

  it("an evidence file that disappears makes the surface show the typed failure, not stale green (fail-closed)", async () => {
    const result = await projectComputeCapabilities({
      probe: async () => HEALTHY,
      root: path.resolve("."),
      // now: far future -> the committed curve is stale by the reviewed TTL
      now: new Date(Date.now() + 400 * 86_400_000),
    })
    for (const row of result.capabilities) {
      if (COMPUTE_CAPABILITY_WORKLOADS[row.capabilityId] && row.dispatch.allowed) {
        expect(row.evidenceState.state).toBe("THRESHOLD_EVIDENCE_STALE")
        expect(row.placementProbe!.placement).toBe("CPU")
        expect(row.placementProbe!.reasonCode).toBe("CPU_DEFAULT_THRESHOLD_EVIDENCE_STALE")
      }
    }
  }, 120_000)
})
