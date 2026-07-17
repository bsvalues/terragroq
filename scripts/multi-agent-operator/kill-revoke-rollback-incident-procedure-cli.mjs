#!/usr/bin/env node
import {
  canonicalKillRevokeRollbackIncidentProcedureJson,
  IncidentProcedureError,
  runCanonicalKillRevokeRollbackIncidentProcedure,
} from "./kill-revoke-rollback-incident-procedure.mjs"

function failure(code, field, detail = undefined) {
  return {
    ok: false,
    code,
    field,
    detail,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    revokeExecuted: false,
    rollbackExecuted: false,
    cleanupExecuted: false,
    stateMutationPerformed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("INCIDENT_PROCEDURE_CLI_ARGUMENT_WALL", "argv", "ZERO_INPUT_CLI_REQUIRED")
} else {
  try {
    const output = runCanonicalKillRevokeRollbackIncidentProcedure()
    result = {
      ok: true,
      status: output.status,
      workOrderId: output.workOrderId,
      resultHash: output.resultHash,
      providerExecutionPerformed: output.providerExecutionPerformed,
      githubApiCalled: output.githubApiCalled,
      revokeExecuted: output.revokeExecuted,
      rollbackExecuted: output.rollbackExecuted,
      cleanupExecuted: output.cleanupExecuted,
      stateMutationPerformed: output.stateMutationPerformed,
      ownerOperationRequired: output.ownerOperationRequired,
      authorityGranted: output.authorityGranted,
    }
  } catch (error) {
    result = error instanceof IncidentProcedureError
      ? failure(error.code, error.field, error.detail)
      : failure("INCIDENT_PROCEDURE_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalKillRevokeRollbackIncidentProcedureJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
