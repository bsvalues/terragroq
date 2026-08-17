import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const run = promisify(execFile)
const FABRIC = process.env.WILLIAMOS_FABRIC_ROOT ?? path.join(os.homedir(), ".williamos", "fabric")
const PROBE_TIMEOUT_MS = 20_000

/**
 * Live state of every node in the lab.
 *
 * The operator could not see his own machines. Everything about node health, disks, GPUs and running
 * services reached him as prose from an assistant, which meant trusting a narrator instead of reading
 * the system -- and a system whose state you cannot inspect is one you cannot govern.
 *
 * So this probes the nodes on request rather than reading a cached summary written earlier: a status
 * page that shows yesterday's truth is worse than none, because it looks current. Every field comes
 * from a command run at the moment the page is loaded, and a node that cannot be reached says so
 * instead of disappearing from the list.
 */

interface NodeRecord {
  transport?: string
  host?: string
  user?: string
  os?: string
  role?: string
  enrolled?: boolean
}

// One fixed command per platform. No caller input reaches these, and each field is emitted as a
// labelled line so a partially-failing probe still yields the parts that worked.
const LINUX_PROBE = [
  'echo "host=$(hostname)"',
  'echo "uptime=$(uptime -p 2>/dev/null | sed s/^up.//)"',
  'echo "cores=$(nproc)"',
  `echo "mem=$(free -g | awk '/Mem:/ {print $7 "/" $2}')"`,
  `echo "disk=$(df -h / | tail -1 | awk '{print $4 "/" $2}')"`,
  `echo "forge=$(df -h /forge 2>/dev/null | tail -1 | awk '{print $4 "/" $2}')"`,
  'echo "containers=$(docker ps -q 2>/dev/null | wc -l)"',
  `echo "services=$(docker ps --format '{{.Names}}' 2>/dev/null | head -8 | paste -sd, -)"`,
  `echo "gpu=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | paste -sd';' - || lspci 2>/dev/null | grep -i 'vga.*nvidia' | sed 's/.*\\[//;s/\\].*//' | paste -sd';' -)"`,
  `echo "gpudriver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)"`,
].join("; ")

function parseProbe(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const index = line.indexOf("=")
    if (index > 0) fields[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return fields
}

async function probeLocal(): Promise<Record<string, string>> {
  // HERMES runs this application, so it is measured directly rather than over a network hop.
  const script = [
    '$c = Get-CimInstance Win32_ComputerSystem',
    '"host=" + $env:COMPUTERNAME',
    '"cores=" + $c.NumberOfLogicalProcessors',
    '$o = Get-CimInstance Win32_OperatingSystem',
    '"mem=" + [math]::Round($o.FreePhysicalMemory/1MB,1) + "/" + [math]::Round($c.TotalPhysicalMemory/1GB,1)',
    '"uptime=" + [string]([math]::Round(((Get-Date) - $o.LastBootUpTime).TotalDays,1)) + " days"',
    '"disk=" + (Get-PSDrive C,D -ErrorAction SilentlyContinue | ForEach-Object { $_.Name + ":" + [math]::Round($_.Free/1GB,0) + "G" }) -join " "',
    '"gpu=" + ((Get-CimInstance Win32_VideoController).Name -join ";")',
    '"containers=" + ((docker ps -q 2>$null) | Measure-Object).Count',
    '"services=" + ((docker ps --format "{{.Names}}" 2>$null) -join ",")',
  ].join("; ")
  const { stdout } = await run("powershell", ["-NoProfile", "-Command", script], { timeout: PROBE_TIMEOUT_MS, windowsHide: true })
  return parseProbe(stdout)
}

async function probeSsh(node: NodeRecord): Promise<Record<string, string>> {
  const { stdout } = await run(
    "ssh",
    [
      "-i", path.join(FABRIC, "keys", "williamos-fabric"),
      "-o", `UserKnownHostsFile=${path.join(FABRIC, "known_hosts")}`,
      "-o", "StrictHostKeyChecking=yes",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=8",
      `${node.user}@${node.host}`,
      LINUX_PROBE,
    ],
    { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
  )
  return parseProbe(stdout)
}

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let registry: Record<string, NodeRecord>
  try {
    registry = JSON.parse(await fs.readFile(path.join(FABRIC, "nodes.json"), "utf8"))
  } catch {
    return Response.json({ error: "REGISTRY_UNAVAILABLE", fabric: FABRIC }, { status: 503 })
  }

  const nodes = await Promise.all(
    Object.entries(registry).map(async ([name, node]) => {
      const started = Date.now()
      try {
        const fields = node.transport === "local" ? await probeLocal() : await probeSsh(node)
        return { name, ...node, reachable: true, ms: Date.now() - started, fields }
      } catch (error) {
        // The reason is kept: "unreachable" alone sends the reader looking in the wrong place, while
        // "permission denied" and "connection refused" point at completely different problems.
        const detail = String((error as { stderr?: string; message?: string })?.stderr || (error as Error)?.message || "")
          .split("\n")[0]
          .slice(0, 200)
        return { name, ...node, reachable: false, ms: Date.now() - started, detail, fields: {} }
      }
    }),
  )

  return Response.json(
    { checkedAt: new Date().toISOString(), nodes },
    { headers: { "cache-control": "no-store" } },
  )
}
