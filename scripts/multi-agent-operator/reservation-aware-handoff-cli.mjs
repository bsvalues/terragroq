#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  ReservationAwareHandoffError,
  applyReservationAwareHandoff,
  canonicalReservationAwareHandoffJson,
  inspectReservationAwareHandoffStore,
  planReservationAwareHandoff,
} from "./reservation-aware-handoff.mjs"
import { createReservationAwareHandoffHostVerifier } from "./reservation-aware-handoff-host.mjs"

function emit(value) {
  process.stdout.write(`${canonicalReservationAwareHandoffJson(value)}\n`)
}

try {
  const [operation, first, second, third] = process.argv.slice(2)
  if (operation === "inspect" && first && second && process.argv.length === 5) {
    emit({ ok: true, ...inspectReservationAwareHandoffStore(first, second) })
  } else if (operation === "plan" && first && !second) {
    let input
    try { input = JSON.parse(fs.readFileSync(first, "utf8")) } catch {
      throw new ReservationAwareHandoffError("HANDOFF_INPUT_WALL", "file", "READABLE_JSON_REQUIRED")
    }
    emit({ ok: true, ...planReservationAwareHandoff(input) })
  } else if (operation === "apply" && first && second && third && process.argv.length === 6) {
    const inputFile = operation === "plan" ? first : second
    const storePath = operation === "apply" ? first : null
    let input, hostConfiguration
    try {
      input = JSON.parse(fs.readFileSync(inputFile, "utf8"))
      hostConfiguration = JSON.parse(fs.readFileSync(third, "utf8"))
    } catch {
      throw new ReservationAwareHandoffError("HANDOFF_INPUT_WALL", "file", "READABLE_JSON_REQUIRED")
    }
    const trustedContext = createReservationAwareHandoffHostVerifier(hostConfiguration)
    emit({ ok: true, ...applyReservationAwareHandoff(storePath, input, trustedContext) })
  } else {
    throw new ReservationAwareHandoffError("HANDOFF_CLI_WALL", "argv", "PLAN_INPUT_OR_APPLY_STORE_INPUT_HOST_CONFIG_OR_INSPECT_STORE_ID_REQUIRED")
  }
} catch (error) {
  const typed = error instanceof ReservationAwareHandoffError
    ? error
    : new ReservationAwareHandoffError("HANDOFF_ASSERTION_WALL", "internal")
  emit({ ok: false, code: typed.code, field: typed.field, detail: typed.detail ?? null,
    persistencePerformed: false, reservationReleased: false, leaseReleased: false,
    secondWriterEnabled: false, authorityGranted: false, ownerOperationsRequired: false })
  process.exitCode = 2
}
