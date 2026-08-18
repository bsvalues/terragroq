import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { defaultFabricRoot, parseRegistry } from "./run-baseline.mjs"

/**
 * Change one node's entry without destroying anyone else's work.
 *
 * The registry is the canonical answer to which machines this lab manages and how they are reached,
 * and it is edited by more than one lane. Three times in a single day an agent -- me -- rewrote a node
 * object wholesale and silently dropped a correction another lane had made: the OMEN username, then
 * its hostname. Both times the value looked wrong only because I had not read what was there, and
 * both were recoverable solely because someone had hand-made a backup first.
 *
 * The mistake is structural, not careless. Rewriting a whole object is a destructive operation wearing
 * the clothes of an edit, so this offers only a merge: fields you name are changed, fields you do not
 * name survive, and removing one has to be asked for explicitly. A write also refuses if the file
 * changed since it was read, because "I did not know someone else had edited it" is exactly the
 * failure this exists to prevent.
 */

export const REGISTRY_FILE = "nodes.json"

export class RegistryConflict extends Error {
  constructor(node) {
    super(`REGISTRY_CHANGED_ON_DISK: ${node ?? "registry"} was edited since it was read; re-read before writing`)
    this.name = "RegistryConflict"
  }
}

export class RegistryFieldLoss extends Error {
  constructor(node, fields) {
    super(`REGISTRY_FIELD_LOSS: updating "${node}" would drop ${fields.join(", ")}; pass them in remove[] to mean it`)
    this.name = "RegistryFieldLoss"
    this.fields = fields
  }
}

function registryPath(fabricRoot) {
  return path.join(fabricRoot, REGISTRY_FILE)
}

/** Content hash of the registry as it is on disk, used to detect a concurrent edit. */
export async function registryFingerprint(fabricRoot = defaultFabricRoot()) {
  const text = await fs.readFile(registryPath(fabricRoot), "utf8")
  return crypto.createHash("sha256").update(text).digest("hex")
}

export async function readNodes(fabricRoot = defaultFabricRoot()) {
  const text = await fs.readFile(registryPath(fabricRoot), "utf8")
  return { nodes: parseRegistry(text), fingerprint: crypto.createHash("sha256").update(text).digest("hex") }
}

/**
 * Merge fields into one node.
 *
 * `patch` sets or adds; `remove` deletes, and only what it names. Anything already present and not
 * mentioned is carried through untouched -- including fields this code has never heard of, because a
 * field it does not recognise is far more likely to be another lane's than to be junk.
 */
export async function updateNodeFields(name, patch, options = {}) {
  const { fabricRoot = defaultFabricRoot(), remove = [], expectFingerprint } = options
  const { nodes, fingerprint } = await readNodes(fabricRoot)

  if (expectFingerprint && expectFingerprint !== fingerprint) throw new RegistryConflict(name)

  const before = nodes[name] ?? {}

  // An undefined value survives the spread but disappears in JSON.stringify, so a field would be
  // erased on disk while looking present in memory. That is the silent deletion this module exists to
  // prevent, so it is refused rather than serialized.
  const erasing = Object.entries(patch ?? {})
    .filter(([, value]) => value === undefined)
    .map(([key]) => key)
    .filter((key) => key in before && !remove.includes(key))
  if (erasing.length > 0) throw new RegistryFieldLoss(name, erasing)

  const patched = { ...before, ...patch }
  for (const field of remove) delete patched[field]

  const dropped = Object.keys(before).filter((key) => !(key in patched) && !remove.includes(key))
  if (dropped.length > 0) throw new RegistryFieldLoss(name, dropped)

  const next = { ...nodes, [name]: patched }
  const serialized = JSON.stringify(next, null, 2) + "\n"

  // Re-read immediately before writing: the gap between decision and write is small but this is the
  // exact race that lost another lane's edit.
  const current = crypto.createHash("sha256").update(await fs.readFile(registryPath(fabricRoot), "utf8")).digest("hex")
  if (current !== fingerprint) throw new RegistryConflict(name)

  await fs.writeFile(registryPath(fabricRoot), serialized, "utf8")
  return { before, after: patched, changed: Object.keys(patch).concat(remove) }
}
