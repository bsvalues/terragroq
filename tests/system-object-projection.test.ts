import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  canonicalNodeIdForHostname,
  canonicalNodeIds,
  NodeIdentityContractError,
  parseNodeIdentityContract,
  readNodeIdentityContract,
} from "@/lib/system/node-identity-contract"
import {
  projectSystemObjects,
  type AcceleratorObject,
  type InventoryNode,
  type NodeObject,
  type TransportRecord,
} from "@/lib/system/system-object"
import { projectSystemTruth } from "@/lib/system/system-truth"

/**
 * Gate 1a acceptance: the thirteen invariants from #990.
 *
 * Deterministic, synthetic fixtures only. Gate 1a claims NO runtime proof and must not -- HERMES is
 * down while the P40 is physically installed, and a projection that manufactured a runtime claim to
 * look complete is the exact failure this gate exists to prevent. Gate 1b settles the live path.
 */

const repositoryRoot = process.cwd()
const contract = readNodeIdentityContract(
  path.join(repositoryRoot, "config/execution-fabric/node-identity-contract.json"),
)
const seed = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "config/execution-fabric/registry.seed.json"), "utf8"),
) as { nodes: InventoryNode[] }

const NOW = Date.parse("2026-08-24T12:00:00.000Z")
const FRESH = "2026-08-24T11:59:00.000Z"
const ANCIENT = "2026-08-24T09:00:00.000Z"

const PIN = "a".repeat(64)
const OTHER_PIN = "b".repeat(64)

function inventoryNode(overrides: Partial<InventoryNode> = {}): InventoryNode {
  return {
    id: "hermes-node",
    identity: { hostname: "HERMES", machine_id_sha256: PIN },
    role: "local-ai-gpu-execution-worker",
    gpus: [],
    evidence: { observed_at: FRESH, confidence: "observed", ttl_seconds: 300 },
    ...overrides,
  }
}

function nodeObjects(graph: { objects: readonly unknown[] }): NodeObject[] {
  return graph.objects.filter((object) => (object as NodeObject).kind === "NODE") as NodeObject[]
}

function acceleratorObjects(graph: { objects: readonly unknown[] }): AcceleratorObject[] {
  return graph.objects.filter(
    (object) => (object as AcceleratorObject).kind === "ACCELERATOR",
  ) as AcceleratorObject[]
}

function project(
  inventory: InventoryNode[],
  transport: Record<string, TransportRecord> = {},
  observations = {},
) {
  return projectSystemObjects({ inventory, transport, observations, contract, nowMs: NOW })
}

describe("Invariant 1 - accelerator identity is a UUID or PCI bus id, never a name or a slot", () => {
  it("keys a GPU on its UUID", () => {
    const graph = project([
      inventoryNode({ gpus: [{ id: "gpu0", uuid: "GPU-1111", pci_bus_id: "0000:01:00.0", model: "RTX 3050" }] }),
    ])
    const [accelerator] = acceleratorObjects(graph)

    expect(accelerator.identity).toEqual({ resolved: true, kind: "uuid", value: "GPU-1111" })
    expect(accelerator.objectId).toBe("accelerator:uuid:GPU-1111")
  })

  it("falls back to the PCI bus id, never the friendly name", () => {
    const graph = project([
      inventoryNode({ gpus: [{ id: "gpu0", uuid: null, pci_bus_id: "0000:01:00.0", model: "Quadro K2200" }] }),
    ])
    const [accelerator] = acceleratorObjects(graph)

    expect(accelerator.identity).toEqual({ resolved: true, kind: "pci-bus-id", value: "0000:01:00.0" })
    expect(accelerator.objectId).not.toContain("Quadro")
  })

  it("treats a new UUID in the same slot as a NEW object", () => {
    const before = acceleratorObjects(
      project([inventoryNode({ gpus: [{ id: "gpu0", uuid: "GPU-OLD", model: "Quadro K2200" }] })]),
    )
    // Same node, same slot id `gpu0`, different card. This is the P40 swap.
    const after = acceleratorObjects(
      project([inventoryNode({ gpus: [{ id: "gpu0", uuid: "GPU-NEW", model: "Tesla P40" }] })]),
    )

    expect(before[0].objectId).not.toBe(after[0].objectId)
  })

  it("projects identity-unresolved for the records that actually ship, rather than dropping them", () => {
    // The Windows CIM fallback emits uuid: null, pci_bus_id: null, and so do the declared HERMES
    // GPUs in the seed. A UUID/PCI-only rule cannot represent either.
    const graph = project([
      inventoryNode({
        gpus: [{ id: "gpu0", uuid: null, pci_bus_id: null, model: "GeForce RTX 3050" }],
      }),
    ])
    const [accelerator] = acceleratorObjects(graph)

    expect(accelerator.identity.resolved).toBe(false)
    expect(accelerator.identity).toMatchObject({ state: "identity-unresolved", inheritsHistory: false })
    expect(accelerator.annotations).toContain("IDENTITY_UNRESOLVED")
    // Visible and truthful, not silently keyed on something weaker.
    expect(accelerator.objectId).toContain("identity-unresolved")
  })

  it("keeps every shipped seed GPU representable", () => {
    const graph = project(seed.nodes)
    const declared = seed.nodes.flatMap((node) => node.gpus ?? [])

    expect(acceleratorObjects(graph)).toHaveLength(declared.length)
  })
})

describe("Invariant 1, continued - findings from the independent adversarial review", () => {
  it("does not merge two nodes' cards that share a PCI bus address (GPU-1)", () => {
    // A PCI bus id is an address on ONE host's bus. `0000:01:00.0` names a different card on every
    // machine that has one, so keying on it unscoped merged two nodes' accelerators into one object.
    const graph = project([
      inventoryNode({ id: "hermes-node", gpus: [{ id: "gpu0", uuid: null, pci_bus_id: "0000:01:00.0" }] }),
      inventoryNode({
        id: "omen",
        identity: { hostname: "OMEN", machine_id_sha256: OTHER_PIN },
        gpus: [{ id: "gpu0", uuid: null, pci_bus_id: "0000:01:00.0" }],
      }),
    ])
    const [first, second] = acceleratorObjects(graph)

    expect(first.canonicalKey).not.toBe(second.canonicalKey)
    expect(first.objectId).not.toBe(second.objectId)
  })

  it("treats the same PCI address in different case as the same slot, not a new card", () => {
    const lower = acceleratorObjects(project([inventoryNode({ gpus: [{ id: "gpu0", pci_bus_id: "0000:01:00.0" }] })]))
    const upper = acceleratorObjects(project([inventoryNode({ gpus: [{ id: "gpu0", pci_bus_id: "0000:01:00.0".toUpperCase() }] })]))

    expect(lower[0].canonicalKey).toBe(upper[0].canonicalKey)
  })

  it("gives an unresolved accelerator NO canonical key, so history cannot accumulate on it (GPU-2)", () => {
    // `inheritsHistory: false` was a description. It did not stop a consumer keying history on
    // `objectId`, which for an unresolved card is derived from the node and the slot -- so replacing
    // one unresolved card with another in the same slot produced the same string.
    const before = acceleratorObjects(
      project([inventoryNode({ gpus: [{ id: "gpu0", uuid: null, pci_bus_id: null, model: "Quadro K2200" }] })]),
    )
    const after = acceleratorObjects(
      project([inventoryNode({ gpus: [{ id: "gpu0", uuid: null, pci_bus_id: null, model: "Tesla P40" }] })]),
    )

    expect(before[0].canonicalKey).toBeNull()
    expect(after[0].canonicalKey).toBeNull()
    // The render key may still collide -- that is what a slot is. The canonical key may not exist.
    expect(before[0].objectId).toBe(after[0].objectId)
  })

  it("keeps a UUID key global, because a GPU UUID already is", () => {
    const graph = project([
      inventoryNode({ id: "hermes-node", gpus: [{ id: "gpu0", uuid: "GPU-1111" }] }),
    ])

    expect(acceleratorObjects(graph)[0].canonicalKey).toBe("accelerator:uuid:GPU-1111")
  })
})

describe("Invariant 2 - accelerators enumerate without parsing any presentation string", () => {
  it("exposes accelerators as structured children of the node", () => {
    const graph = project([
      inventoryNode({
        gpus: [
          { id: "gpu0", uuid: "GPU-1111", model: "RTX 3050", vram_bytes: 6442450944, vram_source: "nvidia-smi" },
          { id: "gpu1", uuid: "GPU-2222", model: "Quadro K2200" },
        ],
      }),
    ])
    const [node] = nodeObjects(graph)

    expect(node.accelerators).toHaveLength(2)
    expect(node.accelerators.map((accelerator) => accelerator.model)).toEqual(["RTX 3050", "Quadro K2200"])
    for (const accelerator of node.accelerators) {
      expect(typeof accelerator.identity).toBe("object")
      expect(typeof accelerator.memory.total).toBe("object")
    }
  })
})

describe("Invariant 3 - an unreachable node still projects, unknown, with its reason preserved", () => {
  it("keeps the specific failure rather than collapsing it to 'unreachable'", () => {
    const graph = project(
      [inventoryNode()],
      { HERMES: { transport: "ssh", host: "HERMES", role: "local-ai-gpu-execution-worker" } },
      { HERMES: { reachable: false, detail: "Permission denied (publickey)" } },
    )
    const [node] = nodeObjects(graph)

    expect(node.truthState).toBe("unknown")
    expect(node.reason).toBe("Permission denied (publickey)")
    // It projects. It does not disappear from the list.
    expect(node.nodeId).toBe("hermes-node")
  })
})

describe("Invariant 4 - a probe past the freshness bound projects stale, never live", () => {
  it("projects stale for aged evidence", () => {
    const graph = project(
      [inventoryNode({ evidence: { observed_at: ANCIENT, confidence: "observed", ttl_seconds: 300 } })],
      { HERMES: { transport: "ssh", host: "HERMES" } },
      { HERMES: { reachable: true, observedIdentity: { machine_id_sha256: PIN } } },
    )
    const [node] = nodeObjects(graph)

    expect(node.truthState).toBe("stale")
    expect(node.truthState).not.toBe("live")
    expect(node.reason).toMatch(/exceeds ttl/)
  })

  it("projects live inside the bound", () => {
    const graph = project(
      [inventoryNode()],
      { HERMES: { transport: "ssh", host: "HERMES" } },
      { HERMES: { reachable: true, observedIdentity: { machine_id_sha256: PIN } } },
    )

    expect(nodeObjects(graph)[0].truthState).toBe("live")
  })

  it("never projects a DECLARED record as live, however fresh its timestamp looks", () => {
    // The seed's declared records carry a well-formed `observed_at` and today a ttl of 0, so ageing
    // alone happens to fence them. That is an accident of the current seed, not a rule: raise the ttl
    // and a node that was never probed would report `live`. Confidence is checked before the
    // arithmetic for exactly that reason.
    const graph = project(
      [inventoryNode({ evidence: { observed_at: FRESH, confidence: "declared", ttl_seconds: 300 } })],
      { HERMES: { transport: "ssh", host: "HERMES" } },
      { HERMES: { reachable: true, observedIdentity: { machine_id_sha256: PIN } } },
    )
    const [node] = nodeObjects(graph)

    expect(node.truthState).toBe("unknown")
    // Not `stale` either: staleness says a measurement aged out, and this one was never taken.
    expect(node.truthState).not.toBe("stale")
    expect(node.reason).toMatch(/declared evidence/)
  })

  it("never projects future-dated evidence as live (TIME-1)", () => {
    // `ageSeconds > ttlSeconds` is false for a negative age, so a timestamp a day in the future read
    // as a fresh measurement. It is not stale either -- it was never aged out, it is incoherent.
    const future = new Date(NOW + 86_400_000).toISOString()
    const graph = project(
      [inventoryNode({ evidence: { observed_at: future, confidence: "observed", ttl_seconds: 300 } })],
      { HERMES: { transport: "ssh", host: "HERMES" } },
      { HERMES: { reachable: true, observedIdentity: { machine_id_sha256: PIN } } },
    )
    const [node] = nodeObjects(graph)

    expect(node.truthState).toBe("unknown")
    expect(node.truthState).not.toBe("live")
    expect(node.reason).toMatch(/in the future/)
  })

  it("tolerates ordinary clock skew rather than calling it the future", () => {
    const slightlyAhead = new Date(NOW + 5_000).toISOString()
    const graph = project(
      [inventoryNode({ evidence: { observed_at: slightlyAhead, confidence: "observed", ttl_seconds: 300 } })],
      { HERMES: { transport: "ssh", host: "HERMES" } },
      { HERMES: { reachable: true, observedIdentity: { machine_id_sha256: PIN } } },
    )

    expect(nodeObjects(graph)[0].truthState).toBe("live")
  })

  it("lets an aged observation age the node even when the inventory record is fresh (TIME-2)", () => {
    // `observedAt` was declared on the observation and never read, so the projection reported the
    // freshness of the RECORD rather than of the observation that promoted it.
    const graph = project(
      [inventoryNode()],
      { HERMES: { transport: "ssh", host: "HERMES" } },
      {
        HERMES: {
          reachable: true,
          observedIdentity: { machine_id_sha256: PIN },
          observedAt: ANCIENT,
        },
      },
    )
    const [node] = nodeObjects(graph)

    expect(node.promotion.promoted).toBe(true)
    expect(node.truthState).toBe("stale")
    expect(node.truthState).not.toBe("live")
  })

  it("gives system-truth a stale state distinct from unknown", () => {
    const evidence = [
      {
        system: "HERMES" as const,
        signal: "ollama",
        evidenceKind: "current-query" as const,
        succeeded: true,
        observedAt: ANCIENT,
        source: "test",
        summary: "aged",
      },
    ]

    expect(projectSystemTruth(evidence, { freshnessSeconds: 300, nowMs: NOW })[0].truthState).toBe("stale")
    expect(projectSystemTruth(evidence, { freshnessSeconds: 100_000, nowMs: NOW })[0].truthState).toBe("live")
    // Callers that pass no bound keep their exact prior behaviour.
    expect(projectSystemTruth(evidence)[0].truthState).toBe("live")
  })
})

describe("Invariant 5 - every owner-directed node in the inventory is representable, OMEN included", () => {
  it("projects all five seed nodes", () => {
    const projected = nodeObjects(project(seed.nodes)).map((node) => node.nodeId)

    expect(projected).toEqual(seed.nodes.map((node) => node.id))
    expect(projected).toContain("omen")
  })

  it("carries the owner-directed role from the inventory", () => {
    const omen = nodeObjects(project(seed.nodes)).find((node) => node.nodeId === "omen")!

    expect(omen.role).toBe("operator-cockpit-development-burst-compute")
  })
})

describe("Invariant 6 - the projection exposes no mutation and no authority", () => {
  it("returns frozen objects carrying no authority", () => {
    const graph = project(seed.nodes)

    expect(Object.isFrozen(graph)).toBe(true)
    for (const object of graph.objects) {
      expect(Object.isFrozen(object)).toBe(true)
      expect(object).not.toHaveProperty("authority")
      expect(object).not.toHaveProperty("allow")
      expect(object).not.toHaveProperty("deny")
    }
  })

  it("exports no mutator", () => {
    // A projection that can write is not a projection. The contract module reads authority for the
    // assembler's benefit; nothing on the projected object does.
    const projected = JSON.stringify(project(seed.nodes))

    expect(projected).not.toContain("bounded_compute")
    expect(projected).not.toContain("authoritative-durable-state")
  })
})

describe("Invariant 7 - a fallback-sourced vram_bytes never becomes capacity", () => {
  it("projects the Win32_VideoController number as a qualified lower bound, not a measurement", () => {
    const graph = project([
      inventoryNode({
        gpus: [
          {
            id: "PCI\\VEN_10DE",
            uuid: null,
            pci_bus_id: null,
            model: "GeForce RTX 3050",
            vram_bytes: 4293918720,
            vram_used_bytes: null,
            vram_source: "win32-videocontroller",
          },
        ],
      }),
    ])
    const [accelerator] = acceleratorObjects(graph)

    expect(accelerator.memory.total.state).toBe("unknown")
    expect(accelerator.memory.total).toMatchObject({ lowerBoundBytes: 4293918720 })
    expect(accelerator.annotations).toContain("VRAM_LOWER_BOUND_ONLY")
    // Never headroom, and never rendered as 0.
    expect(accelerator.memory.headroom.state).toBe("unknown")
    expect(JSON.stringify(accelerator.memory.headroom)).not.toContain('"bytes":0')
  })

  it("projects unknown, never 0, when there is no source at all", () => {
    const graph = project([
      inventoryNode({ gpus: [{ id: "gpu0", uuid: "GPU-1", model: "Quadro K2200", vram_bytes: null, vram_source: null }] }),
    ])
    const [accelerator] = acceleratorObjects(graph)

    expect(accelerator.memory.total.state).toBe("unknown")
    expect(accelerator.memory.total).not.toHaveProperty("bytes")
  })
})

describe("Invariant 8 - total VRAM never presents as reservable or free capacity", () => {
  it("leaves headroom unknown when used VRAM is absent", () => {
    const graph = project([
      inventoryNode({
        gpus: [
          { id: "gpu0", uuid: "GPU-1", model: "RTX 3050", vram_bytes: 6442450944, vram_used_bytes: null, vram_source: "nvidia-smi" },
        ],
      }),
    ])
    const [accelerator] = acceleratorObjects(graph)

    expect(accelerator.memory.total).toMatchObject({ state: "measured", bytes: 6442450944 })
    // Total-minus-nothing is how a full accelerator gets scheduled as an empty one.
    expect(accelerator.memory.headroom.state).toBe("unknown")
  })

  it("computes headroom only when both sides were measured", () => {
    const graph = project([
      inventoryNode({
        gpus: [
          {
            id: "gpu0",
            uuid: "GPU-1",
            model: "RTX 3050",
            vram_bytes: 6442450944,
            vram_used_bytes: 1442450944,
            vram_source: "nvidia-smi",
          },
        ],
      }),
    ])
    const [accelerator] = acceleratorObjects(graph)

    expect(accelerator.memory.headroom).toMatchObject({ state: "measured", bytes: 5000000000 })
  })

  it("never reports a capability better than UNKNOWN without bench evidence", () => {
    for (const accelerator of acceleratorObjects(project(seed.nodes))) {
      expect(accelerator.capability).toBe("UNKNOWN")
    }
  })
})

describe("Invariant 11 - the join is tested in both directions and both outcomes", () => {
  it("projects an inventory-only node with transport unknown", () => {
    const graph = project([inventoryNode()], {})
    const [node] = nodeObjects(graph)

    expect(node.transport.state).toBe("unknown")
    expect(node.nodeId).toBe("hermes-node")
  })

  it("does not promote a transport-only record, and does not drop it either", () => {
    const graph = project([], { "some-laptop": { transport: "ssh", host: "some-laptop" } })

    expect(nodeObjects(graph)).toHaveLength(0)
    expect(graph.unverifiedEndpointCandidates).toHaveLength(1)
    expect(graph.unverifiedEndpointCandidates[0]).toMatchObject({
      kind: "UNVERIFIED_ENDPOINT_CANDIDATE",
      endpoint: "some-laptop",
    })
  })

  it("promotes an endpoint whose observed identity matches the reviewed pin", () => {
    const graph = project(
      [inventoryNode()],
      { HERMES: { transport: "ssh", host: "HERMES" } },
      { HERMES: { reachable: true, observedIdentity: { machine_id_sha256: PIN } } },
    )
    const [node] = nodeObjects(graph)

    expect(node.promotion.promoted).toBe(true)
    expect(node.promotion.reason).toMatch(/matched the reviewed inventory pin/)
  })

  it("leaves a mismatched identity unpromoted, with the mismatch preserved rather than reported as unreachable", () => {
    const graph = project(
      [inventoryNode()],
      { HERMES: { transport: "ssh", host: "HERMES" } },
      { HERMES: { reachable: true, observedIdentity: { machine_id_sha256: OTHER_PIN } } },
    )
    const [node] = nodeObjects(graph)

    expect(node.promotion.promoted).toBe(false)
    expect(node.reason).toContain("identity mismatch")
    // The endpoint answered. Calling that "unreachable" sends the reader to the network.
    expect(node.reason).not.toMatch(/unreachable/i)
  })
})

describe("Invariant 13 - a transport role never overrides the owner-directed role", () => {
  it("projects both and marks the transport side CONFLICTING, not stale", () => {
    const graph = project([inventoryNode()], {
      HERMES: { transport: "ssh", host: "HERMES", role: "gpu-box" },
    })
    const [node] = nodeObjects(graph)

    expect(node.role).toBe("local-ai-gpu-execution-worker")
    expect(node.transport).toMatchObject({ role: "gpu-box", roleAgreement: "CONFLICTING" })
    // That record carries no timestamp, so it cannot support a temporal claim.
    expect(JSON.stringify(node.transport)).not.toContain("stale")
  })

  it("marks agreement when the labels match", () => {
    const graph = project([inventoryNode()], {
      HERMES: { transport: "ssh", host: "HERMES", role: "local-ai-gpu-execution-worker" },
    })

    expect(nodeObjects(graph)[0].transport).toMatchObject({ roleAgreement: "AGREES" })
  })
})

describe("the node identity contract replaces three copies rather than adding a fourth", () => {
  it("is the only place the roster and the hostname aliases are written", () => {
    expect(canonicalNodeIds(contract)).toEqual(["omen", "hermes-node", "atlas", "aegis", "azure"])
    expect(canonicalNodeIdForHostname(contract, "OMEN")).toBe("omen")
    expect(canonicalNodeIdForHostname(contract, "hermes")).toBe("hermes-node")
    expect(canonicalNodeIdForHostname(contract, "HERMES-NODE")).toBe("hermes-node")
    expect(canonicalNodeIdForHostname(contract, "atlas.lan")).toBe("atlas")
    expect(canonicalNodeIdForHostname(contract, "aegis")).toBe("aegis")
  })

  it("refuses an unrecognised hostname rather than guessing", () => {
    expect(canonicalNodeIdForHostname(contract, "some-laptop")).toBeNull()
    expect(canonicalNodeIdForHostname(contract, "")).toBeNull()
  })

  it("no longer appears as a hardcoded table in either probe or in the assembler", () => {
    const windowsProbe = fs.readFileSync(path.join(repositoryRoot, "scripts/execution-fabric/probe-windows.ps1"), "utf8")
    const linuxProbe = fs.readFileSync(path.join(repositoryRoot, "scripts/execution-fabric/probe-linux.sh"), "utf8")
    const assembler = fs.readFileSync(path.join(repositoryRoot, "scripts/execution-fabric/assemble-registry-core.mjs"), "utf8")

    expect(windowsProbe).not.toContain("'OMEN' = 'omen'")
    expect(linuxProbe).not.toContain("{'atlas': 'atlas', 'aegis': 'aegis'}")
    expect(assembler).not.toContain("const canonicalAuthority = {")
    // All three read the one contract instead.
    expect(windowsProbe).toContain("node-identity-contract.json")
    expect(linuxProbe).toContain("node-identity-contract.json")
    expect(assembler).toContain("node-identity-contract.json")
  })

  it("fails closed on a wrong-version or malformed contract", () => {
    expect(() => parseNodeIdentityContract({ contract: "something-else", nodes: {} })).toThrow(
      NodeIdentityContractError,
    )
    expect(() => parseNodeIdentityContract({ contract: "williamos-node-identity/1", nodes: { omen: {} } })).toThrow(
      NodeIdentityContractError,
    )
    expect(() => readNodeIdentityContract(path.join(repositoryRoot, "does-not-exist.json"))).toThrow(
      NodeIdentityContractError,
    )
  })
})

describe("Invariant 12 - no unbrokered transport on the canonical probe path", () => {
  it("removes probeLocal and routes every node through brokeredExec", () => {
    const route = fs.readFileSync(path.join(repositoryRoot, "app/api/fabric/nodes/route.ts"), "utf8")

    // Asserted as "not defined and not called" rather than "the word never appears": the route's
    // comment explains why the local path was removed, and naming the thing you deleted is worth
    // more than a grep that forbids mentioning it.
    expect(route).not.toMatch(/function\s+probeLocal/)
    expect(route).not.toMatch(/\bprobeLocal\s*\(\s*\)/)
    // The raw transport is gone entirely: no child_process, no promisified execFile.
    expect(route).not.toContain("node:child_process")
    expect(route).not.toContain("promisify(execFile)")
    expect(route).toContain("brokeredExec")
  })

  it("is deliberately narrowed to this path, because the broad form is false on main today", () => {
    // lib/fabric/run-baseline.mjs calls exec("powershell") / exec("ssh") directly. That is a real
    // defect and it is NOT Gate 1's to fix -- an invariant that is false at merge teaches nothing.
    const baseline = fs.readFileSync(path.join(repositoryRoot, "lib/fabric/run-baseline.mjs"), "utf8")

    expect(baseline).toContain("child_process")
  })
})

describe("Gate 1a claims no runtime proof", () => {
  it("keeps every capability UNKNOWN and every declared record un-promoted without an observation", () => {
    const graph = project(seed.nodes)

    for (const node of nodeObjects(graph)) {
      expect(node.promotion.promoted).toBe(false)
      expect(node.promotion.reason).toMatch(/promotion requires an observed identity/)
      // Every shipped seed record is `confidence: "declared"`. None of them may claim to be live.
      expect(node.truthState).not.toBe("live")
    }
    for (const accelerator of acceleratorObjects(graph)) {
      expect(accelerator.capability).toBe("UNKNOWN")
      // Declared is not observed: no seed GPU carries a vram_source, so none can claim a measurement.
      expect(accelerator.memory.total.state).toBe("unknown")
    }
  })
})
