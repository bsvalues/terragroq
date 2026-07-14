import fs from "node:fs"
import process from "node:process"

import { AuthorityAssertionError } from "./authority-events.mjs"
import { validateOwnerOperationEvidenceArtifacts } from "./owner-operation-evidence.mjs"

function option(name) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value || value.startsWith("--")) throw new AuthorityAssertionError("OWNER_OPERATION_EVIDENCE_CLI_WALL", name)
  return value
}

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(option(name), "utf8"))
  } catch (error) {
    if (error instanceof AuthorityAssertionError) throw error
    throw new AuthorityAssertionError("OWNER_OPERATION_EVIDENCE_INPUT_WALL", name)
  }
}

try {
  if (process.argv[2] !== "verify") throw new AuthorityAssertionError("OWNER_OPERATION_EVIDENCE_CLI_WALL", "COMMAND")
  const result = validateOwnerOperationEvidenceArtifacts({
    evidence: readJson("--evidence"),
    checkpoints: readJson("--checkpoints"),
    checkpointAnchor: readJson("--checkpoint-anchor"),
    expected: readJson("--expected-run"),
    trustedOwners: readJson("--trusted-owners"),
    trustedOwnerKeyFingerprint: option("--owner-key-fingerprint"),
    trustedOwnerBundleContentHash: option("--owner-bundle-hash"),
  })
  process.stdout.write(`OWNER_OPERATION_EVIDENCE_VERIFICATION=${JSON.stringify(result)}\n`)
} catch (error) {
  process.stdout.write("")
  process.stderr.write(`${error instanceof AuthorityAssertionError ? error.code : "OWNER_OPERATION_EVIDENCE_ASSERTION_WALL"}\n`)
  process.exitCode = 2
}
