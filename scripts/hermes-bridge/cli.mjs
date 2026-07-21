import path from "node:path"
import { pathToFileURL } from "node:url"
import { CodexAppServerClient, sanitizeAppServerText } from "./app-server-client.mjs"
import { createHermesOrchestrator } from "./orchestrator.mjs"
import { NATIVE_PROVIDER_RETRY_STATE, recoverNativeProviderOutcome } from "./outcome-source.mjs"
import { readHermesState } from "./state-store.mjs"

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
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

export async function runCli(command = process.argv[2]) {
  try {
    if (command === "cycle") {
      const orchestrator = createHermesOrchestrator({ workspace: process.cwd() })
      print(await orchestrator.cycle())
    }
    else if (command === "smoke") print(await smoke())
    else if (command === "recover-native-provider-wall") print(await recoverNativeProviderWall())
    else if (command === "status") {
      const orchestrator = createHermesOrchestrator({ workspace: process.cwd() })
      print(readHermesState(path.join(orchestrator.runtimeRoot, "state", "state.json")))
    } else {
      throw Object.assign(new Error("Usage: cli.mjs cycle|smoke|status|recover-native-provider-wall"), { code: "HERMES_CLI_USAGE" })
    }
  } catch (error) {
    print({ result: "WALL", code: error?.code ?? "HERMES_CLI_FAILED", message: sanitizeBridgeMessage(error?.message ?? "Hermes bridge failed") })
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli()
