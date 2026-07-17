#!/usr/bin/env node

import {
  BranchCommitPushAutomationError,
  canonicalBranchCommitPushAutomationJson,
  runCanonicalBranchCommitPushAutomation,
} from "./branch-commit-push-automation.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "BRANCH_COMMIT_PUSH_AUTOMATION_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    gitCommandPerformed: false,
    branchCreated: false,
    commitCreated: false,
    pushed: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("GIT_LIFECYCLE_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalBranchCommitPushAutomation() }
  } catch (error) {
    result = error instanceof BranchCommitPushAutomationError
      ? failure(error.code, error.field, error.detail)
      : failure("GIT_LIFECYCLE_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalBranchCommitPushAutomationJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
