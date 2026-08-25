#!/usr/bin/env node
/**
 * #997 HERMES P40 COMMISSIONING — the one way this lane touches HERMES.
 *
 * This file declares NOTHING. It names no GPU, no UUID, no VRAM figure, no container, no image and
 * no power number. Its entire job is to carry a command through `lib/fabric/broker.mjs` so that
 * every read and every mutation this lane performs is policy-resolved and appended to the same
 * audit ledger the lab already keeps. Raw SSH would have produced identical bytes and proved
 * nothing, because bypassing the broker is precisely the failure the ledger exists to catch — and
 * #997 makes remote shell a MECHANISM under the governed action, not an authority of its own.
 *
 * The command arrives base64-encoded because PowerShell 5.1 strips inner quotes out of arguments it
 * forwards to a native command, and a probe body carrying `--format=csv,noheader` or an embedded
 * quote is torn apart before the broker ever sees it. Base64 has no metacharacters.
 *
 * `--require-audit` is passed through to `brokeredExec` as `requireAudit`, and the intent is that an
 * action which cannot be recorded must not happen -- discovering that after the container has already
 * been replaced is a worse outcome dressed as a better one.
 *
 * CORRECTED after the independent review, and left in place rather than quietly rewritten because
 * this file is evidence of a run. This docblock originally asserted that the option "checks the
 * ledger BEFORE the node is touched". It did not, in the code this lane executed: `brokeredExec` at
 * `053a33bd` does not destructure `requireAudit`, so the flag reached the broker and was dropped, and
 * the audit happened after the command like every other call. Confirmed by running that commit's
 * broker with the flag set against a fabric root with no ledger -- the command executed and returned.
 * The one mutation this lane made was recorded anyway, because the lab's ledger happened to be there.
 *
 * The behaviour the flag names lands in #996, which gives `brokeredExec` a `requireAudit` that calls
 * `requireLedger` first. Nothing about this wrapper changes; what changes is that the sentence above
 * becomes true of the broker it calls.
 *
 * usage: node P40-brokered.mjs <node> <action> <base64-command> <output-json> [--require-audit] [--timeout ms]
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { brokeredExec } from "./lib/fabric/broker.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))
const [node, action, encoded, outFile] = process.argv.slice(2)
if (!node || !action || !encoded || !outFile) {
  console.error("usage: node P40-brokered.mjs <node> <action> <base64-command> <output-json> [--require-audit] [--timeout ms]")
  process.exit(2)
}
const flags = process.argv.slice(6)
const requireAudit = process.argv.includes("--require-audit")
const timeoutFlag = process.argv.indexOf("--timeout")
const timeout = timeoutFlag === -1 ? 120_000 : Number(process.argv[timeoutFlag + 1])

const command = Buffer.from(encoded, "base64").toString("utf8")
const startedAt = new Date().toISOString()
const startedMs = Date.now()

let record
try {
  const { stdout, stderr } = await brokeredExec(node, command, { timeout, action, requireAudit })
  record = {
    invocation: "brokeredExec",
    broker: "lib/fabric/broker.mjs",
    node,
    action,
    requireAudit,
    command,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    ok: true,
    stdout: String(stdout ?? ""),
    stderr: stderr ? String(stderr) : null,
  }
} catch (error) {
  record = {
    invocation: "brokeredExec",
    broker: "lib/fabric/broker.mjs",
    node,
    action,
    requireAudit,
    command,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    ok: false,
    errorName: error?.name ?? null,
    errorCode: error?.code ?? null,
    errorMessage: String(error?.message ?? ""),
    stdout: error?.stdout ? String(error.stdout) : null,
    stderr: error?.stderr ? String(error.stderr) : null,
  }
}

fs.mkdirSync(path.dirname(path.resolve(root, outFile)), { recursive: true })
fs.writeFileSync(path.resolve(root, outFile), JSON.stringify(record, null, 2) + "\n", "utf8")
process.stdout.write(record.ok ? record.stdout : `BROKERED_FAILED ${record.errorMessage}\n`)
process.exit(record.ok ? 0 : 1)
