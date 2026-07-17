#!/usr/bin/env node
import {
  canonicalConcurrentCertificationLanesJson,
  loadCanonicalConcurrentCertificationLanes,
  runCanonicalConcurrentCertificationLanes,
  verifyCanonicalConcurrentCertificationLanes,
} from "./concurrent-certification-lanes.mjs"

const command = process.argv[2] ?? "run"

if (command === "plan") {
  process.stdout.write(`${canonicalConcurrentCertificationLanesJson(loadCanonicalConcurrentCertificationLanes())}\n`)
} else if (command === "verify") {
  process.stdout.write(`${canonicalConcurrentCertificationLanesJson(verifyCanonicalConcurrentCertificationLanes())}\n`)
} else if (command === "run") {
  process.stdout.write(`${canonicalConcurrentCertificationLanesJson(runCanonicalConcurrentCertificationLanes())}\n`)
} else {
  throw new Error(`UNKNOWN_CONCURRENT_CERTIFICATION_LANES_COMMAND:${command}`)
}
