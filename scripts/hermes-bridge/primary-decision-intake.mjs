import { pathToFileURL } from "node:url"
import path from "node:path"

import {
  readPendingPrimaryDecisionRequest,
  recordOwnerAuthorityDecision,
} from "./outcome-source.mjs"
import {
  isVerifiedPrimaryDecisionResponse,
  PRIMARY_DECISION_OWNER_EMAIL,
  verifyPrimaryDecisionResponse,
} from "./primary-decision-provenance.mjs"

export async function consumePrimaryDecisionIntake({
  repositoryPath = process.cwd(),
  databaseUrl = process.env.DATABASE_URL,
  query,
  environment = process.env,
  readRequest = readPendingPrimaryDecisionRequest,
  verifyResponse = verifyPrimaryDecisionResponse,
  recordDecision = recordOwnerAuthorityDecision,
} = {}) {
  const request = await readRequest({ query, databaseUrl, ownerEmail: PRIMARY_DECISION_OWNER_EMAIL })
  if (!request) return { status: "NO_PENDING_PRIMARY_DECISION" }
  if (typeof environment.CODEX_THREAD_ID !== "string" || environment.CODEX_THREAD_ID.trim() === "") {
    return { status: "PENDING_PRIMARY_DECISION", outcomeId: request.outcomeId }
  }
  const response = await verifyResponse({ request, repositoryPath, environment })
  if (!isVerifiedPrimaryDecisionResponse(response)) {
    throw Object.assign(new Error("Primary decision response was not verified"), {
      code: "PRIMARY_DECISION_PROVENANCE_WALL",
    })
  }
  const result = await recordDecision({
    query,
    databaseUrl,
    outcomeId: request.outcomeId,
    workOrderId: request.workOrderId,
    terminalEventId: request.terminalEventId,
    ownerUserId: request.ownerUserId,
    choice: response.choice,
    expectedNextState: request.expectedNextState,
    primaryDecisionProvenance: response,
  })
  return {
    status: result.replayed ? "PRIMARY_DECISION_REPLAYED" : "PRIMARY_DECISION_RECORDED",
    outcomeId: request.outcomeId,
    choice: response.choice,
    resumeReleased: result.resumeReleased,
    decisionRef: result.decisionRef,
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 0) throw Object.assign(new Error("PRIMARY_DECISION_INTAKE_USAGE_WALL"), {
    code: "PRIMARY_DECISION_INTAKE_USAGE_WALL",
  })
  const result = await consumePrimaryDecisionIntake()
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: "FAILED",
      code: error?.code ?? "PRIMARY_DECISION_INTAKE_FAILED",
    })}\n`)
    process.exitCode = 1
  })
}
