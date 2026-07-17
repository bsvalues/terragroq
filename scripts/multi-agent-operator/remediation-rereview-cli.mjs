#!/usr/bin/env node

import {
  canonicalRemediationRereviewJson,
  RemediationRereviewError,
  runCanonicalRemediationRereview,
} from "./remediation-rereview.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "REMEDIATION_REREVIEW_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    githubApiCalled: false,
    remediationApplied: false,
    validationRerunPerformed: false,
    reviewRequested: false,
    reviewThreadResolved: false,
    mergePerformed: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("REMEDIATION_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalRemediationRereview() }
  } catch (error) {
    result = error instanceof RemediationRereviewError
      ? failure(error.code, error.field, error.detail)
      : failure("REMEDIATION_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalRemediationRereviewJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
