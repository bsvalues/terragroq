#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

import { DEFAULT_COCKPIT, openDeviceSession, requestJson } from "./device-session.mjs"

/**
 * Ask the cockpit ledger to derive and record this lane's authority-bound work context.
 * Authority, reservation, versions, current main, and doctrine are never accepted as CLI input.
 */
const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()
const RECEIPT_PATH = path.join(PROJECT_ROOT, ".williamos", "work-context.json")
const FLAGS = {
  "--work-order": "workOrderRef",
  "--subsystem": "existingSubsystem",
  "--topology": "topologySource",
  "--remaining": "remainingParentAcceptance",
}

function parseArgs(argv) {
  const reconciliation = { collisions: [] }
  let cockpit = DEFAULT_COCKPIT
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === "--collision") reconciliation.collisions.push(argv[++i])
    else if (flag === "--cockpit") cockpit = argv[++i]
    else if (FLAGS[flag]) reconciliation[FLAGS[flag]] = argv[++i]
    else {
      console.error(`unknown or client-forbidden argument: ${flag}`)
      process.exit(2)
    }
  }
  return { reconciliation, cockpit }
}

const { reconciliation, cockpit } = parseArgs(process.argv.slice(2))
let issued
try {
  const session = await openDeviceSession({ baseUrl: cockpit, projectRoot: PROJECT_ROOT })
  const response = await requestJson(`${cockpit}/api/governance/work-context`, {
    method: "POST",
    body: reconciliation,
    cookie: session.cookie,
    origin: session.origin,
  })
  if (response.status !== 200 || !response.json?.receipt || !response.json?.facts) {
    const failure = response.json?.failure ?? response.json?.error ?? `HTTP_${response.status}`
    const detail = response.json?.detail ?? response.text.slice(0, 200)
    throw new Error(`${failure}: ${detail}`)
  }
  issued = response.json
} catch (error) {
  console.error(`FAILED_AUTHORITY_NOT_GRANTED: ledger issuance did not succeed.\n  ${error.message}`)
  process.exit(1)
}

const payload = { receipt: issued.receipt, provenance: "ledger", cockpit, facts: issued.facts }
fs.mkdirSync(path.dirname(RECEIPT_PATH), { recursive: true })
fs.writeFileSync(RECEIPT_PATH, `${JSON.stringify(payload, null, 2)}\n`)

console.log(`work context established -> ${path.relative(PROJECT_ROOT, RECEIPT_PATH)}`)
console.log("  provenance ledger  (authority and reservation server-derived; claim recorded)")
console.log(`  receipt    ${issued.receipt}`)
console.log(`  main       ${issued.facts.mainSha}`)
console.log(`  doctrine   ${issued.facts.doctrineDigest.slice(0, 16)}...${issued.missingDoctrine?.length ? ` (missing: ${issued.missingDoctrine.join(", ")})` : ""}`)
console.log(`  reserved   ${issued.facts.reservedPaths.join(", ")}`)
console.log("\nThis receipt stops matching when main, doctrine, the Work Order, grant, or reservation changes. That is intended.")
