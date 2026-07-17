#!/usr/bin/env node
import {
  canonicalProviderOutageFailoverDrillJson,
  ProviderOutageFailoverDrillError,
  runCanonicalProviderOutageFailoverDrill,
} from "./provider-outage-failover-drill.mjs"

function failure(code, field, detail = undefined) {
  return {
    ok: false,
    code,
    field,
    detail,
    schedulerAdded: false,
    providerExecutionPerformed: false,
    networkInjectionPerformed: false,
    githubApiCalled: false,
    stateMutationPerformed: false,
    ownerDiagnosticsRequired: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("PROVIDER_OUTAGE_CLI_ARGUMENT_WALL", "argv", "ZERO_INPUT_CLI_REQUIRED")
} else {
  try {
    const output = runCanonicalProviderOutageFailoverDrill()
    result = {
      ok: true,
      status: output.status,
      workOrderId: output.workOrderId,
      resultHash: output.resultHash,
      schedulerAdded: output.schedulerAdded,
      providerExecutionPerformed: output.providerExecutionPerformed,
      networkInjectionPerformed: output.networkInjectionPerformed,
      githubApiCalled: output.githubApiCalled,
      stateMutationPerformed: output.stateMutationPerformed,
      ownerDiagnosticsRequired: output.ownerDiagnosticsRequired,
      authorityGranted: output.authorityGranted,
    }
  } catch (error) {
    result = error instanceof ProviderOutageFailoverDrillError
      ? failure(error.code, error.field, error.detail)
      : failure("PROVIDER_OUTAGE_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalProviderOutageFailoverDrillJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
