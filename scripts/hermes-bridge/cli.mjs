#!/usr/bin/env node
import path from "node:path"
import { CodexAppServerClient } from "./app-server-client.mjs"
import { createHermesOrchestrator } from "./orchestrator.mjs"
import { readHermesState } from "./state-store.mjs"

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
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

const command = process.argv[2]
const orchestrator = createHermesOrchestrator({ workspace: process.cwd() })

try {
  if (command === "cycle") print(await orchestrator.cycle())
  else if (command === "smoke") print(await smoke())
  else if (command === "status") {
    print(readHermesState(path.join(orchestrator.runtimeRoot, "state", "state.json")))
  } else {
    throw Object.assign(new Error("Usage: cli.mjs cycle|smoke|status"), { code: "HERMES_CLI_USAGE" })
  }
} catch (error) {
  print({ result: "WALL", code: error?.code ?? "HERMES_CLI_FAILED", message: String(error?.message ?? "Hermes bridge failed") })
  process.exitCode = 1
}
