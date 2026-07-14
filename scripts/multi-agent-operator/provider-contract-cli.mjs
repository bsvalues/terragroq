#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import {
  ProviderContractError,
  canonicalProviderContractJson,
  evaluateProviderDispatch,
  normalizeProviderCapability,
  validateProviderResponse,
} from "./provider-contract.mjs"

function output(value) {
  process.stdout.write(`${canonicalProviderContractJson(value)}\n`)
}

try {
  if (process.argv.length !== 4) throw new ProviderContractError("PROVIDER_CONTRACT_CLI_WALL", "argv", "OPERATION_AND_JSON_REQUIRED")
  const operation = process.argv[2]
  let input
  try {
    input = JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
  } catch {
    throw new ProviderContractError("PROVIDER_CONTRACT_INPUT_WALL", "file", "READABLE_JSON_REQUIRED")
  }
  if (operation === "capability") output(normalizeProviderCapability(input))
  else if (operation === "dispatch") output(evaluateProviderDispatch(input))
  else if (operation === "response") output(validateProviderResponse(input))
  else throw new ProviderContractError("PROVIDER_CONTRACT_CLI_WALL", "operation", "CAPABILITY_DISPATCH_OR_RESPONSE_REQUIRED")
} catch (error) {
  const typed = error instanceof ProviderContractError
    ? error
    : new ProviderContractError("PROVIDER_CONTRACT_ASSERTION_WALL", "internal")
  output({ ok: false, code: typed.code, field: typed.field, detail: typed.detail })
  process.exitCode = 2
}
