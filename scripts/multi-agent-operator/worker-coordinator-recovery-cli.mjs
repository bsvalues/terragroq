#!/usr/bin/env node

import {
  canonicalWorkerCoordinatorRecoveryJson,
  runCanonicalWorkerCoordinatorRecovery,
  WorkerCoordinatorRecoveryError,
} from "./worker-coordinator-recovery.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "WORKER_COORDINATOR_RECOVERY_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    githubWritePerformed: false,
    processControlPerformed: false,
    concurrentWritersAllowed: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("WORKER_COORDINATOR_RECOVERY_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalWorkerCoordinatorRecovery() }
  } catch (error) {
    result = error instanceof WorkerCoordinatorRecoveryError
      ? failure(error.code, error.field, error.detail)
      : failure("WORKER_COORDINATOR_RECOVERY_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalWorkerCoordinatorRecoveryJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
