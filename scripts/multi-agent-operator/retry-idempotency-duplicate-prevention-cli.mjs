#!/usr/bin/env node

import {
  canonicalRetryIdempotencyDuplicatePreventionJson,
  RetryIdempotencyDuplicatePreventionError,
  runCanonicalRetryIdempotencyDuplicatePrevention,
} from "./retry-idempotency-duplicate-prevention.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    stateMutationPerformed: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("RETRY_IDEMPOTENCY_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalRetryIdempotencyDuplicatePrevention() }
  } catch (error) {
    result = error instanceof RetryIdempotencyDuplicatePreventionError
      ? failure(error.code, error.field, error.detail)
      : failure("RETRY_IDEMPOTENCY_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalRetryIdempotencyDuplicatePreventionJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
