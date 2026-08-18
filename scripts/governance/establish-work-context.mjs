#!/usr/bin/env node
import fs from "node:fs"
import { register } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Establish this lane's work context and write the receipt the PreToolUse hook checks.
 *
 * A gate with no usable way through it is not a gate, it is a brick -- and a bricked gate gets
 * disabled, which is worse than no gate at all. This is the remedy the hook's refusal points at.
 *
 * It measures what the lane is not allowed to assert about itself (current origin/main, the doctrine
 * digest) and refuses to issue anything when a premise is blank, because a receipt obtainable by
 * supplying blanks is a rubber stamp.
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
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === "--reserve") facts.reservedPaths.push(argv[++i])
    else if (flag === "--collision") facts.collisions.push(argv[++i])
    else if (FLAGS[flag]) facts[FLAGS[flag]] = argv[++i]
    else {
      console.error(`unknown argument: ${flag}`)
      process.exit(2)
    }
  }
  return facts
}

const claimed = parseArgs(process.argv.slice(2))

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

const live = await measureLiveWorkContext()
if (!live) {
  console.error("FAILED_STALE_MAIN: current origin/main could not be measured (is the remote reachable?)")
  process.exit(1)
}

// Measured facts overwrite claimed ones. The lane supplies only what a machine cannot check for it.
const facts = { ...claimed, mainSha: live.mainSha, doctrineDigest: live.doctrineDigest }
const verdict = issueWorkContextReceipt(facts)
if (!verdict.ok) {
  console.error(`${verdict.failure}: ${verdict.detail}`)
  process.exit(1)
}

fs.mkdirSync(path.dirname(RECEIPT_PATH), { recursive: true })
fs.writeFileSync(RECEIPT_PATH, `${JSON.stringify({ receipt: verdict.receipt, facts }, null, 2)}\n`)

console.log(`work context established -> ${path.relative(PROJECT_ROOT, RECEIPT_PATH)}`)
console.log(`  receipt   ${verdict.receipt}`)
console.log(`  main      ${live.mainSha}`)
console.log(`  doctrine  ${live.doctrineDigest.slice(0, 16)}...${live.missingDoctrine.length ? ` (missing: ${live.missingDoctrine.join(", ")})` : ""}`)
console.log(`  reserved  ${facts.reservedPaths.join(", ")}`)
console.log("\nThis receipt stops matching the moment main or doctrine moves. That is intended.")
