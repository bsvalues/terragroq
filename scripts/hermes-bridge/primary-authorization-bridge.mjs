import path from "node:path"
import { pathToFileURL } from "node:url"

import { recordVerifiedPrimaryAuthorization } from "./outcome-queue-source.mjs"
import { verifyPrimaryAuthorizationProvenance } from "./primary-authorization-provenance.mjs"

function wall(code) {
  throw Object.assign(new Error(code), { code })
}

export async function executePrimaryAuthorizationBridge({
  repositoryPath = process.cwd(),
  databaseUrl = process.env.DATABASE_URL,
  query,
} = {}) {
  const authorization = await verifyPrimaryAuthorizationProvenance({ repositoryPath })
  return recordVerifiedPrimaryAuthorization({
    query,
    databaseUrl,
    authorization,
  })
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 0) wall("PRIMARY_AUTHORIZATION_USAGE_WALL")
  const result = await executePrimaryAuthorizationBridge()
  process.stdout.write(`${JSON.stringify({
    result: result.status,
    authorizationDigest: result.authorizationDigest,
    outcomes: result.outcomes.map((outcome) => ({
      outcomeKey: outcome.outcomeKey,
      version: outcome.version,
      decisionRef: outcome.decisionRef,
      grantRef: outcome.grantRef,
    })),
  })}\n`)
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      result: "FAILED",
      code: error?.code ?? "PRIMARY_AUTHORIZATION_BRIDGE_FAILED",
    })}\n`)
    process.exitCode = 1
  })
}
