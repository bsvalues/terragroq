#!/usr/bin/env node
import fs from "node:fs"

import {
  canonicalCrossProviderRoutingReviewJson,
  CrossProviderRoutingReviewError,
  evaluateCrossProviderRoutingReview,
} from "./cross-provider-routing-review.mjs"

const [inputPath, ...extra] = process.argv.slice(2)

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "CROSS_PROVIDER_ROUTING_REVIEW_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    dispatchPerformed: false,
    authorityGranted: false,
  }
}

let result
if (!inputPath || extra.length > 0) {
  result = failure("CROSS_PROVIDER_CLI_USAGE_WALL", "inputPath")
} else {
  try {
    result = evaluateCrossProviderRoutingReview(JSON.parse(fs.readFileSync(inputPath, "utf8")))
  } catch (error) {
    if (error instanceof CrossProviderRoutingReviewError) {
      result = failure(error.code, error.field, error.detail)
    } else {
      result = failure("CROSS_PROVIDER_CLI_INPUT_WALL", "input")
    }
  }
}

process.stdout.write(`${canonicalCrossProviderRoutingReviewJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
