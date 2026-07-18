#!/usr/bin/env node
import {
  MergeVerifyCleanFanInReleaseError,
  runCanonicalMergeVerifyCleanFanInRelease,
  verifyCanonicalMergeVerifyCleanFanInRelease,
} from "./merge-verify-clean-fanin-release.mjs"

if (process.argv.length > 2) {
  throw new MergeVerifyCleanFanInReleaseError(
    "FANIN_RELEASE_CLI_ARGUMENT_WALL",
    "argv",
    "ZERO_INPUT_CLI_REJECTS_CALLER_SUPPLIED_ARGUMENTS",
  )
}

verifyCanonicalMergeVerifyCleanFanInRelease()
process.stdout.write(`${JSON.stringify(runCanonicalMergeVerifyCleanFanInRelease(), null, 2)}\n`)
