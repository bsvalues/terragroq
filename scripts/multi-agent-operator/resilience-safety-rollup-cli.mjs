#!/usr/bin/env node
import {
  canonicalResilienceSafetyRollupJson,
  loadCanonicalResilienceSafetyRollup,
  runCanonicalResilienceSafetyRollup,
  verifyCanonicalResilienceSafetyRollup,
} from "./resilience-safety-rollup.mjs"

const command = process.argv[2] ?? "run"

if (command === "plan") {
  process.stdout.write(`${canonicalResilienceSafetyRollupJson(loadCanonicalResilienceSafetyRollup())}\n`)
} else if (command === "verify") {
  process.stdout.write(`${canonicalResilienceSafetyRollupJson(verifyCanonicalResilienceSafetyRollup())}\n`)
} else if (command === "run") {
  process.stdout.write(`${canonicalResilienceSafetyRollupJson(runCanonicalResilienceSafetyRollup())}\n`)
} else {
  throw new Error(`UNKNOWN_RESILIENCE_SAFETY_ROLLUP_COMMAND:${command}`)
}
