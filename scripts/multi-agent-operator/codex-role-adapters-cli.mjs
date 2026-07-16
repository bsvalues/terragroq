#!/usr/bin/env node
import fs from "node:fs"

import {
  adaptCodexRoleLifecycle,
  canonicalCodexRoleAdapterJson,
  CodexRoleAdapterError,
} from "./codex-role-adapters.mjs"

const [inputPath, ...extra] = process.argv.slice(2)

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "CODEX_ROLE_ADAPTER_CLI_RESULT",
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
  result = failure("CODEX_ROLE_CLI_USAGE_WALL", "inputPath")
} else {
  try {
    result = adaptCodexRoleLifecycle(JSON.parse(fs.readFileSync(inputPath, "utf8")))
  } catch (error) {
    if (error instanceof CodexRoleAdapterError) {
      result = failure(error.code, error.field, error.detail)
    } else {
      result = failure("CODEX_ROLE_CLI_INPUT_WALL", "input")
    }
  }
}

process.stdout.write(`${canonicalCodexRoleAdapterJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
