#!/usr/bin/env node
import {
  canonicalMaliciousDefectiveWorkerDrillJson,
  MaliciousDefectiveWorkerDrillError,
  runCanonicalMaliciousDefectiveWorkerDrill,
} from "./malicious-defective-worker-drill.mjs"

function failure(code, field, detail = undefined) {
  return {
    ok: false,
    code,
    field,
    detail,
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    stateMutationPerformed: false,
    secretMaterialAllowed: false,
    unsafeCleanupAllowed: false,
    policyOverrideAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("DEFECTIVE_WORKER_CLI_ARGUMENT_WALL", "argv", "ZERO_INPUT_CLI_REQUIRED")
} else {
  try {
    const output = runCanonicalMaliciousDefectiveWorkerDrill()
    result = {
      ok: true,
      status: output.status,
      workOrderId: output.workOrderId,
      resultHash: output.resultHash,
      schedulerAdded: output.schedulerAdded,
      providerExecutionPerformed: output.providerExecutionPerformed,
      githubApiCalled: output.githubApiCalled,
      stateMutationPerformed: output.stateMutationPerformed,
      secretMaterialAllowed: output.secretMaterialAllowed,
      unsafeCleanupAllowed: output.unsafeCleanupAllowed,
      policyOverrideAllowed: output.policyOverrideAllowed,
      ownerOperationRequired: output.ownerOperationRequired,
      authorityGranted: output.authorityGranted,
    }
  } catch (error) {
    result = error instanceof MaliciousDefectiveWorkerDrillError
      ? failure(error.code, error.field, error.detail)
      : failure("DEFECTIVE_WORKER_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalMaliciousDefectiveWorkerDrillJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
