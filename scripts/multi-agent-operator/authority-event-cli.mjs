import fs from "node:fs"
import process from "node:process"

import { AuthorityAssertionError, assertOwnerAuthority } from "./authority-events.mjs"

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
  if (process.argv[2] !== "assert") throw new AuthorityAssertionError("AUTHORITY_CLI_WALL", "COMMAND")
  const result = assertOwnerAuthority({
    grant: readJson("--grant"),
    events: readJson("--events"),
    trustedOwners: readJson("--trusted-owners"),
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
  process.stdout.write(`OWNER_AUTHORITY_ASSERTION=${JSON.stringify(result)}\n`)
} catch (error) {
  const code = error instanceof AuthorityAssertionError ? error.code : "AUTHORITY_ASSERTION_WALL"
  process.stderr.write(`${code}\n`)
  process.exitCode = 2
}
