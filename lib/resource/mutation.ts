import type { ResourceRecord } from "@/lib/resource/resolve"

/**
 * The one mutating operation this system may perform, and the shape of its permission.
 *
 * `lib/governance/execute-guard.ts` (WO-012) locked the execute loop to a non-mutating surface and said
 * why: a future authority expansion must replace V1 deliberately, "never by a developer quietly wiring
 * EXECUTE_LOOP to a shell." This is that deliberate expansion, and it is deliberately tiny.
 *
 * The same discipline as the read-only probe (#883) applies, because the risk is identical and larger:
 *
 *   - the operation is chosen from a fixed catalogue, by NAME, never by caller text;
 *   - source and destination come from the resource record, never from a request;
 *   - the nodes come from the record's identities, never from inference;
 *   - a path that could influence a shell is refused rather than escaped;
 *   - nothing deletes. Relocation copies; removing the origin is a separate decision.
 *
 * If it can move something the record did not declare, it is wrong.
 */

export const MUTATING_OPERATIONS = ["relocate-source", "restore-database"] as const
export type MutatingOperation = (typeof MUTATING_OPERATIONS)[number]

/** Where a relocation puts things on the destination node. Fixed, not caller-supplied. */
export const RELOCATION_ROOT = "/backup-primary/pacs"

const SAFE_PATH = /^[A-Za-z0-9._/\\:@+~-]{1,512}$/
const SAFE_NODE = /^[a-z0-9-]+$/

export interface RelocationPlan {
  identity: string
  sourceNode: string
  sourcePath: string
  destinationNode: string
  destinationPath: string
  recordedBytes: number | null
}

export type RelocationRefusal =
  | "NO_DECLARED_OWNER"
  | "NOTHING_TO_RELOCATE"
  | "ALREADY_ON_OWNER"
  | "PATH_REFUSED"

export interface RelocationVerdict {
  ok: boolean
  refusal?: RelocationRefusal
  detail?: string
  plans: RelocationPlan[]
}

/**
 * What a relocation would move, derived entirely from the record.
 *
 * Only `source` artefacts are relocatable. Completion evidence describes work that already happened
 * somewhere and copying it would be fabricating history in a new place; derivatives belong to their own
 * resource. The distinction matters: the point is to move the workload's inputs to its declared owner,
 * not to scatter copies of everything.
 */
export function planRelocation(record: ResourceRecord): RelocationVerdict {
  const owner = record.workloadOwner?.identity?.trim().toLowerCase() ?? null
  if (!owner || !SAFE_NODE.test(owner)) {
    return { ok: false, refusal: "NO_DECLARED_OWNER", detail: "the record declares no workload owner to move to", plans: [] }
  }

  const plans: RelocationPlan[] = []
  let sawSource = false
  let refusedPath = false

  for (const item of record.sources) {
    const separator = item.identity.indexOf(":")
    if (separator <= 0) continue
    sawSource = true
    const node = item.identity.slice(0, separator).trim().toLowerCase()
    const path = item.identity.slice(separator + 1).trim()
    if (!SAFE_NODE.test(node) || !SAFE_PATH.test(path) || !path.startsWith("/")) {
      refusedPath = true
      continue
    }
    if (node === owner) continue // already where it belongs
    const name = path.split("/").filter(Boolean).pop() ?? ""
    if (!name || !SAFE_PATH.test(name)) {
      refusedPath = true
      continue
    }
    plans.push({
      identity: item.identity,
      sourceNode: node,
      sourcePath: path,
      destinationNode: owner,
      destinationPath: `${RELOCATION_ROOT}/${name}`,
      recordedBytes: recordedBytesFrom(item.label),
    })
  }

  if (plans.length === 0) {
    if (refusedPath) {
      return { ok: false, refusal: "PATH_REFUSED", detail: "every declared source has a path this refuses to handle", plans: [] }
    }
    return sawSource
      ? { ok: false, refusal: "ALREADY_ON_OWNER", detail: "every declared source already sits on the declared owner", plans: [] }
      : { ok: false, refusal: "NOTHING_TO_RELOCATE", detail: "the record declares no source artefacts", plans: [] }
  }
  return { ok: true, plans }
}

export interface RestorePlan {
  node: string
  backupPath: string
  database: string
}

/**
 * Where the database gets restored, and from which artefact.
 *
 * The backup must already be on the declared owner: restoring across a network from another machine
 * would work and would also leave the workload depending on the node it was supposed to move off. It
 * picks the largest declared source on the owner, because a spatial backup and an OLTP backup are both
 * sources and only one of them is the database being moved.
 */
export function planRestore(record: ResourceRecord, database: string): RelocationVerdictOf<RestorePlan> {
  const owner = record.workloadOwner?.identity?.trim().toLowerCase() ?? null
  if (!owner || !SAFE_NODE.test(owner)) {
    return { ok: false, refusal: "NO_DECLARED_OWNER", detail: "the record declares no workload owner", plan: null }
  }
  const onOwner = record.sources
    .map((item) => {
      const separator = item.identity.indexOf(":")
      if (separator <= 0) return null
      const node = item.identity.slice(0, separator).trim().toLowerCase()
      const path = item.identity.slice(separator + 1).trim()
      return { node, path, bytes: recordedBytesFrom(item.label) ?? 0 }
    })
    .filter((item): item is { node: string; path: string; bytes: number } => Boolean(item))
    .filter((item) => item.node === owner && SAFE_PATH.test(item.path) && item.path.startsWith("/"))
    .sort((a, b) => b.bytes - a.bytes)

  if (onOwner.length === 0) {
    return {
      ok: false,
      refusal: "NOTHING_TO_RELOCATE",
      detail: "no declared source sits on the workload owner yet; relocate before restoring",
      plan: null,
    }
  }
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) {
    return { ok: false, refusal: "PATH_REFUSED", detail: "the database name is not a plain identifier", plan: null }
  }
  return { ok: true, plan: { node: owner, backupPath: onOwner[0].path, database } }
}

export interface RelocationVerdictOf<T> {
  ok: boolean
  refusal?: RelocationRefusal
  detail?: string
  plan: T | null
}

function recordedBytesFrom(label: string): number | null {
  const match = /([0-9][0-9,]{3,})\s*bytes/i.exec(label)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ""))
  return Number.isFinite(value) ? value : null
}

/**
 * The command that performs one relocation, run ON the destination node.
 *
 * It pulls rather than pushes, so the destination is the only machine holding a credential for this,
 * and it copies rather than moves: rsync without --delete, no rm anywhere. A relocation that removed
 * the origin would make a failed transfer unrecoverable, and removing the origin is a decision nobody
 * has made.
 *
 * --partial --append-verify lets an interrupted 100 GB transfer resume instead of restarting, and
 * verifies what was already there rather than trusting it.
 */
export function relocationCommand(plan: RelocationPlan): string {
  for (const value of [plan.sourcePath, plan.destinationPath]) {
    if (!SAFE_PATH.test(value)) throw new Error("RELOCATION_PATH_REFUSED")
  }
  if (!SAFE_NODE.test(plan.sourceNode) || !SAFE_NODE.test(plan.destinationNode)) {
    throw new Error("RELOCATION_NODE_REFUSED")
  }
  const destinationDir = plan.destinationPath.slice(0, plan.destinationPath.lastIndexOf("/")) || "/"
  return [
    `mkdir -p '${destinationDir}'`,
    `rsync -a --partial --append-verify -e 'ssh -o BatchMode=yes -o ConnectTimeout=10' ` +
      `'${plan.sourceNode}:${plan.sourcePath}' '${plan.destinationPath}'`,
  ].join(" && ")
}
