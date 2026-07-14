#!/usr/bin/env node
import fs from "node:fs"

import {
  appendEvidenceEvent,
  deriveOwnerTouchMeter,
  verifyEvidenceLedger,
} from "./evidence-ledger.mjs"

const [command, ledgerDir, ledgerId, inputPath, leaseBindingPath, ...rest] = process.argv.slice(2)

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null }
}

function usage() {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_EVIDENCE_LEDGER_CLI_RESULT",
    ok: false,
    status: "EVIDENCE_LEDGER_CLI_USAGE_WALL",
    localFilesOnly: true,
    authorityGranted: false,
  }
}

let result
if (rest.length > 0 || !["append", "verify", "meter"].includes(command) || !ledgerDir || !ledgerId || !inputPath
  || (command === "append" ? !leaseBindingPath : leaseBindingPath !== undefined)) {
  result = usage()
} else {
  const input = readJson(inputPath)
  if (input === null) {
    result = { ...usage(), status: "EVIDENCE_LEDGER_CLI_INPUT_WALL" }
  } else if (command === "append") {
    const binding = readJson(leaseBindingPath)
    if (binding === null || Object.keys(binding).sort().join(",") !== "leaseStoreId,leaseStorePath") {
      result = { ...usage(), status: "EVIDENCE_LEDGER_CLI_INPUT_WALL" }
    } else {
      result = appendEvidenceEvent(ledgerDir, ledgerId, input, binding)
    }
  } else {
    result = command === "verify"
      ? verifyEvidenceLedger(ledgerDir, ledgerId, input)
      : deriveOwnerTouchMeter(ledgerDir, ledgerId, input)
  }
}

process.stdout.write(`${JSON.stringify(result)}\n`)
process.exitCode = result.ok ? 0 : 2
