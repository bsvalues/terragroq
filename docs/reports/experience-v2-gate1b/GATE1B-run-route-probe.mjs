#!/usr/bin/env node
/**
 * GATE 1B SETTLEMENT — the `GET /api/fabric/nodes` brokered probe, invoked live.
 *
 * The WINDOWS_PROBE body below is copied VERBATIM from `app/api/fabric/nodes/route.ts` at merged main
 * 053a33bd. It is reproduced rather than imported because the route is a Next.js module that pulls in
 * the session layer; the probe body is the part under test, and copying it lets the settlement pin it
 * by digest against the route file.
 *
 * Its purpose here is the contrast, not the inventory: this path reports accelerators as ONE
 * SEMICOLON-JOINED PRESENTATION STRING, which is exactly what a client must not have to parse.
 *
 * usage: node run-route-probe.mjs <transport-endpoint>
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { brokeredExec } from "./lib/fabric/broker.mjs"

const WINDOWS_PROBE = [
  '$c = Get-CimInstance Win32_ComputerSystem',
  '"host=" + $env:COMPUTERNAME',
  '"cores=" + $c.NumberOfLogicalProcessors',
  '$o = Get-CimInstance Win32_OperatingSystem',
  '"mem=" + [math]::Round($o.FreePhysicalMemory/1MB,1) + "/" + [math]::Round($c.TotalPhysicalMemory/1GB,1)',
  '"uptime=" + [string]([math]::Round(((Get-Date) - $o.LastBootUpTime).TotalDays,1)) + " days"',
  '"disk=" + ((Get-PSDrive C,D -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + ":" + [math]::Round($_.Free/1GB,0) + "G" }) -join " ")',
  '"gpu=" + ((Get-CimInstance Win32_VideoController).Name -join ";")',
  '"containers=" + ((docker ps -q 2>$null) | Measure-Object).Count',
  '"services=" + ((docker ps --format "{{.Names}}" 2>$null) -join ",")',
].join("; ")

function parseProbe(text) {
  const fields = {}
  for (const line of text.split("\n")) {
    const index = line.indexOf("=")
    if (index > 0) fields[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return fields
}

const root = path.dirname(fileURLToPath(import.meta.url))
const endpoint = process.argv[2]
if (!endpoint) {
  console.error("usage: node run-route-probe.mjs <transport-endpoint>")
  process.exit(2)
}

const startedAt = new Date().toISOString()
const startedMs = Date.now()
let record
try {
  const { stdout, stderr } = await brokeredExec(endpoint, WINDOWS_PROBE, { timeout: 20_000, action: "probe" })
  record = {
    invocation: "brokeredExec",
    source: "app/api/fabric/nodes/route.ts WINDOWS_PROBE (verbatim)",
    endpoint,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    ok: true,
    stderr: stderr ? String(stderr) : null,
    fields: parseProbe(stdout),
  }
} catch (error) {
  record = {
    invocation: "brokeredExec",
    source: "app/api/fabric/nodes/route.ts WINDOWS_PROBE (verbatim)",
    endpoint,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    ok: false,
    errorName: error?.name ?? null,
    errorMessage: String(error?.message ?? ""),
    errorStderr: error?.stderr ? String(error.stderr) : null,
  }
}

fs.mkdirSync(path.join(root, ".artifacts", "execution-fabric"), { recursive: true })
fs.writeFileSync(
  path.join(root, ".artifacts", "execution-fabric", "route-nodes-probe.json"),
  JSON.stringify(record, null, 2) + "\n",
  "utf8",
)
console.log(JSON.stringify(record, null, 2))
process.exit(record.ok ? 0 : 1)
