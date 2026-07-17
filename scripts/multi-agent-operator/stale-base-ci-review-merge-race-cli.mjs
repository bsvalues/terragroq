#!/usr/bin/env node

import {
  canonicalStaleBaseCiReviewMergeRaceJson,
  runCanonicalStaleBaseCiReviewMergeRace,
  StaleBaseCiReviewMergeRaceError,
} from "./stale-base-ci-review-merge-race.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "STALE_BASE_CI_REVIEW_MERGE_RACE_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    rebasePerformed: false,
    ciRerunPerformed: false,
    mergePerformed: false,
    stateMutationPerformed: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("MERGE_RACE_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalStaleBaseCiReviewMergeRace() }
  } catch (error) {
    result = error instanceof StaleBaseCiReviewMergeRaceError
      ? failure(error.code, error.field, error.detail)
      : failure("MERGE_RACE_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalStaleBaseCiReviewMergeRaceJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
