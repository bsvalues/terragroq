#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  HostedCodexCoordinatorAdapterError,
  compileHostedCodexCoordinatorAdapter,
} from "./codex-coordinator-adapter.mjs"

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(canonical(value))}\n`)
}

try {
  if (process.argv.length !== 3) {
    throw new HostedCodexCoordinatorAdapterError("HOSTED_CODEX_CLI_WALL", "argv", "ONE_JSON_FILE_REQUIRED")
  }
  let input
  try {
    input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
  } catch {
    throw new HostedCodexCoordinatorAdapterError("HOSTED_CODEX_CLI_WALL", "file", "READABLE_JSON_REQUIRED")
  }
  emit({ ok: true, ...compileHostedCodexCoordinatorAdapter(input) })
} catch (error) {
  const typed = error instanceof HostedCodexCoordinatorAdapterError
    ? error
    : new HostedCodexCoordinatorAdapterError("HOSTED_CODEX_ASSERTION_WALL", "internal")
  emit({ ok: false, code: typed.code, field: typed.field, detail: typed.detail })
  process.exitCode = 2
}
