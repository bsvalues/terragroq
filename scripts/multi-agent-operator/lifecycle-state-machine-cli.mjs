#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  LifecycleStateError,
  classifyLifecycleFailure,
  transitionLifecycle,
} from "./lifecycle-state-machine.mjs"

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}

function output(value) {
  process.stdout.write(`${JSON.stringify(canonical(value))}\n`)
}

try {
  if (process.argv.length !== 4) throw new LifecycleStateError("LIFECYCLE_CLI_WALL", "argv", "OPERATION_AND_JSON_REQUIRED")
  let input
  try {
    input = JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
  } catch {
    throw new LifecycleStateError("LIFECYCLE_INPUT_WALL", "file", "READABLE_JSON_REQUIRED")
  }
  if (process.argv[2] === "transition") output(transitionLifecycle(input))
  else if (process.argv[2] === "classify") output(classifyLifecycleFailure(input))
  else throw new LifecycleStateError("LIFECYCLE_CLI_WALL", "operation", "TRANSITION_OR_CLASSIFY_REQUIRED")
} catch (error) {
  const typed = error instanceof LifecycleStateError
    ? error
    : new LifecycleStateError("LIFECYCLE_ASSERTION_WALL", "internal")
  output({ ok: false, code: typed.code, field: typed.field, detail: typed.detail })
  process.exitCode = 2
}
