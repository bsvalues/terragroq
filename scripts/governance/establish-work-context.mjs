#!/usr/bin/env node
import fs from "node:fs"
import { register } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { DEFAULT_COCKPIT, openDeviceSession, requestJson } from "./device-session.mjs"

/**
 * Establish this lane's work context and write the receipt the PreToolUse hook checks.
 *
 * A gate with no usable way through it is not a gate, it is a brick -- and a bricked gate gets
 * disabled, which is worse than no gate at all. This is the remedy the hook's refusal points at.
 *
 * PROVENANCE. A receipt is worth what its issuer is worth:
 *
 *   ledger  the cockpit issued it. It checked an owner-recorded authority grant covers the claimed
 *           level, and recorded the claims as a governance event. The token is then unforgeable
 *           locally, because the hook resolves the facts from the ledger rather than from this file.
 *   local   this script minted it. Premises are still complete and still expire automatically, but
 *           nothing checked authority and nothing recorded the claim. An agent willing to edit its
 *           own claim is not stopped by it.
 *
 * Local is the fallback, not the design. It exists because the cockpit path needs a device credential
 * the owner enrols once, and a governance gate that cannot be used until then would simply be turned
 * off. The mode is recorded in the receipt and reported on every issue, so the weaker mode is never
 * mistaken for the stronger one.
 *
 *   node scripts/governance/establish-work-context.mjs \
 *     --work-order WO-EXAMPLE-001 --parent-outcome "the outcome this serves" \
 *     --authority A2_IMPLEMENT --reserve lib/fabric --reserve tests \
 *     --subsystem none-found --topology canonical-registry \
 *     --remaining "what the parent still needs after this lands"
 */

const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()
const RECEIPT_PATH = path.join(PROJECT_ROOT, ".williamos", "work-context.json")

const FLAGS = {
  "--work-order": "workOrderRef",
  "--parent-outcome": "parentOutcome",
  "--authority": "authorityLevel",
  "--subsystem": "existingSubsystem",
  "--topology": "topologySource",
  "--remaining": "remainingParentAcceptance",
}

function parseArgs(argv) {
  const facts = { reservedPaths: [], collisions: [] }
  let cockpit = DEFAULT_COCKPIT
  let requireLedger = false
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === "--reserve") facts.reservedPaths.push(argv[++i])
    else if (flag === "--collision") facts.collisions.push(argv[++i])
    else if (flag === "--cockpit") cockpit = argv[++i]
    // For lanes that must not proceed on the weaker mode: refuse rather than fall back.
    else if (flag === "--require-ledger") requireLedger = true
    else if (FLAGS[flag]) facts[FLAGS[flag]] = argv[++i]
    else {
      console.error(`unknown argument: ${flag}`)
      process.exit(2)
    }
  }
  return { claimed: facts, cockpit, requireLedger }
}

const { claimed, cockpit, requireLedger } = parseArgs(process.argv.slice(2))

register(
  pathToFileURL(path.join(PROJECT_ROOT, "scripts", "governance", "ts-alias-loader.mjs")).href,
  import.meta.url,
)
const { issueWorkContextReceipt } = await import(
  pathToFileURL(path.join(PROJECT_ROOT, "lib", "governance", "work-context-receipt.ts")).href
)
const { measureLiveWorkContext } = await import(
  pathToFileURL(path.join(PROJECT_ROOT, "lib", "governance", "work-context-live.ts")).href
)

/** Ask the cockpit to issue. It re-measures main and doctrine itself and checks authority grants. */
async function issueViaCockpit() {
  const session = await openDeviceSession({ baseUrl: cockpit, projectRoot: PROJECT_ROOT })
  const response = await requestJson(`${cockpit}/api/governance/work-context`, {
    method: "POST",
    body: claimed,
    cookie: session.cookie,
    origin: session.origin,
  })
  if (response.status !== 200 || !response.json?.receipt) {
    const failure = response.json?.failure ?? `HTTP_${response.status}`
    const detail = response.json?.detail ?? response.text.slice(0, 200)
    throw new Error(`${failure}: ${detail}${response.json?.remedy ? `\n  remedy: ${response.json.remedy}` : ""}`)
  }
  return response.json
}

const live = await measureLiveWorkContext()
if (!live) {
  console.error("FAILED_STALE_MAIN: current origin/main could not be measured (is the remote reachable?)")
  process.exit(1)
}

let receipt
let provenance = "ledger"
let facts = { ...claimed, mainSha: live.mainSha, doctrineDigest: live.doctrineDigest }

try {
  const issued = await issueViaCockpit()
  receipt = issued.receipt
  facts = { ...facts, mainSha: issued.mainSha ?? live.mainSha }
} catch (error) {
  if (requireLedger) {
    console.error(`FAILED_AUTHORITY_NOT_GRANTED: ledger issuance was required and did not succeed.\n  ${error.message}`)
    process.exit(1)
  }
  provenance = "local"
  // Measured facts overwrite claimed ones. The lane supplies only what a machine cannot check for it.
  const verdict = issueWorkContextReceipt(facts)
  if (!verdict.ok) {
    console.error(`${verdict.failure}: ${verdict.detail}`)
    process.exit(1)
  }
  receipt = verdict.receipt
  console.warn(`cockpit issuance unavailable, falling back to LOCAL provenance:\n  ${error.message}\n`)
}

fs.mkdirSync(path.dirname(RECEIPT_PATH), { recursive: true })
fs.writeFileSync(RECEIPT_PATH, `${JSON.stringify({ receipt, provenance, cockpit, facts }, null, 2)}\n`)

console.log(`work context established -> ${path.relative(PROJECT_ROOT, RECEIPT_PATH)}`)
console.log(`  provenance ${provenance}${provenance === "local" ? "  (authority NOT checked, claim NOT recorded)" : "  (authority checked, claim recorded)"}`)
console.log(`  receipt    ${receipt}`)
console.log(`  main       ${live.mainSha}`)
console.log(`  doctrine   ${live.doctrineDigest.slice(0, 16)}...${live.missingDoctrine.length ? ` (missing: ${live.missingDoctrine.join(", ")})` : ""}`)
console.log(`  reserved   ${facts.reservedPaths.join(", ")}`)
console.log("\nThis receipt stops matching the moment main or doctrine moves. That is intended.")
