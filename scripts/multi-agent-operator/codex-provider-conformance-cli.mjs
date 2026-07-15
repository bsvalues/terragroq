#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  CodexProviderConformanceError,
  canonicalCodexProviderConformanceJson,
  evaluateCodexSessionCoordination,
  validateCodexProviderConformance,
} from "./codex-provider-conformance.mjs"

function output(value) {
  process.stdout.write(`${canonicalCodexProviderConformanceJson(value)}\n`)
}

try {
  if (process.argv.length !== 4) {
    throw new CodexProviderConformanceError("CODEX_CONFORMANCE_CLI_WALL", "argv", "OPERATION_AND_JSON_REQUIRED")
  }
  let input
  try {
    input = JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
  } catch {
    throw new CodexProviderConformanceError("CODEX_CONFORMANCE_INPUT_WALL", "file", "READABLE_JSON_REQUIRED")
  }
  if (process.argv[2] === "validate") output(validateCodexProviderConformance(input))
  else if (process.argv[2] === "coordinate") output(evaluateCodexSessionCoordination(input))
  else throw new CodexProviderConformanceError("CODEX_CONFORMANCE_CLI_WALL", "operation", "VALIDATE_OR_COORDINATE_REQUIRED")
} catch (error) {
  const typed = error instanceof CodexProviderConformanceError
    ? error
    : new CodexProviderConformanceError("CODEX_CONFORMANCE_ASSERTION_WALL", "internal")
  output({ ok: false, code: typed.code, field: typed.field, detail: typed.detail })
  process.exitCode = 2
}
