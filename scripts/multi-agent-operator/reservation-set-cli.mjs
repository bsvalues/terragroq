#!/usr/bin/env node
import fs from "node:fs"
import process from "node:process"

import { checkReservationCompatibility } from "./reservation-set.mjs"

function result(status, detail = {}) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_COMPATIBILITY_RESULT",
    status,
    compatible: false,
    reasonCodes: [status],
    ...detail,
    effect: "PRE_DISPATCH_CHECK_ONLY",
    ledgerClaimed: false,
    authorityGranted: false,
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

const args = process.argv.slice(2)
let output
if (args.length !== 2) {
  output = result("RESERVATION_SET_CLI_USAGE_WALL")
  process.exitCode = 2
} else {
  const left = readJson(args[0])
  const right = readJson(args[1])
  if (left === null || right === null) {
    output = result("RESERVATION_SET_INPUT_WALL")
    process.exitCode = 2
  } else {
    output = checkReservationCompatibility(left, right)
    process.exitCode = output.status === "COMPATIBLE" ? 0 : output.status === "CONFLICT" ? 3 : 2
  }
}

process.stdout.write(`${JSON.stringify(output)}\n`)
