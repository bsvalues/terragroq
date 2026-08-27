/**
 * Declared-vs-observed accelerator reconciliation for hermes-node, keyed by canonicalKey only.
 * It compares two evidence documents. It asserts nothing about hardware on its own.
 */
import fs from "node:fs"
import path from "node:path"

const wt = process.argv[2]
const evidenceDir = process.argv[3]
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"))

const seed = readJson(path.join(wt, "config", "execution-fabric", "registry.seed.json"))
const probe = readJson(path.join(evidenceDir, "hermes-node.json"))
const live = readJson(path.join(evidenceDir, "projection-live.json"))

const declaredGpus = seed.nodes.find((n) => n.id === "hermes-node").gpus
const observedGpus = probe.node.gpus
const projected = live.objects.filter((o) => o.kind === "ACCELERATOR" && o.nodeId === "hermes-node")

// The declared side has no key to inherit, and that is the whole point of this table.
const declaredRows = declaredGpus.map((g) => ({
  side: "declared (seed)",
  id: g.id,
  model: g.model,
  uuid: g.uuid,
  pci_bus_id: g.pci_bus_id,
  vram_source: g.vram_source,
  canonicalKeyWouldBe: g.uuid ? `accelerator:uuid:${g.uuid}` : g.pci_bus_id ? `accelerator:hermes-node:pci-bus-id:${String(g.pci_bus_id).toLowerCase()}` : null,
}))

const observedRows = observedGpus.map((g) => ({
  side: "observed (brokered probe)",
  id: g.id,
  model: g.model,
  uuid: g.uuid,
  pci_bus_id: g.pci_bus_id,
  vram_source: g.vram_source,
  canonicalKey: projected.find((p) => p.identity.value === g.uuid)?.canonicalKey ?? null,
}))

const declaredKeys = new Set(declaredRows.map((r) => r.canonicalKeyWouldBe).filter(Boolean))
const observedKeys = new Set(observedRows.map((r) => r.canonicalKey).filter(Boolean))

console.log(
  JSON.stringify(
    {
      declared: declaredRows,
      observed: observedRows,
      declaredCanonicalKeys: [...declaredKeys],
      observedCanonicalKeys: [...observedKeys],
      newIdentities: [...observedKeys].filter((k) => !declaredKeys.has(k)),
      declaredIdentitiesNotObserved: [...declaredKeys].filter((k) => !observedKeys.has(k)),
      declaredModelsNotObserved: declaredRows
        .map((r) => r.model)
        .filter((m) => !observedRows.some((o) => String(o.model).includes(m))),
      inheritance: {
        anyObservedKeyEqualsADeclaredKey: [...observedKeys].some((k) => declaredKeys.has(k)),
        note:
          "declared HERMES GPUs carry uuid:null and pci_bus_id:null, so they have no canonicalKey to inherit",
      },
    },
    null,
    2,
  ),
)
