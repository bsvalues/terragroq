import fs from "node:fs"
import process from "node:process"

import {
  AuthorityAssertionError,
  assertLegacyAuthorityRevocations,
  assertOwnerAuthority,
} from "./authority-events.mjs"

function option(name, required = true) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (required && (!value || value.startsWith("--"))) throw new AuthorityAssertionError("AUTHORITY_CLI_WALL", name)
  return value
}

function readJson(name) {
  const path = option(name)
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"))
  } catch {
    throw new AuthorityAssertionError("AUTHORITY_INPUT_WALL", name)
  }
}

try {
  const command = process.argv[2]
  if (command === "validate-artifacts") {
    const result = assertOwnerAuthority({
      grant: readJson("--grant"),
      events: readJson("--events"),
      trustedOwners: readJson("--trusted-owners"),
      trustedOwnerKeyFingerprint: option("--owner-key-fingerprint"),
      trustedOwnerBundleContentHash: option("--owner-bundle-hash"),
      counters: readJson("--owner-counters"),
      now: option("--at", false) ?? new Date(),
      request: {
        subjectType: option("--subject-type"),
        subjectId: option("--subject-id"),
        programId: option("--program"),
        repository: option("--repository"),
        riskClass: option("--risk"),
        action: option("--action"),
        mergeMode: option("--merge-mode"),
      },
    })
    process.stdout.write(`OWNER_AUTHORITY_ARTIFACT_VALIDATION=${JSON.stringify(result)}\n`)
  } else if (command === "assert-legacy-revocations") {
    const registry = readJson("--registry")
    const result = assertLegacyAuthorityRevocations({
      events: readJson("--events"),
      trustedOwners: readJson("--trusted-owners"),
      trustedOwnerKeyFingerprint: registry.adapter?.revocationEvent?.ownerKeyFingerprint,
      trustedOwnerBundleContentHash: registry.adapter?.revocationEvent?.trustBundleContentHash,
      now: option("--at", false) ?? new Date(),
      expected: {
        adapterId: registry.adapter?.adapterId,
        authorityRecordIds: registry.workOrders
          ?.filter((record) => record.adapterId === registry.adapter?.adapterId)
          .map((record) => record.workOrderId),
        terminalIssueNumber: registry.adapter?.terminalIssueNumber,
        terminalReason: registry.adapter?.terminalReason,
      },
    })
    process.stdout.write(`OWNER_REVOCATION_ASSERTION=${JSON.stringify(result)}\n`)
  } else {
    throw new AuthorityAssertionError("AUTHORITY_CLI_WALL", "COMMAND")
  }
} catch (error) {
  const code = error instanceof AuthorityAssertionError ? error.code : "AUTHORITY_ASSERTION_WALL"
  process.stderr.write(`${code}\n`)
  process.exitCode = 2
}
