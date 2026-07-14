#!/usr/bin/env node
import fs from "node:fs"
import process from "node:process"

import {
  acquireReservations,
  inspectReservationLedger,
  releaseReservations,
} from "./reservation-ledger.mjs"

function cliWall(status) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_LEDGER_RESULT",
    status,
    acquired: false,
    released: false,
    reasonCodes: [status],
    localLedgerOnly: true,
    authorityGranted: false,
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null }
}

const [command, ledgerPath, ledgerId, requestPath, ...rest] = process.argv.slice(2)
let output
if (rest.length > 0 || !["acquire", "release", "inspect"].includes(command)
  || !ledgerPath || !ledgerId || (command !== "inspect" && !requestPath)
  || (command === "inspect" && requestPath)) {
  output = cliWall("RESERVATION_LEDGER_CLI_USAGE_WALL")
  process.exitCode = 2
} else if (command === "inspect") {
  output = inspectReservationLedger(ledgerPath, ledgerId, {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST",
  })
} else {
  const request = readJson(requestPath)
  if (request === null) {
    output = cliWall("RESERVATION_LEDGER_INPUT_WALL")
    process.exitCode = 2
  } else {
    output = command === "acquire"
      ? acquireReservations(ledgerPath, ledgerId, request)
      : releaseReservations(ledgerPath, ledgerId, request)
  }
}

if (!process.exitCode) {
  if (["RESERVATION_COLLISION", "RESERVATION_LEDGER_VERSION_CONFLICT"].includes(output.status)) {
    process.exitCode = 3
  } else if (!(output.acquired || output.released || output.valid)) {
    process.exitCode = 2
  }
}

process.stdout.write(`${JSON.stringify(output)}\n`)
