#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  WorkOrderEnvelopeV2Error,
  canonicalWorkOrderEnvelopeV2Json,
  validateWorkOrderEnvelopeV2,
} from "./work-order-envelope-v2.mjs"

function output(value) {
  process.stdout.write(`${canonicalWorkOrderEnvelopeV2Json(value)}\n`)
}

try {
  if (process.argv.length !== 3) {
    throw new WorkOrderEnvelopeV2Error("WORK_ORDER_ENVELOPE_CLI_WALL", "argv", "ONE_JSON_FILE_REQUIRED")
  }
  let input
  try {
    input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
  } catch {
    throw new WorkOrderEnvelopeV2Error("WORK_ORDER_ENVELOPE_INPUT_WALL", "file", "READABLE_JSON_REQUIRED")
  }
  output(validateWorkOrderEnvelopeV2(input))
} catch (error) {
  const typed = error instanceof WorkOrderEnvelopeV2Error
    ? error
    : new WorkOrderEnvelopeV2Error("WORK_ORDER_ENVELOPE_ASSERTION_WALL", "internal")
  output({ ok: false, code: typed.code, field: typed.field, detail: typed.detail ?? null })
  process.exitCode = 2
}
