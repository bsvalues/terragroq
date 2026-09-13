#!/usr/bin/env node
/**
 * #1223 — the door provenance gate.
 *
 * Owner-stated required invariant (2026-09-12): "The door may start only a revision proven to be
 * an integrated lab-main revision with valid integration provenance."
 *
 * The git path enforces its own half (integrate-lab-main.mjs refuses unproven integration).
 * This closes the other half: the filesystem path. Anything that can robocopy a tree into the
 * runtime root and restart the supervised tasks used to BE the deployment authority, bypassing
 * the entire lifecycle — proven live at 02:39Z on 2026-09-12 (`c890d981`, an unreviewed side
 * branch, reached the door in ~90 seconds). After this gate, such a tree cannot boot: its
 * built provenance names a revision that is not in the authoritative integration ledger.
 *
 * Inputs (read-only):
 *   <appRoot>/lib/generated/build-provenance.json   the revision the bundle actually is
 *   ~/.williamos/integrations.json                  the lab authority's ledger: every entry with
 *                                                   productState COMPLETE records a labMainAfter
 *                                                   revision that WAS integrated through the
 *                                                   sealed authority (candidate+seal+review bound).
 *
 * Fail-closed, typed refusals, no network, no fallback:
 *   ARGS_INVALID | PROVENANCE_FILE_UNREADABLE | PROVENANCE_SHA_MALFORMED |
 *   LEDGER_UNREADABLE | LEDGER_EMPTY | REVISION_NOT_INTEGRATED
 * Exit 0 only when the built sha equals the labMainAfter of a COMPLETE ledger entry; the accepted
 * line echoes the entry's recorded sealKey so the boot log carries its own provenance witness.
 */
import fs from "node:fs"
import path from "node:path"

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...rest] = a.replace(/^--/, "").split("=")
  return [k, rest.join("=")]
}))
const fail = (code, detail) => {
  console.error(`DOOR_PROVENANCE_REFUSED ${code} ${String(detail).slice(0, 200)}`)
  process.exit(1)
}

const appRoot = argv["app-root"]
if (!appRoot) fail("ARGS_INVALID", "--app-root=<runtime root> is required")

const provPath = path.join(appRoot, "lib", "generated", "build-provenance.json")
let prov
try { prov = JSON.parse(fs.readFileSync(provPath, "utf8")) }
catch (error) { fail("PROVENANCE_FILE_UNREADABLE", `${provPath}: ${error?.message ?? error}`) }
const sha = String(prov?.sha ?? "").toLowerCase()
if (!/^[0-9a-f]{40}$/.test(sha)) {
  fail("PROVENANCE_SHA_MALFORMED", `build-provenance.json sha=${JSON.stringify(String(prov?.sha ?? "").slice(0, 64))}`)
}

const ledgerPath = argv["ledger"]
  || process.env.WILLIAMOS_INTEGRATIONS_LEDGER
  || path.join(process.env.USERPROFILE || process.env.HOME || "", ".williamos", "integrations.json")
let ledger
try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) }
catch (error) { fail("LEDGER_UNREADABLE", `${ledgerPath}: ${error?.message ?? error}`) }

const entries = Array.isArray(ledger?.integrations) ? ledger.integrations : []
const authorized = new Map()
for (const e of entries) {
  if (e?.productState === "COMPLETE" && typeof e?.labMainAfter === "string") {
    authorized.set(e.labMainAfter.toLowerCase(), e)
  }
}
if (authorized.size === 0) fail("LEDGER_EMPTY", `no COMPLETE integration entries in ${ledgerPath}`)
if (!authorized.has(sha)) {
  fail("REVISION_NOT_INTEGRATED", `${sha.slice(0, 12)} is not an authorized integrated lab-main revision per ${ledgerPath}`)
}
const witness = authorized.get(sha)
console.log(`DOOR_PROVENANCE_OK ${sha} authorized_at=${witness.at ?? ""} sealKey=${witness.sealKey ?? ""} reviewerKey=${witness.reviewerKey ?? ""}`)
process.exit(0)
