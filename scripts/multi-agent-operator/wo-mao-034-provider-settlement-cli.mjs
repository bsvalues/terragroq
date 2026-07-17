#!/usr/bin/env node

import {
  WoMao034ProviderSettlementError,
  runWoMao034ProviderSettlement,
} from "./wo-mao-034-provider-settlement.mjs"

const failure = (code) => ({
  ok: false,
  code,
  dispatchPerformed: false,
  providerContractDispatchAllowed: false,
  runtimeActivationAllowed: false,
  authorityGranted: false,
  secretsExposed: false,
  ownerRelayRequired: false,
})

if (process.argv.length !== 2) {
  process.stdout.write(`${JSON.stringify(failure("WO_MAO_034_CLI_ARGUMENT_WALL"))}\n`)
  process.exitCode = 2
} else {
  try {
    process.stdout.write(`${JSON.stringify({ ok: true, ...runWoMao034ProviderSettlement() })}\n`)
  } catch (error) {
    const code = error instanceof WoMao034ProviderSettlementError
      ? error.code
      : typeof error?.code === "string"
        ? error.code
        : "WO_MAO_034_PROVIDER_SETTLEMENT_WALL"
    process.stdout.write(`${JSON.stringify(failure(code))}\n`)
    process.exitCode = 2
  }
}
