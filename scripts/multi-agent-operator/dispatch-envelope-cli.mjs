#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  DispatchEnvelopeError,
  canonicalDispatchEnvelopeJson,
  validateDispatchEnvelope,
} from "./dispatch-envelope.mjs"

function resultJson(result) {
  return `${canonicalDispatchEnvelopeJson(result)}\n`
}
try {
  if (process.argv.length !== 3) {
    throw new DispatchEnvelopeError("DISPATCH_ENVELOPE_CLI_WALL", "argv", "ONE_JSON_FILE_REQUIRED")
  }
  let input
  try {
    input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
  } catch {
    throw new DispatchEnvelopeError("DISPATCH_ENVELOPE_INPUT_WALL", "file", "READABLE_JSON_REQUIRED")
  }
  process.stdout.write(resultJson(validateDispatchEnvelope(input)))
} catch (error) {
  const typed = error instanceof DispatchEnvelopeError
    ? error
    : new DispatchEnvelopeError("DISPATCH_ENVELOPE_ASSERTION_WALL", "internal")
  process.stdout.write(resultJson({
    ok: false,
    code: typed.code,
    field: typed.field,
    detail: typed.detail ?? null,
  }))
  process.exitCode = 2
}
