import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { getSession } from "@/lib/session"
import { brokeredExec } from "@/lib/fabric/broker.mjs"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

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
 *
 * Every node goes through `brokeredExec`, local included. There used to be a second, local-only probe
 * here that ran PowerShell directly, on the reasoning that the app runs on HERMES so no network hop
 * is involved. That reasoning skipped the part that matters: the broker denies unknown nodes, pins host
 * keys, and writes every action to the audit log. A read-only probe still belongs in the ledger --
 * "who looked at what, when" is half of an audit trail -- and `lib/fabric/broker.mjs` has handled the
 * `transport === "local"` case with that audit since it was written. The local path was not a
 * shortcut around a missing capability; it was a second, unaudited way to do the same thing.
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

// A Windows node answers in PowerShell. Sending it `nproc` and `free -g` because it happens to be
// reached over ssh is the same conflation of transport with dialect that made the baseline gate
// report the cockpit as unmanageable.
//
// This is the UNION of the two Windows scripts that used to exist, not the thinner of them. The
// local-only probe reported Docker containers and service names and looked at both C: and D:; the
// remote one did neither. Routing local nodes through this script without folding those lines in
// would have quietly dropped `containers`, `services` and the D: figure from the board for the one
// node the operator looks at most -- a UI regression smuggled in as a transport fix.
//
// The extra lines are safe on a remote Windows node: `docker ps` failures are swallowed to a count of
// 0, and `Get-PSDrive C,D -ErrorAction SilentlyContinue` simply omits a drive that is not there.
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

function parseProbe(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const index = line.indexOf("=")
    if (index > 0) fields[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return fields
}

async function probeNode(name: string, windows: boolean): Promise<Record<string, string>> {
  // Through the broker: an unknown node is denied rather than attempted, host keys are pinned, local
  // and remote transports are both handled there, and the probe appears in the same audit log as
  // every other action taken against this lab.
  const { stdout } = await brokeredExec(name, windows ? WINDOWS_PROBE : LINUX_PROBE, {
    timeout: PROBE_TIMEOUT_MS,
    action: "probe",
  })
  return parseProbe(stdout)
}

/**
 * Structured observations, emitted ALONGSIDE the existing string `fields`.
 *
 * Additive on purpose. `components/fabric/node-board.tsx` reads `fields`, and a consumer that has to
 * parse a presentation string to learn a fact is exactly what the System Object graph exists to
 * remove -- but breaking the board to prove the point would be a UI change this gate does not own.
 *
 * These carry no capability claim. Reachability is measured here, per request, because neither
 * registry owns it: the transport registry has no reachability field, and the inventory records
 * evidence freshness rather than whether a host answered a moment ago.
 */
interface NodeObservation {
  reachable: boolean
  /** Preserved verbatim. "unreachable" alone sends the reader looking in the wrong place. */
  detail: string | null
  observedAt: string
  durationMs: number
  /** The hostname the node reported about itself. Not an identity pin, and never used as one. */
  observedHostname: string | null
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
        const fields = await probeNode(name, node.os === "windows")
        const observation: NodeObservation = {
          reachable: true,
          detail: null,
          observedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          observedHostname: fields.host ?? null,
        }
        return { name, ...node, reachable: true, ms: observation.durationMs, fields, observation }
      } catch (error) {
        // The reason is kept: "unreachable" alone sends the reader looking in the wrong place, while
        // "permission denied" and "connection refused" point at completely different problems.
        const detail = String((error as { stderr?: string; message?: string })?.stderr || (error as Error)?.message || "")
          .split("\n")[0]
          .slice(0, 200)
        const observation: NodeObservation = {
          reachable: false,
          detail,
          observedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          observedHostname: null,
        }
        return { name, ...node, reachable: false, ms: observation.durationMs, detail, fields: {}, observation }
      }
    }),
  )

  return Response.json(
    { checkedAt: new Date().toISOString(), nodes },
    { headers: { "cache-control": "no-store" } },
  )
}
