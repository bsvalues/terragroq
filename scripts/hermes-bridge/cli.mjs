import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { CodexAppServerClient, sanitizeAppServerText } from "./app-server-client.mjs"
import { createHermesOrchestrator } from "./orchestrator.mjs"
import {
  NATIVE_PROVIDER_RETRY_STATE,
  VALIDATION_INFRASTRUCTURE_RETRY_STATE,
  recordValidationInfrastructureRecoveryProof,
  recoverNativeProviderOutcome,
  recoverValidationInfrastructureOutcome,
} from "./outcome-source.mjs"
import { readHermesState } from "./state-store.mjs"

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function flushStdout() {
  return new Promise((resolve, reject) => {
    process.stdout.write("", (error) => error ? reject(error) : resolve())
  })
}

export function sanitizeBridgeMessage(value) {
  return sanitizeAppServerText(String(value ?? ""))
    .replace(/\bpostgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
}

async function smoke() {
  const client = new CodexAppServerClient({ cwd: process.cwd(), timeoutMs: 180_000 })
  try {
    await client.connect()
    const threadId = await client.startThread({
      cwd: process.cwd(), approvalPolicy: "never", sandbox: "read-only", ephemeral: true,
    })
    const result = await client.runTurn({
      threadId,
      prompt: "Read-only Hermes transport proof. Do not use tools or modify files. Reply exactly HERMES_APP_SERVER_READY.",
      timeoutMs: 180_000,
    })
    if (result.status !== "completed" || result.finalText.trim() !== "HERMES_APP_SERVER_READY") {
      throw Object.assign(new Error("Hermes App Server smoke response mismatch"), { code: "HERMES_SMOKE_WALL" })
    }
    return { result: "PASS", transport: "CODEX_APP_SERVER_STDIO", rejectedIssue357Reused: false }
  } finally {
    client.close()
  }
}

async function recoverNativeProviderWall() {
  const orchestrator = createHermesOrchestrator({ workspace: process.cwd() })
  const state = orchestrator.state.read()
  const candidates = Object.values(state.executions).filter((execution) => (
    execution?.lease?.status === "RELEASED"
    && execution?.checkpoint?.state === "FAILED_TERMINAL"
    && execution?.checkpoint?.detail === NATIVE_PROVIDER_RETRY_STATE
  ))
  if (candidates.length !== 1) {
    throw Object.assign(new Error("Exactly one native provider wall is required"), { code: "HERMES_PROVIDER_RECOVERY_CANDIDATE_WALL" })
  }
  const candidate = candidates[0]
  const outcomeId = Number(candidate.outcomeId)
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("Native provider outcome id is invalid"), { code: "HERMES_PROVIDER_RECOVERY_OUTCOME_WALL" })
  }
  if (!await recoverNativeProviderOutcome({ outcomeId })) {
    throw Object.assign(new Error("Persisted native provider outcome did not match recovery evidence"), { code: "HERMES_PROVIDER_RECOVERY_DATABASE_WALL" })
  }
  const reopened = orchestrator.state.reopenProviderWall({
    idempotencyKey: `${candidate.outcomeId}:recover-native-provider:${candidate.fencingToken}`,
    outcomeId: candidate.outcomeId,
    expectedFencingToken: candidate.fencingToken,
    expectedDetail: NATIVE_PROVIDER_RETRY_STATE,
  })
  return { result: "RECOVERED", outcomeId: candidate.outcomeId, checkpointSequence: reopened.checkpointSequence }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export async function recoverValidationInfrastructureWall(options = {}) {
  const orchestrator = options.orchestrator ?? createHermesOrchestrator({ workspace: process.cwd() })
  const recordProof = options.recordProof ?? recordValidationInfrastructureRecoveryProof
  const recoverOutcome = options.recoverOutcome ?? recoverValidationInfrastructureOutcome
  const state = orchestrator.state.read()
  const ownerTouchesRemainZero = Object.values(state.ownerTouchCounters).every((value) => value === 0)
  if (!ownerTouchesRemainZero) {
    throw Object.assign(new Error("Owner-touch counters must remain zero"), { code: "HERMES_VALIDATION_RECOVERY_OWNER_TOUCH_WALL" })
  }
  const candidates = Object.values(state.executions).filter((execution) => (
    (execution?.lease?.status === "RELEASED"
      && execution?.checkpoint?.state === "FAILED_TERMINAL"
      && execution?.checkpoint?.detail === VALIDATION_INFRASTRUCTURE_RETRY_STATE
      && /\bspawn EPERM\b/i.test(String(execution?.metadata?.validationFailure ?? "")))
    || (execution?.lease?.status === "ABANDONED"
      && execution?.checkpoint?.state === "VALIDATION_INFRASTRUCTURE_RECOVERED"
      && execution?.checkpoint?.detail === VALIDATION_INFRASTRUCTURE_RETRY_STATE
      && /^[0-9a-f]{64}$/.test(String(execution?.metadata?.validationRecoveryProofDigest ?? "")))
  ))
  if (candidates.length !== 1) {
    throw Object.assign(new Error("Exactly one validation infrastructure wall is required"), { code: "HERMES_VALIDATION_RECOVERY_CANDIDATE_WALL" })
  }
  const candidate = candidates[0]
  const outcomeId = Number(candidate.outcomeId)
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("Validation infrastructure outcome id is invalid"), { code: "HERMES_VALIDATION_RECOVERY_OUTCOME_WALL" })
  }
  let proofDigest = candidate.metadata.validationRecoveryProofDigest
  if (candidate.checkpoint.state === "FAILED_TERMINAL") {
    const validationFailureDigest = sha256(candidate.metadata.validationFailure)
    proofDigest = sha256(JSON.stringify({
      outcomeId: candidate.outcomeId,
      fencingToken: candidate.fencingToken,
      checkpointSequence: candidate.checkpoint.sequence,
      checkpointDetail: candidate.checkpoint.detail,
      validationFailureDigest,
    }))
    orchestrator.state.reopenValidationInfrastructureWall({
      idempotencyKey: `${candidate.outcomeId}:recover-validation-infrastructure:${candidate.fencingToken}`,
      outcomeId: candidate.outcomeId,
      expectedFencingToken: candidate.fencingToken,
      expectedDetail: VALIDATION_INFRASTRUCTURE_RETRY_STATE,
      expectedValidationFailureDigest: validationFailureDigest,
      proofDigest,
    })
  }
  if (!await recordProof({ outcomeId, proofDigest, fencingToken: candidate.fencingToken })) {
    throw Object.assign(new Error("Validation infrastructure proof was not persisted"), { code: "HERMES_VALIDATION_RECOVERY_PROOF_WALL" })
  }
  if (!await recoverOutcome({ outcomeId, proofDigest })) {
    throw Object.assign(new Error("Persisted validation infrastructure outcome did not match recovery evidence"), { code: "HERMES_VALIDATION_RECOVERY_DATABASE_WALL" })
  }
  return { result: "RECOVERED", outcomeId: candidate.outcomeId, proofRecorded: true }
}

export function recoverExternalToolWall(options = {}) {
  const orchestrator = options.orchestrator ?? createHermesOrchestrator({ workspace: process.cwd() })
  const activationPath = path.join(orchestrator.runtimeRoot, "control", "activation")
  const supervisorPath = path.join(orchestrator.runtimeRoot, "state", "supervisor.json")
  const activation = fs.existsSync(activationPath) ? fs.readFileSync(activationPath, "utf8").trim() : "disabled"
  if (activation !== "disabled" || fs.existsSync(supervisorPath)) {
    throw Object.assign(new Error("Supervisor must be stopped before external-tool recovery"), { code: "HERMES_EXTERNAL_TOOL_RECOVERY_SUPERVISOR_WALL" })
  }
  const state = orchestrator.state.read()
  const candidates = Object.values(state.executions).filter((execution) => (
    execution?.lease?.status === "ACTIVE"
    && execution?.checkpoint?.state === "RETRYABLE_WALL"
    && execution?.checkpoint?.detail === "APP_SERVER_EXTERNAL_TOOL_WALL"
  ))
  if (candidates.length !== 1) {
    throw Object.assign(new Error("Exactly one external-tool wall is required"), { code: "HERMES_EXTERNAL_TOOL_RECOVERY_CANDIDATE_WALL" })
  }
  const candidate = candidates[0]
  const recovered = orchestrator.state.recoverExternalToolWall({
    idempotencyKey: `${candidate.outcomeId}:recover-external-tool:${candidate.fencingToken}`,
    outcomeId: candidate.outcomeId,
    expectedFencingToken: candidate.fencingToken,
    expectedHolderId: candidate.lease.holderId,
    activationDisabled: true,
  })
  return { result: "RECOVERED", outcomeId: candidate.outcomeId, checkpointSequence: recovered.checkpointSequence }
}

export async function runCli(command = process.argv[2]) {
  try {
    if (command === "cycle") {
      const orchestrator = createHermesOrchestrator({ workspace: process.cwd() })
      print(await orchestrator.cycle())
    }
    else if (command === "smoke") print(await smoke())
    else if (command === "recover-native-provider-wall") print(await recoverNativeProviderWall())
    else if (command === "recover-validation-infrastructure-wall") print(await recoverValidationInfrastructureWall())
    else if (command === "recover-external-tool-wall") print(recoverExternalToolWall())
    else if (command === "status") {
      const orchestrator = createHermesOrchestrator({ workspace: process.cwd() })
      print(readHermesState(path.join(orchestrator.runtimeRoot, "state", "state.json")))
    } else {
      throw Object.assign(new Error("Usage: cli.mjs cycle|smoke|status|recover-native-provider-wall|recover-validation-infrastructure-wall|recover-external-tool-wall"), { code: "HERMES_CLI_USAGE" })
    }
  } catch (error) {
    print({ result: "WALL", code: error?.code ?? "HERMES_CLI_FAILED", message: sanitizeBridgeMessage(error?.message ?? "Hermes bridge failed") })
    return 1
  }
  return 0
}

export async function runCliEntrypoint(command = process.argv[2], options = {}) {
  const run = options.run ?? runCli
  const flush = options.flush ?? flushStdout
  const exit = options.exit ?? process.exit
  const exitCode = await run(command)
  await flush()
  exit(exitCode)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCliEntrypoint()
