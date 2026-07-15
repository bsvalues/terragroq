#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  EligibleSetSchedulerError,
  canonicalSchedulerJson,
  inspectSchedulerState,
  reapAmbiguousOutcomes,
  recoverSchedulerTransactions,
  recordProviderOutcome,
  scheduleEligibleSet,
} from "./eligible-set-scheduler.mjs"

function output(value) { process.stdout.write(`${canonicalSchedulerJson(value)}\n`) }

try {
  if (process.argv.length !== 5) wall("SCHEDULER_CLI_WALL", "argv", "OPERATION_CONFIG_INPUT_REQUIRED")
  let configuration
  let input
  try {
    const raw = JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
    input = JSON.parse(fs.readFileSync(process.argv[4], "utf8"))
    configuration = {
      statePath: raw.statePath,
      stateId: raw.stateId,
      trustBundleReference: raw.trustBundleReference,
      reservationLedgerPath: raw.reservationLedgerPath,
      reservationLedgerId: raw.reservationLedgerId,
      leaseStorePath: raw.leaseStorePath,
      leaseStoreId: raw.leaseStoreId,
      evidenceLedgerDir: raw.evidenceLedgerDir,
      evidenceLedgerId: raw.evidenceLedgerId,
      leaseTokenKey: raw.leaseTokenKey,
      leaseDurationMs: raw.leaseDurationMs,
      reconciliationBatchCeiling: raw.reconciliationBatchCeiling,
      now: () => raw.now,
      lockTimeoutMs: raw.lockTimeoutMs,
    }
  } catch { wall("SCHEDULER_INPUT_WALL", "file", "READABLE_JSON_REQUIRED") }
  if (process.argv[2] === "schedule") output(scheduleEligibleSet(configuration, input))
  else if (process.argv[2] === "outcome") output(recordProviderOutcome(configuration, input))
  else if (process.argv[2] === "reap") output(reapAmbiguousOutcomes(configuration, input))
  else if (process.argv[2] === "recover") output(recoverSchedulerTransactions(configuration))
  else if (process.argv[2] === "inspect") output(inspectSchedulerState(configuration.statePath, configuration.stateId))
  else wall("SCHEDULER_CLI_WALL", "operation", "SCHEDULE_OUTCOME_REAP_RECOVER_OR_INSPECT_REQUIRED")
} catch (error) {
  const typed = error instanceof EligibleSetSchedulerError
    ? error
    : new EligibleSetSchedulerError("SCHEDULER_ASSERTION_WALL", "internal")
  output({ ok: false, code: typed.code, field: typed.field, detail: typed.detail })
  process.exitCode = 2
}

function wall(code, field, detail) { throw new EligibleSetSchedulerError(code, field, detail) }
