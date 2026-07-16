#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  CodexCoordinatorAdapterError,
  adaptCodexCoordinatorPlan,
  canonicalCodexCoordinatorAdapterJson,
} from "./codex-coordinator-adapter.mjs"

function output(value) {
  process.stdout.write(`${canonicalCodexCoordinatorAdapterJson(value)}\n`)
}

try {
  if (process.argv.length !== 3) {
    throw new CodexCoordinatorAdapterError("CODEX_COORDINATOR_CLI_WALL", "argv", "JSON_REQUIRED")
  }
  let input
  try {
    input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
  } catch {
    throw new CodexCoordinatorAdapterError("CODEX_COORDINATOR_INPUT_WALL", "file", "READABLE_JSON_REQUIRED")
  }
  output(adaptCodexCoordinatorPlan(input))
} catch (error) {
  const typed = error instanceof CodexCoordinatorAdapterError
    ? error
    : new CodexCoordinatorAdapterError("CODEX_COORDINATOR_ASSERTION_WALL", "internal")
  output({ ok: false, code: typed.code, field: typed.field, detail: typed.detail })
  process.exitCode = 2
}
