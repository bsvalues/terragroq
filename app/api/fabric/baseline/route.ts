import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { getSession } from "@/lib/session"
import { PROBE_CONTAINER, type BaselineResult, type BaselineStepId } from "@/lib/fabric/baseline"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const run = promisify(execFile)
const FABRIC = process.env.WILLIAMOS_FABRIC_ROOT ?? path.join(os.homedir(), ".williamos", "fabric")
const STEP_TIMEOUT_MS = 60_000

interface NodeRecord { transport?: string; host?: string; user?: string }

function sshArgs(node: NodeRecord, command: string): string[] {
  return [
    "-i", path.join(FABRIC, "keys", "williamos-fabric"),
    "-o", `UserKnownHostsFile=${path.join(FABRIC, "known_hosts")}`,
    "-o", "StrictHostKeyChecking=yes",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    `${node.user}@${node.host}`,
    command,
  ]
}

/**
 * Run the six-step acceptance gate against one node.
 *
 * The file steps carry a random payload hashed on both sides rather than a fixed string, so a stale
 * copy left by an earlier run cannot be mistaken for a successful transfer -- "the file is there" and
 * "the file I just sent arrived intact" are different claims, and only the second one means the plane
 * can be trusted to deliver code.
 */
async function runNodeBaseline(name: string, node: NodeRecord): Promise<BaselineResult[]> {
  const results: BaselineResult[] = []
  const local = node.transport === "local"
  const payload = crypto.randomBytes(32).toString("hex")
  const digest = crypto.createHash("sha256").update(payload).digest("hex")
  const remoteFile = `/tmp/fabric-baseline-${digest.slice(0, 12)}.txt`

  const step = async (id: BaselineStepId, action: () => Promise<string>) => {
    const started = Date.now()
    try {
      const detail = await action()
      results.push({ node: name, step: id, ok: true, detail: detail.trim().slice(0, 160), ms: Date.now() - started })
      return true
    } catch (error) {
      const detail = String((error as { stderr?: string; message?: string })?.stderr || (error as Error)?.message || "")
        .split("\n")[0].slice(0, 160)
      results.push({ node: name, step: id, ok: false, detail, ms: Date.now() - started })
      return false
    }
  }

  const sh = async (command: string) => {
    if (local) {
      const { stdout } = await run("powershell", ["-NoProfile", "-Command", command], { timeout: STEP_TIMEOUT_MS, windowsHide: true })
      return stdout
    }
    const { stdout } = await run("ssh", sshArgs(node, command), { timeout: STEP_TIMEOUT_MS, windowsHide: true })
    return stdout
  }

  if (!(await step("reach", () => sh(local ? "$env:COMPUTERNAME" : "hostname")))) return results
  await step("containers", () => sh(local ? "(docker ps -q | Measure-Object).Count" : "docker ps -q | wc -l"))
  await step("start", () => sh(
    local
      ? `docker rm -f ${PROBE_CONTAINER} 2>$null | Out-Null; docker run -d --name ${PROBE_CONTAINER} alpine sleep 60`
      : `docker rm -f ${PROBE_CONTAINER} >/dev/null 2>&1; docker run -d --name ${PROBE_CONTAINER} alpine sleep 60`,
  ))

  // Push: written on the node, then hashed THERE. Hashing locally would only prove we can hash.
  await step("push", async () => {
    const out = local
      ? await sh(`Set-Content -NoNewline -Path "$env:TEMP\\${path.basename(remoteFile)}" -Value "${payload}"; (Get-FileHash "$env:TEMP\\${path.basename(remoteFile)}" -Algorithm SHA256).Hash.ToLower()`)
      : await sh(`printf %s '${payload}' > ${remoteFile} && sha256sum ${remoteFile} | cut -d' ' -f1`)
    const seen = out.trim().split(/\s+/).pop() ?? ""
    if (seen !== digest) throw new Error(`hash mismatch on node: ${seen.slice(0, 16)} != ${digest.slice(0, 16)}`)
    return `verified ${digest.slice(0, 12)}`
  })

  // Pull: read the bytes back and hash them here. A round trip that changes the content is a plane
  // that silently corrupts what it moves, which is worse than one that cannot move anything.
  await step("pull", async () => {
    const out = local
      ? await sh(`Get-Content -Raw "$env:TEMP\\${path.basename(remoteFile)}"`)
      : await sh(`cat ${remoteFile}`)
    const back = crypto.createHash("sha256").update(out.trim()).digest("hex")
    if (back !== digest) throw new Error(`round trip altered the file: ${back.slice(0, 16)} != ${digest.slice(0, 16)}`)
    return `round trip intact`
  })

  await step("stop", () => sh(
    local
      ? `docker rm -f ${PROBE_CONTAINER} | Out-Null; Remove-Item "$env:TEMP\\${path.basename(remoteFile)}" -ErrorAction SilentlyContinue; "cleaned"`
      : `docker rm -f ${PROBE_CONTAINER} >/dev/null 2>&1; rm -f ${remoteFile}; echo cleaned`,
  ))

  return results
}

export async function POST() {
  const session = await getSession()
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let registry: Record<string, NodeRecord>
  try {
    registry = JSON.parse(await fs.readFile(path.join(FABRIC, "nodes.json"), "utf8"))
  } catch {
    return Response.json({ error: "REGISTRY_UNAVAILABLE" }, { status: 503 })
  }

  const entries = Object.entries(registry)
  const all = await Promise.all(entries.map(([name, node]) => runNodeBaseline(name, node)))

  return Response.json(
    { ranAt: new Date().toISOString(), results: all.flat() },
    { headers: { "cache-control": "no-store" } },
  )
}
