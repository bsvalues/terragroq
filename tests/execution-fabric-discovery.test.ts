import { describe, expect, it } from "vitest"

import { FabricLinkSchema, FabricTopologySnapshotSchema } from "@/components/operator/intelligence-fabric-contracts"
import { buildTopologySnapshot, placementCapacity } from "../scripts/execution-fabric/discover-fabric-topology.mjs"

const NOW = new Date("2026-09-10T09:00:00Z")
const fresh = "2026-09-10T09:00:00Z"
const stale = "2026-09-10T08:50:00Z" // 10 min old, past the 300s TTL

const probe = (observed) => ({ schema_version: "0.1-node-probe", node: { id: "daedalus", observed_at: observed, role: "resident-gpu", gpus: [{ vram_bytes: 25769803776 }], cpus: [{ threads: 24 }], dimms: [{ capacity_bytes: 64000000000 }] } })
  const link = (id, observed, freshnessState = "LIVE") => ({ id, fromNodeId: "hermes-node", toNodeId: "daedalus", transportClass: "ethernet-lan-ssh", trustClass: "lab", observedAt: observed, freshnessState, latencyMsP50: 1, latencyMsP95: 14, measuredBandwidthBytesPerSecond: 73010126, evidenceRef: "x" })

describe("IF-02 FabricLink contract", () => {
  it("accepts a measured live link and rejects p95 below p50", () => {
    expect(FabricLinkSchema.safeParse(link("a", fresh)).success).toBe(true)
    expect(FabricLinkSchema.safeParse({ ...link("a", fresh), latencyMsP50: 20, latencyMsP95: 5 }).success).toBe(false)
  })
  it("a LIVE link must carry a measurement; an unmeasured 'live' assertion fails", () => {
    const unmeasured = { ...link("a", fresh) }
    delete unmeasured.latencyMsP50
    delete unmeasured.measuredBandwidthBytesPerSecond
    expect(FabricLinkSchema.safeParse(unmeasured).success).toBe(false)
  })
  it("rejects unknown/extra fields (strict)", () => {
    expect(FabricLinkSchema.safeParse({ ...link("a", fresh), speedMbps: 1000 }).success).toBe(false)
  })
})

describe("IF-02 discovery compiler — freshness gate", () => {
  it("fresh observations project LIVE and become AVAILABLE; stale project STALE and are denied", () => {
    const snapshot = buildTopologySnapshot({
      probes: { daedalus: probe(fresh), aegis: probe(stale) },
      links: [link("hermes-node..daedalus", fresh), link("hermes-node..aegis", stale)],
      now: NOW,
    })
    const byId = Object.fromEntries(snapshot.nodes.map((n) => [n.nodeId, n]))
    expect(byId.daedalus.freshnessState).toBe("LIVE")
    expect(byId.aegis.freshnessState).toBe("STALE")

    const capacity = placementCapacity(snapshot)
    expect(capacity.daedalus.available).toBe(true)
    expect(capacity.daedalus.capacity.acceleratorVramBytes).toBe(25769803776)
    expect(capacity.aegis.available).toBe(false)
    expect(capacity.aegis.reason).toBe("observation_stale")
    expect(capacity["hermes-node..daedalus"].available).toBe(true)
    expect(capacity["hermes-node..aegis"].available).toBe(false)
  })

  it("an unknown node (no probe) is preserved as UNKNOWN and never becomes AVAILABLE", () => {
    const snapshot = buildTopologySnapshot({ probes: {}, links: [], now: NOW })
    expect(snapshot.nodes).toEqual([])
    const capacity = placementCapacity(snapshot)
    expect(capacity.omen).toBeUndefined() // unknown nodes are denied by absence, not invented
  })

  it("a future-dated observation is FAILED, never LIVE", () => {
    const snapshot = buildTopologySnapshot({ probes: { daedalus: probe("2026-09-11T00:00:00Z") }, links: [], now: NOW })
    expect(snapshot.nodes[0].freshnessState).toBe("FAILED")
    expect(placementCapacity(snapshot).daedalus.available).toBe(false)
  })

  it("the emitted snapshot validates against the FabricTopologySnapshot contract", () => {
    const snapshot = buildTopologySnapshot({ probes: { daedalus: probe(fresh) }, links: [link("hermes-node..daedalus", fresh)], now: NOW })
    expect(FabricTopologySnapshotSchema.safeParse(snapshot).success).toBe(true)
  })
})
