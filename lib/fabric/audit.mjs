import fs from "node:fs/promises"
import path from "node:path"

/**
 * The lab's single ledger.
 *
 * This lives on its own so both the broker and the baseline gate can write to it. The broker builds
 * on the gate's transport, so if the ledger lived in the broker the gate could not reach it without
 * an import cycle -- and the practical result of that was the gate starting and stopping a workload
 * on every node while writing nothing down. The most consequential thing the plane does was the one
 * thing absent from the record.
 *
 * The format matches the Python CLI exactly: epoch seconds, node, action, rc, detail. One format, or
 * the reader has to know which tool wrote which line.
 */

/** Thrown when evidence for an action cannot be written, or could not have been written. */
export const AUDIT_UNAVAILABLE = "AUDIT_UNAVAILABLE"

/**
 * Whether there is a ledger here at all.
 *
 * Cached per root: without this, a machine with no fabric directory -- CI, most obviously -- attempts
 * and fails a write for every step of every node, six throwing filesystem calls per node on a suite
 * that is already timing-sensitive. Absent is a different state from broken, and only one of them is
 * worth reporting.
 *
 * ONLY PRESENCE IS CACHED, and that asymmetry is the whole point. The previous version memoised the
 * answer either way, so "there is no ledger here" became permanent for the process lifetime: a ledger
 * created a second later was never noticed, and every action after it completed unrecorded while the
 * ledger sat there waiting to be written to (`CONT-EXPV2-AUDIT-FAIL-LOUD`). A ledger cannot appear
 * and then un-appear, so caching `true` forever is sound; caching `false` forever is a decision to
 * stop looking. Absence costs one `fs.access` per call, which is still far cheaper than the failing
 * `appendFile` the cache was introduced to avoid.
 */
const ledgerPresence = new Map()

async function hasLedger(fabricRoot) {
  if (ledgerPresence.get(fabricRoot) === true) return true
  const present = await fs.access(fabricRoot).then(() => true).catch(() => false)
  if (present) ledgerPresence.set(fabricRoot, true)
  return present
}

/**
 * Refuse to proceed unless this action's evidence can actually be written.
 *
 * Called BEFORE the thing it describes, and that ordering is the requirement rather than a detail.
 * Auditing after the fact can only ever report that the record failed -- by then the node has already
 * been mutated, and a loud unrecorded mutation is no better governed than a silent one. It is the
 * same guarantee in both directions: either the action leaves a durable trace, or it does not happen.
 */
export async function requireLedger(fabricRoot) {
  if (!(await hasLedger(fabricRoot))) {
    throw new Error(`${AUDIT_UNAVAILABLE}: no ledger at ${fabricRoot}`)
  }
}

/**
 * Append one line to the ledger.
 *
 * `required` is how a caller says evidence is part of the action rather than commentary on it. The
 * default stays permissive because read paths and machines that have never had a fabric directory
 * are the common case and neither is a fault; a governed mutation passes `required: true` and an
 * absent ledger then refuses instead of skipping.
 */
export async function auditFabricAction(fabricRoot, node, action, rc, detail, { required = false } = {}) {
  if (!(await hasLedger(fabricRoot))) {
    if (required) throw new Error(`${AUDIT_UNAVAILABLE}: no ledger at ${fabricRoot}`)
    return
  }
  const line = [
    Math.floor(Date.now() / 1000),
    node,
    action,
    `rc=${rc}`,
    String(detail ?? "").replace(/\s+/g, " ").slice(0, 200),
  ].join("\t")
  try {
    await fs.appendFile(path.join(fabricRoot, "audit.log"), line + "\n", "utf8")
  } catch {
    // A ledger that cannot be written must not quietly become a ledger that is not written.
    throw new Error(AUDIT_UNAVAILABLE)
  }
}
