#!/usr/bin/env node
import fs from "node:fs"

import {
  canonicalProviderConformanceSuiteJson,
  evaluateProviderConformanceSuite,
  ProviderConformanceSuiteError,
} from "./provider-conformance-suite.mjs"

const [inputPath, ...extra] = process.argv.slice(2)

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "PROVIDER_CONFORMANCE_SUITE_CLI_RESULT",
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
  result = failure("PROVIDER_CONFORMANCE_CLI_USAGE_WALL", "inputPath")
} else {
  try {
    result = evaluateProviderConformanceSuite(JSON.parse(fs.readFileSync(inputPath, "utf8")))
  } catch (error) {
    if (error instanceof ProviderConformanceSuiteError) {
      result = failure(error.code, error.field, error.detail)
    } else {
      result = failure("PROVIDER_CONFORMANCE_CLI_INPUT_WALL", "input")
    }
  }
}

process.stdout.write(`${canonicalProviderConformanceSuiteJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
