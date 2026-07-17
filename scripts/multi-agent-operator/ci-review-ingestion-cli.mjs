#!/usr/bin/env node

import {
  canonicalCiReviewIngestionJson,
  CiReviewIngestionError,
  runCanonicalCiReviewIngestion,
} from "./ci-review-ingestion.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "CI_REVIEW_INGESTION_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    githubApiCalled: false,
    checkRerunPerformed: false,
    reviewThreadResolved: false,
    remediationPerformed: false,
    mergePerformed: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("CI_REVIEW_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalCiReviewIngestion() }
  } catch (error) {
    result = error instanceof CiReviewIngestionError
      ? failure(error.code, error.field, error.detail)
      : failure("CI_REVIEW_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalCiReviewIngestionJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
