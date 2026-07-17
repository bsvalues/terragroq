#!/usr/bin/env node

import {
  BoundedMergeControllerError,
  canonicalBoundedMergeControllerJson,
  runCanonicalBoundedMergeController,
} from "./bounded-merge-controller.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "BOUNDED_MERGE_CONTROLLER_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    githubApiCalled: false,
    mergePerformed: false,
    branchProtectionBypassed: false,
    securityThreadDismissed: false,
    authorityThreadDismissed: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("MERGE_CONTROLLER_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalBoundedMergeController() }
  } catch (error) {
    result = error instanceof BoundedMergeControllerError
      ? failure(error.code, error.field, error.detail)
      : failure("MERGE_CONTROLLER_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalBoundedMergeControllerJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
