#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  canonicalWorkOrderEnvelopeV2Json,
} from "./work-order-envelope-v2.mjs"
import {
  DagEligibleResolverError,
  resolveDagEligibleSet,
} from "./dag-eligible-resolver.mjs"

function output(value) {
  process.stdout.write(`${canonicalWorkOrderEnvelopeV2Json(value)}\n`)
}

try {
  if (process.argv.length !== 3) {
    throw new DagEligibleResolverError("DAG_ELIGIBILITY_CLI_WALL", "argv", "ONE_JSON_FILE_REQUIRED")
  }
  let input
  try {
    input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
  } catch {
    throw new DagEligibleResolverError("DAG_ELIGIBILITY_INPUT_WALL", "file", "READABLE_JSON_REQUIRED")
  }
  output(resolveDagEligibleSet(input))
} catch (error) {
  const typed = error instanceof DagEligibleResolverError
    ? error
    : new DagEligibleResolverError("DAG_ELIGIBILITY_ASSERTION_WALL", "internal")
  output({ ok: false, code: typed.code, field: typed.field, detail: typed.detail ?? null })
  process.exitCode = 2
}
