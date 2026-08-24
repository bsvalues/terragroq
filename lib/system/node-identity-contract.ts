import fs from "node:fs"
import path from "node:path"

/**
 * The one owner of node identity, roster and per-node authority.
 *
 * These facts used to live in three places at once: `scripts/execution-fabric/probe-windows.ps1` and
 * `scripts/execution-fabric/probe-linux.sh` each carried a hostname-to-node-id table, and
 * `scripts/execution-fabric/assemble-registry-core.mjs` restated the whole authority catalogue as a
 * literal. Nothing compared them, so a node renamed in one and not the others would simply stop being
 * the node it was -- and no test could see it, because each copy agreed with itself.
 *
 * `config/execution-fabric/node-identity-contract.json` now holds them once. This module is the
 * TypeScript reader; the two probes and the assembler read the same file. It is a REPLACEMENT for the
 * three copies, not a fourth: the data is gone from all three.
 *
 * The contract's bytes are digest-pinned by `scripts/execution-fabric/assemble-registry.mjs` beside
 * the seed and the schema. Moving authority out of code must not move it out of review, and an
 * unpinned file that grants authority is worse than a literal that at least shows up in a diff.
 */

export const NODE_IDENTITY_CONTRACT_VERSION = "williamos-node-identity/1" as const

export interface NodeAuthority {
  allow: readonly string[]
  deny: readonly string[]
  bounded_compute?: unknown
}

export interface NodeIdentityContractEntry {
  /** Hostnames a probe may present to claim this node id. Empty for nodes that are not machines. */
  hostnames: readonly string[]
  authority: NodeAuthority
}

export interface NodeIdentityContract {
  contract: typeof NODE_IDENTITY_CONTRACT_VERSION
  nodes: Record<string, NodeIdentityContractEntry>
}

export class NodeIdentityContractError extends Error {}

export const DEFAULT_NODE_IDENTITY_CONTRACT_PATH = path.join(
  "config",
  "execution-fabric",
  "node-identity-contract.json",
)

/**
 * Parse and validate a contract. Anything that is not exactly this contract is refused rather than
 * partially honoured -- a half-read identity contract is the failure mode it exists to prevent.
 */
export function parseNodeIdentityContract(value: unknown): NodeIdentityContract {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NodeIdentityContractError("NODE_IDENTITY_CONTRACT_WALL: contract is not an object")
  }
  const candidate = value as { contract?: unknown; nodes?: unknown }
  if (candidate.contract !== NODE_IDENTITY_CONTRACT_VERSION) {
    throw new NodeIdentityContractError(
      `NODE_IDENTITY_CONTRACT_WALL: version is ${String(candidate.contract)}, expected ${NODE_IDENTITY_CONTRACT_VERSION}`,
    )
  }
  if (typeof candidate.nodes !== "object" || candidate.nodes === null || Array.isArray(candidate.nodes)) {
    throw new NodeIdentityContractError("NODE_IDENTITY_CONTRACT_WALL: nodes is not an object")
  }
  const nodes: Record<string, NodeIdentityContractEntry> = {}
  for (const [nodeId, rawEntry] of Object.entries(candidate.nodes as Record<string, unknown>)) {
    const entry = rawEntry as { hostnames?: unknown; authority?: unknown }
    if (!Array.isArray(entry?.hostnames)) {
      throw new NodeIdentityContractError(`NODE_IDENTITY_CONTRACT_WALL: ${nodeId} has no hostnames array`)
    }
    const authority = entry.authority as NodeAuthority | undefined
    if (!authority || !Array.isArray(authority.allow) || !Array.isArray(authority.deny)) {
      throw new NodeIdentityContractError(`NODE_IDENTITY_CONTRACT_WALL: ${nodeId} has no allow/deny authority`)
    }
    nodes[nodeId] = { hostnames: entry.hostnames.map(String), authority }
  }
  return { contract: NODE_IDENTITY_CONTRACT_VERSION, nodes }
}

export function readNodeIdentityContract(filePath?: string): NodeIdentityContract {
  const resolved = filePath ?? path.join(process.cwd(), DEFAULT_NODE_IDENTITY_CONTRACT_PATH)
  let raw: string
  try {
    raw = fs.readFileSync(resolved, "utf8")
  } catch (error) {
    // Fail closed. An identity check that degrades to "assume yes" when its contract is missing is
    // not a check, and this is the file that decides which machine is allowed to be which node.
    throw new NodeIdentityContractError(
      `NODE_IDENTITY_CONTRACT_WALL: unreadable at ${resolved}: ${(error as Error).message}`,
    )
  }
  return parseNodeIdentityContract(JSON.parse(raw))
}

/** The canonical node roster, in contract order. */
export function canonicalNodeIds(contract: NodeIdentityContract): string[] {
  return Object.keys(contract.nodes)
}

/**
 * Resolve an observed hostname to its canonical node id.
 *
 * Case-insensitive because the two dialects disagree on case by nature: Windows reports `OMEN`,
 * Linux reports `atlas`. Returns null rather than guessing -- an unrecognised hostname is not a node.
 */
export function canonicalNodeIdForHostname(
  contract: NodeIdentityContract,
  hostname: string | null | undefined,
): string | null {
  const needle = String(hostname ?? "").trim().toLowerCase().split(".")[0]
  if (!needle) return null
  for (const [nodeId, entry] of Object.entries(contract.nodes)) {
    for (const alias of entry.hostnames) {
      if (String(alias).trim().toLowerCase() === needle) return nodeId
    }
  }
  return null
}
