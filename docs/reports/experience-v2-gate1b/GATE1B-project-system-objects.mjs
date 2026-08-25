/**
 * GATE 1B SETTLEMENT — canonical projection hop.
 *
 * Runs merged-main `lib/system/system-object.ts` over the assembled snapshot, the transport registry
 * and the brokered observation. It declares nothing; it is a pure data transform over evidence that
 * was already produced by the brokered probe.
 *
 * usage: node project-system-objects.mjs <worktree-root> <evidence-dir> <mode>
 *   mode: "live"   -- project with the observation's real timestamps
 *         "stale"  -- same inputs, clock advanced past the snapshot ttl (invariant check)
 */
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const root = process.argv[2]
const evidenceDir = process.argv[3]
const mode = process.argv[4] ?? "live"

const { projectSystemObjects } = await import(
  pathToFileURL(path.join(root, "lib", "system", "system-object.ts")).href
)
const { parseNodeIdentityContract } = await import(
  pathToFileURL(path.join(root, "lib", "system", "node-identity-contract.ts")).href
)

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"))

const snapshot = readJson(path.join(evidenceDir, "registry.snapshot.json"))
const transport = readJson(path.join(evidenceDir, "transport-nodes.json"))
const probe = readJson(path.join(evidenceDir, "hermes-node.json"))
const invocation = readJson(path.join(evidenceDir, "hermes-node.brokered-invocation.json"))
const contract = parseNodeIdentityContract(
  readJson(path.join(root, "config", "execution-fabric", "node-identity-contract.json")),
)

// The observation is what the BROKERED probe reported about itself, verbatim. Nothing here supplies
// an identity the probe did not observe.
const observations = {
  hermes: {
    reachable: invocation.ok === true,
    detail: invocation.ok === true ? null : invocation.errorMessage ?? "unreachable",
    observedIdentity: {
      hostname: probe.node.identity.hostname,
      machine_id_sha256: probe.node.identity.machine_id_sha256,
    },
    observedAt: probe.node.observed_at,
  },
}

const observedMs = Date.parse(probe.node.observed_at)
const ttlSeconds = snapshot.nodes.find((n) => n.id === "hermes-node")?.evidence?.ttl_seconds ?? 300
// "live" pins the clock one second after the observation so the result is reproducible from the
// recorded bytes rather than from whenever this happens to be re-run.
// "stale" advances it one second past the ttl and changes NOTHING else.
const nowMs = mode === "stale" ? observedMs + (ttlSeconds + 1) * 1000 : observedMs + 1000

const graph = projectSystemObjects({
  inventory: snapshot.nodes,
  transport,
  observations,
  contract,
  nowMs,
})

console.log(
  JSON.stringify(
    {
      mode,
      nowMs,
      nowIso: new Date(nowMs).toISOString(),
      ttlSeconds,
      objects: graph.objects,
      unverifiedEndpointCandidates: graph.unverifiedEndpointCandidates,
    },
    null,
    2,
  ),
)
