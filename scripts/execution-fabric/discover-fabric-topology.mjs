import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

/**
 * IF-02 whole-fabric discovery compiler.
 *
 * Aggregates per-node probe observations (the existing execution-fabric probe evidence) and measured
 * FabricLinks (measure-fabric-link.sh) into one freshness-gated FabricTopologySnapshot. The governing
 * rule (spec 11 proof 5): a STALE / UNKNOWN / FAILED observation is never presented as AVAILABLE
 * placement capacity -- it is preserved verbatim as UNKNOWN, never guessed. Unknown nodes are denied,
 * not inferred from historical notes.
 */

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const FRESH_TTL_SECONDS = 300

function freshness(observedAt, nowMs) {
  if (typeof observedAt !== "string") return "UNKNOWN"
  const t = Date.parse(observedAt)
  if (!Number.isFinite(t)) return "UNKNOWN"
  if (t > nowMs) return "FAILED" // a future observation is not evidence
  return nowMs - t <= FRESH_TTL_SECONDS * 1000 ? "LIVE" : "STALE"
}

function projectNode(nodeId, probe, nowMs) {
  const state = freshness(probe?.node?.observed_at ?? probe?.observedAt, nowMs)
  const capacity = {}
  if (probe?.node) {
    const gpus = Array.isArray(probe.node.gpus) ? probe.node.gpus : []
    if (gpus.length > 0) capacity.acceleratorCount = gpus.length
    const vram = gpus.reduce((sum, g) => sum + (Number(g.vram_bytes) || 0), 0)
    if (vram > 0) capacity.acceleratorVramBytes = vram
    const cpus = Array.isArray(probe.node.cpus) ? probe.node.cpus : []
    if (cpus.length > 0) capacity.cpuThreads = cpus.reduce((sum, c) => sum + (Number(c.threads) || 0), 0)
    const dimms = Array.isArray(probe.node.dimms) ? probe.node.dimms : []
    const ram = dimms.reduce((sum, d) => sum + (Number(d.capacity_bytes) || 0), 0)
    if (ram > 0) capacity.systemMemoryBytes = ram
  }
  return {
    nodeId,
    role: probe?.node?.role ?? undefined,
    observedAt: probe?.node?.observed_at ?? probe?.observedAt,
    freshnessState: state,
    ...(Object.keys(capacity).length > 0 ? { capacity } : {}),
    evidenceRef: probe ? "scripts/execution-fabric/probe-linux.sh" : undefined,
  }
}

export function buildTopologySnapshot({ probes = {}, links = [], now = new Date() } = {}) {
  const nowMs = now.getTime()
  const nodes = Object.entries(probes).map(([nodeId, probe]) => projectNode(nodeId, probe, nowMs))
  const projectedLinks = links.map((link) => ({ ...link, freshnessState: link.freshnessState === "LIVE" ? freshness(link.observedAt, nowMs) : link.freshnessState }))
  const body = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    nodes,
    links: projectedLinks,
    evidenceRefs: ["scripts/execution-fabric/measure-fabric-link.sh", "scripts/execution-fabric/probe-linux.sh"],
  }
  const digest = "sha256:" + sha(JSON.stringify(body))
  return { ...body, digest }
}

// A placement-facing projection: STALE/UNKNOWN/FAILED observations are denied, never AVAILABLE.
export function placementCapacity(snapshot) {
  const out = {}
  for (const node of snapshot.nodes) {
    out[node.nodeId] = node.freshnessState === "LIVE" ? { available: true, capacity: node.capacity ?? {} } : { available: false, reason: `observation_${node.freshnessState.toLowerCase()}` }
  }
  for (const link of snapshot.links) {
    out[link.id] = link.freshnessState === "LIVE"
      ? { available: true, measuredBandwidthBytesPerSecond: link.measuredBandwidthBytesPerSecond ?? null, latencyMsP50: link.latencyMsP50 ?? null }
      : { available: false, reason: `link_${link.freshnessState.toLowerCase()}` }
  }
  return out
}

if (process.argv[1] && import.meta.url === new URL(import.meta.url).href && process.argv[2] === "compile") {
  const evidenceDir = process.argv[3] ?? "C:/HermesLab/daedalus/evidence"
  const probes = {}
  const placementDir = path.join(evidenceDir, "placement")
  if (fs.existsSync(placementDir)) {
    for (const file of fs.readdirSync(placementDir)) {
      if (!file.endsWith(".json")) continue
      try {
        const probe = JSON.parse(fs.readFileSync(path.join(placementDir, file), "utf8"))
        const nodeId = probe?.node?.id ?? file.replace(/\.json$/, "")
        if (probe?.schema_version === "0.1-node-probe") probes[nodeId] = probe
      } catch { /* skip unreadable evidence */ }
    }
  }
  const linksFile = process.argv[4]
  const links = linksFile && fs.existsSync(linksFile)
    ? fs.readFileSync(linksFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : []
  const snapshot = buildTopologySnapshot({ probes, links })
  process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n")
}
