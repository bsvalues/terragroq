#!/usr/bin/env node

import {
  canonicalCrossProviderRoutingReviewJson,
  CrossProviderRoutingReviewError,
  runCanonicalCrossProviderRoutingReview,
} from "./cross-provider-routing-review.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "CROSS_PROVIDER_ROUTING_REVIEW_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    providerContractDispatchAllowed: false,
    dispatchPerformed: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
    secretsExposed: false,
    ownerRelayRequired: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("CROSS_PROVIDER_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalCrossProviderRoutingReview() }
  } catch (error) {
    result = error instanceof CrossProviderRoutingReviewError
      ? failure(error.code, error.field, error.detail)
      : failure(typeof error?.code === "string" ? error.code : "CROSS_PROVIDER_CANONICAL_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalCrossProviderRoutingReviewJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
