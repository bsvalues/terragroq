#!/usr/bin/env node

import {
  canonicalProviderHealthRerouteJson,
  ProviderHealthRerouteError,
  runCanonicalProviderHealthReroute,
} from "./provider-health-reroute.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "PROVIDER_HEALTH_REROUTE_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    dispatchPerformed: false,
    providerCallPerformed: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
    secretsExposed: false,
    ownerRelayRequired: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("PROVIDER_HEALTH_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalProviderHealthReroute() }
  } catch (error) {
    if (error instanceof ProviderHealthRerouteError) {
      result = failure(error.code, error.field, error.detail)
    } else {
      result = failure("PROVIDER_HEALTH_CLI_INPUT_WALL", "input")
    }
  }
}

process.stdout.write(`${canonicalProviderHealthRerouteJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
