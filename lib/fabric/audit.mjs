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
export async function auditFabricAction(fabricRoot, node, action, rc, detail) {
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
    throw new Error("AUDIT_UNAVAILABLE")
  }
}
