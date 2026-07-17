#!/usr/bin/env node
import fs from "node:fs"

import {
  BranchCommitPushAutomationError,
  canonicalBranchCommitPushAutomationJson,
  evaluateBranchCommitPushAutomation,
} from "./branch-commit-push-automation.mjs"

const [inputPath, ...extra] = process.argv.slice(2)

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "BRANCH_COMMIT_PUSH_AUTOMATION_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    gitCommandPerformed: false,
    pushPerformed: false,
    authorityGranted: false,
  }
}

let result
if (!inputPath || extra.length > 0) {
  result = failure("BRANCH_PUSH_CLI_USAGE_WALL", "inputPath")
} else {
  try {
    result = evaluateBranchCommitPushAutomation(JSON.parse(fs.readFileSync(inputPath, "utf8")))
  } catch (error) {
    if (error instanceof BranchCommitPushAutomationError) {
      result = failure(error.code, error.field, error.detail)
    } else {
      result = failure("BRANCH_PUSH_CLI_INPUT_WALL", "input")
    }
  }
}

process.stdout.write(`${canonicalBranchCommitPushAutomationJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
