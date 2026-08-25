import fs from "node:fs/promises"
import path from "node:path"

import { readRegistry, type NodeRecord } from "@/lib/fabric/transport.mjs"

import {
  canonicalNodeIdForHostname,
  readNodeIdentityContract,
  type NodeIdentityContract,
} from "./node-identity-contract"
import { projectSystemObjects, type InventoryNode, type SystemObjectGraph } from "./system-object"

/**
 * Where the canonical object graph comes from when the application needs one.
 *
 * Gate 1a shipped `projectSystemObjects` and, at the time this was written, it had **zero production
 * consumers** -- both bounded first-action searches recorded that as a decisive fact. This module is
 * the first, and it is deliberately thin: it reads the two reviewed sources the projection already
 * names, hands them over, and adds nothing of its own. It is NOT a second object source, a second
 * inventory, or a second projection. If it ever starts deciding what an object is, it has become the
 * thing the charter forbids.
 *
 * INVENTORY COMES FROM THE REVIEWED SEED, not from an assembled snapshot. The snapshot at
 * `.artifacts/execution-fabric/registry.snapshot.json` is a build artifact that this application does
 * not produce and that is absent on a fresh checkout, and a loader whose behaviour depends on whether
 * a build step has run is one that answers differently in CI than in the cockpit. The seed is
 * committed, reviewed and digest-pinned, and the assembler consumes it too, so this reads the same
 * truth one step earlier rather than a different truth.
 *
 * ENDPOINT BINDING IS RESTATED, AND THAT IS A COST WORTH NAMING. `NodeObject.transport` carries the
 * transport record's contents but not the registry KEY the record was filed under, so a caller
 * holding a projected node cannot ask the broker to act on it. Adding that key to the projection
 * would change the Gate 1 schema, which #995 puts explicitly out of scope. So the binding is computed
 * here, using `canonicalNodeIdForHostname` -- the projection's own rule, called rather than
 * reimplemented -- and `tests/system-object-source` asserts that the endpoints this returns agree with
 * the transport the projection independently derived for the same nodes. Two owners of one concept is
 * a smell; two owners that are tested against each other is a smell with a tripwire on it.
 */

export interface SystemObjectSource {
  graph: SystemObjectGraph
  contract: NodeIdentityContract
  /** The transport-registry key each projected node binds to, by the projection's own rule. */
  endpointByNodeId: Readonly<Record<string, string>>
  /** The transport records, so a caller resolves the broker's node the broker's way. */
  transport: Readonly<Record<string, NodeRecord>>
}

export interface SystemObjectSourceOptions {
  /** Repository root. Injected by tests; the route uses the process working directory. */
  repositoryRoot?: string
  /** Fabric root holding `nodes.json`. Defaults to the broker's own default. */
  fabricRoot?: string
  nowMs?: number
}

const SEED_RELATIVE_PATH = path.join("config", "execution-fabric", "registry.seed.json")
const CONTRACT_RELATIVE_PATH = path.join("config", "execution-fabric", "node-identity-contract.json")

export class SystemObjectSourceError extends Error {
  constructor(
    message: string,
    readonly code: "INVENTORY_UNAVAILABLE" | "TRANSPORT_UNAVAILABLE" | "CONTRACT_UNAVAILABLE",
  ) {
    super(message)
    this.name = "SystemObjectSourceError"
  }
}

/**
 * Which transport endpoint corresponds to each canonical node.
 *
 * Character-for-character the rule in `projectSystemObjects`: try the registry key against the
 * identity contract, then the record's declared host, and let the first binding win. Restating the
 * precedence rather than the lookup is what keeps this honest -- if the projection ever changes which
 * of the two it prefers, the test that compares them is what fails.
 */
function bindEndpoints(
  contract: NodeIdentityContract,
  transport: Record<string, NodeRecord>,
): Record<string, string> {
  const endpointForNode: Record<string, string> = {}
  for (const [endpoint, record] of Object.entries(transport)) {
    const nodeId = canonicalNodeIdForHostname(contract, endpoint)
      ?? canonicalNodeIdForHostname(contract, typeof record.host === "string" ? record.host : null)
    if (nodeId && endpointForNode[nodeId] === undefined) endpointForNode[nodeId] = endpoint
  }
  return endpointForNode
}

export async function loadSystemObjectSource(
  options: SystemObjectSourceOptions = {},
): Promise<SystemObjectSource> {
  const root = options.repositoryRoot ?? process.cwd()

  let contract: NodeIdentityContract
  try {
    contract = readNodeIdentityContract(path.join(root, CONTRACT_RELATIVE_PATH))
  } catch (error) {
    // Fail closed, for the same reason the contract reader does: this is the file that decides which
    // machine is allowed to be which node, and an identity check that degrades to "assume yes" when
    // its contract is missing is not a check.
    throw new SystemObjectSourceError((error as Error).message, "CONTRACT_UNAVAILABLE")
  }

  let inventory: readonly InventoryNode[]
  try {
    const seed = JSON.parse(await fs.readFile(path.join(root, SEED_RELATIVE_PATH), "utf8")) as {
      nodes?: readonly InventoryNode[]
    }
    if (!Array.isArray(seed.nodes)) throw new Error("the inventory seed declares no nodes array")
    inventory = seed.nodes
  } catch (error) {
    throw new SystemObjectSourceError((error as Error).message, "INVENTORY_UNAVAILABLE")
  }

  let transport: Record<string, NodeRecord>
  try {
    transport = await readRegistry(options.fabricRoot)
  } catch (error) {
    throw new SystemObjectSourceError((error as Error).message, "TRANSPORT_UNAVAILABLE")
  }

  return {
    graph: projectSystemObjects({ inventory, transport, contract, nowMs: options.nowMs }),
    contract,
    endpointByNodeId: bindEndpoints(contract, transport),
    transport,
  }
}
