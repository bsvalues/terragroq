#!/usr/bin/env node

import {
  canonicalProviderConformanceSuiteJson,
  ProviderConformanceSuiteError,
  runCanonicalProviderConformanceSuite,
} from "./provider-conformance-suite.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "PROVIDER_CONFORMANCE_SUITE_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    dispatchPerformed: false,
    providerCallPerformed: false,
    executableWorkerCertified: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
    secretsExposed: false,
    ownerRelayRequired: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("PROVIDER_CONFORMANCE_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalProviderConformanceSuite() }
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
