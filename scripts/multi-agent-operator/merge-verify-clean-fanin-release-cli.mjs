#!/usr/bin/env node
import {
  runCanonicalMergeVerifyCleanFanInRelease,
  verifyCanonicalMergeVerifyCleanFanInRelease,
} from "./merge-verify-clean-fanin-release.mjs"

verifyCanonicalMergeVerifyCleanFanInRelease()
process.stdout.write(`${JSON.stringify(runCanonicalMergeVerifyCleanFanInRelease(), null, 2)}\n`)
