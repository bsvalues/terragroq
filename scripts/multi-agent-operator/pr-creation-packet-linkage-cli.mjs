#!/usr/bin/env node

import {
  canonicalPrCreationPacketLinkageJson,
  PrCreationPacketLinkageError,
  runCanonicalPrCreationPacketLinkage,
} from "./pr-creation-packet-linkage.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "PR_CREATION_PACKET_LINKAGE_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    githubWritePerformed: false,
    pullRequestCreated: false,
    reviewThreadResolved: false,
    mergePerformed: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("PR_PACKET_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalPrCreationPacketLinkage() }
  } catch (error) {
    result = error instanceof PrCreationPacketLinkageError
      ? failure(error.code, error.field, error.detail)
      : failure("PR_PACKET_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalPrCreationPacketLinkageJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
