#!/usr/bin/env node
/**
 * GATE 1B SETTLEMENT — canonical brokered probe invocation.
 *
 * This file declares NOTHING about hardware. It contains no device name, no VRAM figure, no UUID and
 * no inventory. Its entire job is to invoke the canonical probe path THROUGH `lib/fabric/broker.mjs`
 * so the observation is policy-resolved, host-key-pinned and written to the same audit ledger as
 * every other action taken against this lab. Raw transport would have produced the same numbers and
 * proved nothing, because bypassing the broker is exactly the failure the ledger exists to catch.
 *
 * usage: node run-canonical-probe.mjs <transport-endpoint> <canonical-node-id>
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { brokeredExec } from "./lib/fabric/broker.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))
const endpoint = process.argv[2]
const nodeId = process.argv[3]
if (!endpoint || !nodeId) {
  console.error("usage: node run-canonical-probe.mjs <transport-endpoint> <canonical-node-id>")
  process.exit(2)
}

const probe = path.join(root, "scripts", "execution-fabric", "probe-windows.ps1")
const out = path.join(root, ".artifacts", "execution-fabric", `${nodeId}.json`)
const command = `& '${probe}' -NodeId '${nodeId}' -OutputPath '${out}'`

const startedAt = new Date().toISOString()
const startedMs = Date.now()
let record
try {
  const { stdout, stderr } = await brokeredExec(endpoint, command, { timeout: 180_000, action: "probe" })
  record = {
    invocation: "brokeredExec",
    broker: "lib/fabric/broker.mjs",
    endpoint,
    nodeId,
    command,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    ok: true,
    stderr: stderr ? String(stderr) : null,
    stdoutBytes: Buffer.byteLength(stdout ?? "", "utf8"),
    outputPath: out,
    outputWritten: fs.existsSync(out),
  }
} catch (error) {
  record = {
    invocation: "brokeredExec",
    broker: "lib/fabric/broker.mjs",
    endpoint,
    nodeId,
    command,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    ok: false,
    errorName: error?.name ?? null,
    errorCode: error?.code ?? null,
    errorMessage: String(error?.message ?? ""),
    errorStderr: error?.stderr ? String(error.stderr) : null,
    outputPath: out,
    outputWritten: fs.existsSync(out),
  }
}

fs.mkdirSync(path.join(root, ".artifacts", "execution-fabric"), { recursive: true })
fs.writeFileSync(
  path.join(root, ".artifacts", "execution-fabric", `${nodeId}.brokered-invocation.json`),
  JSON.stringify(record, null, 2) + "\n",
  "utf8",
)
console.log(JSON.stringify(record, null, 2))
process.exit(record.ok ? 0 : 1)
