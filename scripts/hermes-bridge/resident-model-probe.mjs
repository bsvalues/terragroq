#!/usr/bin/env node
// P2 resident-model probe: drives createHermesKernelClient exactly as the orchestrator would,
// against an owned probe worktree, and writes a JSON evidence summary. Owner-triggered on the
// kernel host (HERMES). Not part of the runtime; no orchestrator, DB, or Codex involved.
//
// Usage (PowerShell on HERMES, from the checkout root):
//   node scripts/hermes-bridge/resident-model-probe.mjs `
//     --workspace C:\Users\bs\.williamos\hermes-bridge\worktrees\p2-resident-probe `
//     --policy   D:\HermesServices\williamos-hermes-agent\hermes-free-dev-agent-v2.probe.policy.json `
//     --out      C:\HermesLab\p2\summary.json
// Env: WILLIAMOS_HERMES_RUNTIME_ROOT (default %USERPROFILE%\.williamos\hermes-bridge)
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createHermesKernelClient } from "./hermes-kernel-client.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "./prompt.mjs"
import { createCommandRunner } from "./repository-lifecycle.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECKOUT = path.resolve(HERE, "..", "..")

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : process.argv[index + 1]
}

export const PROBE_WORK_ORDER = "WO-HERMES-P2-PROBE-001"
export const PROBE_BRANCH = "p2/resident-probe"
export const PROBE_MARKER = "// P2 resident-model probe 2026-08-16"

/** Second-turn prompt (P2b continuity): answerable only from the previous turn's context. */
export function buildContinuityPrompt() {
  return [
    `Work Order: ${PROBE_WORK_ORDER}`,
    `Branch: ${PROBE_BRANCH}`,
    "This is a follow-up turn in the same session as your previous work on this Work Order.",
    "Do NOT use any tools and do NOT read or change any file.",
    "From memory of this session only: report the exact comment line you added earlier, and the file you added it to, as the two entries of the validation array (first the comment line, then the file path).",
    `Report result READY_FOR_VALIDATION, workOrder ${PROBE_WORK_ORDER}, branch ${PROBE_BRANCH}, commit null, prUrl null, merged false, mergeCommit null, reviewThreads 0, ownerTouchCount 0, blockedScopeCrossed false, nextState READY_FOR_VALIDATION, and null for blockedAction, authorityBoundary, minimumChoice, approveConsequence, denyConsequence.`,
  ].join("\n")
}

export function buildProbePrompt() {
  return [
    `Work Order: ${PROBE_WORK_ORDER}`,
    `Branch: ${PROBE_BRANCH}`,
    "You are inside the owned WilliamOS worktree for this Work Order.",
    "Reserved paths (the ONLY files you may change):",
    "- lib/workbench/thread-trust.ts",
    "- components/workbench/outcome-execution-control.tsx",
    "- tests/outcome-execution-control-rendered.test.tsx",
    `Task: add exactly one line comment \`${PROBE_MARKER}\` as the FIRST line of lib/workbench/thread-trust.ts. Change nothing else. Do not run npm install. Do not commit.`,
    `When done, report with result READY_FOR_VALIDATION, workOrder ${PROBE_WORK_ORDER}, branch ${PROBE_BRANCH}, commit null, prUrl null, merged false, mergeCommit null, validation [], reviewThreads 0, ownerTouchCount 0, blockedScopeCrossed false, nextState READY_FOR_VALIDATION, and null for blockedAction, authorityBoundary, minimumChoice, approveConsequence, denyConsequence.`,
  ].join("\n")
}

export async function runResidentModelProbe({
  workspacePath,
  policyPath,
  runtimeRoot = process.env.WILLIAMOS_HERMES_RUNTIME_ROOT ?? path.join(os.homedir(), ".williamos", "hermes-bridge"),
  invokerPath = path.join(CHECKOUT, "scripts", "execution-fabric", "hermes-agent", "invoke-hermes-free-dev-agent.ps1"),
  timeoutMs = 45 * 60 * 1000,
  commandRunner = createCommandRunner(),
  now = () => new Date(),
  turns = 1,
} = {}) {
  const summary = { startedAt: now().toISOString(), workspacePath, policyPath, invokerPath, checkout: CHECKOUT }
  const client = createHermesKernelClient({ workspacePath, runtimeRoot, commandRunner, policyPath, invokerPath, timeoutMs })
  try {
    await client.connect()
    summary.connect = "OK"
    const threadId = await client.startThread({ cwd: workspacePath, approvalPolicy: "never", sandbox: "workspace-write", ephemeral: false })
    summary.threadId = threadId
    const t0 = Date.now()
    try {
      summary.turn = await client.runTurn({ threadId, prompt: buildProbePrompt(), turn: { outputSchema: HERMES_TURN_OUTPUT_SCHEMA }, timeoutMs })
    } catch (error) {
      summary.turnError = { name: error?.name, code: error?.code, message: error?.message, detail: error?.detail ?? null }
    }
    summary.turnMs = Date.now() - t0
    try {
      await client.resumeThread(threadId, { cwd: workspacePath, approvalPolicy: "never", sandbox: "workspace-write" })
      summary.resume = "RESUMED"
    } catch (error) { summary.resume = { code: error?.code } }
    if (turns >= 2 && summary.turn?.status === "completed") {
      // P2b continuity: a second turn on the same thread continues the kernel session that
      // the first turn left in the thread's state dir; the answer must come from that context.
      const t1 = Date.now()
      try {
        summary.continuityTurn = await client.runTurn({ threadId, prompt: buildContinuityPrompt(), turn: { outputSchema: HERMES_TURN_OUTPUT_SCHEMA }, timeoutMs })
        const answer = JSON.parse(summary.continuityTurn.finalText)
        const validation = Array.isArray(answer.validation) ? answer.validation.map(String) : []
        summary.continuity = {
          recalledMarker: validation.some((entry) => entry.includes(PROBE_MARKER)),
          recalledFile: validation.some((entry) => entry.includes("lib/workbench/thread-trust.ts")),
          validation,
        }
      } catch (error) {
        summary.continuityTurnError = { name: error?.name, code: error?.code, message: error?.message, detail: error?.detail ?? null }
      }
      summary.continuityTurnMs = Date.now() - t1
    }
    const threadDir = path.join(runtimeRoot, "hermes-kernel", "threads", threadId)
    summary.threadDir = threadDir
    summary.session = JSON.parse(fs.readFileSync(path.join(threadDir, "session.json"), "utf8"))
  } catch (error) {
    summary.fatal = { name: error?.name, code: error?.code, message: error?.message }
  } finally {
    client.close()
  }
  summary.finishedAt = now().toISOString()
  return summary
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workspacePath = argValue("--workspace")
  const policyPath = argValue("--policy")
  const out = argValue("--out")
  const turns = Number(argValue("--turns", "1"))
  if (!workspacePath || !policyPath || !(turns === 1 || turns === 2)) {
    process.stderr.write("usage: resident-model-probe.mjs --workspace <owned worktree> --policy <v2 policy> [--turns 1|2] [--out <summary.json>]\n")
    process.exit(2)
  }
  const summary = await runResidentModelProbe({ workspacePath, policyPath, turns })
  const text = `${JSON.stringify(summary, null, 2)}\n`
  if (out) fs.writeFileSync(out, text)
  process.stdout.write(text)
  process.exit(summary.turn?.status === "completed" ? 0 : 1)
}
