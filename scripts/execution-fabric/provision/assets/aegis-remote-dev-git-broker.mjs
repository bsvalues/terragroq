#!/usr/bin/node
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { authorizeGitOperation } from "./aegis-remote-dev-runtime-authority.mjs"

const REPOSITORY = "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001/repository"
const REMOTE = "ssh://git@ssh.github.com:443/bsvalues/terrafusion_os_1.0.git"
const KEY = "/run/credentials/williamos-aegis-remote-dev-git-broker.service/github_account_key"
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const ENV = Object.freeze({ HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" })

function canonical(value) { return value === null ? "null" : typeof value === "string" ? JSON.stringify(value) : typeof value === "number" ? JSON.stringify(value) : typeof value === "boolean" ? String(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` }
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
function run(args, extraEnv = {}) {
  const result = spawnSync("/usr/bin/git", args, { encoding: "utf8", shell: false, timeout: 300_000, maxBuffer: 1_048_576, env: { ...ENV, ...extraEnv } })
  if (result.error || result.status !== 0) throw new Error("bounded Git operation failed")
  return String(result.stdout ?? "").trim()
}
function packet(packetB64, expectedSha256) {
  if (!BASE64.test(packetB64)) throw new Error("packet encoding differs")
  const bytes = Buffer.from(packetB64, "base64")
  if (bytes.length < 3 || bytes.length > 1_048_576 || bytes.toString("base64") !== packetB64 || digest(bytes) !== expectedSha256) throw new Error("packet binding differs")
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  if (value.workOrderId !== "WO-TF-REMOTE-DEV-OFFLOAD-001" || value.repository !== "bsvalues/terrafusion_os_1.0" || value.workspace !== "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001"
    || !/^codex\/wo-tf-remote-dev-offload-001-[a-z0-9-]+$/.test(value.branch) || !/^[0-9a-f-]{36}$/.test(value.runId)) throw new Error("packet push authority differs")
  return value
}
function exactCredential() {
  const stat = fs.lstatSync(KEY)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o400) throw new Error("credential delivery differs")
}
function execute(request) {
  if (!request || typeof request !== "object" || Array.isArray(request) || JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(["packetB64", "ticketB64"]) || !BASE64.test(request.ticketB64) || !BASE64.test(request.packetB64)) throw new Error("request fields differ")
  const decodedTicket = JSON.parse(Buffer.from(request.ticketB64, "base64").toString("utf8"))
  const operation = decodedTicket?.payload?.operation
  const authorization = authorizeGitOperation(request.ticketB64, request.packetB64, operation)
  const bound = packet(request.packetB64, authorization.payload.packetSha256)
  if (bound.runId !== authorization.payload.runId) throw new Error("run binding differs")
  exactCredential()
  const proxy = "/usr/bin/node /usr/local/libexec/williamos-aegis-remote-dev-proxy-connect.mjs %h %p"
  const ssh = `/usr/bin/ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o GlobalKnownHostsFile=/etc/williamos-fabric/github_known_hosts -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o IdentityFile=${KEY} -o ProxyCommand=${JSON.stringify(proxy)}`
  const gitEnv = { GIT_SSH_COMMAND: ssh, WILLIAMOS_NETWORK_TICKET_B64: request.ticketB64, WILLIAMOS_NETWORK_OPERATION: operation }
  let head = bound.baseSha
  if (operation === "PROVE_PREFLIGHT") {
    const temporary = fs.mkdtempSync(`/run/williamos-fabric/git-preflight-${authorization.payload.ticketId}-`)
    try {
      run(["ls-remote", "--exit-code", REMOTE, "refs/heads/main"], gitEnv)
      run(["init", "--bare", temporary])
      run(["-C", temporary, "fetch", "--depth=1", REMOTE, bound.baseSha], gitEnv)
      run(["-c", "core.hooksPath=/dev/null", "-C", temporary, "push", "--dry-run", REMOTE, `${bound.baseSha}:refs/heads/williamos-preflight-${bound.runId}`], gitEnv)
    } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
  } else if (operation === "CREATE_WORKSPACE") {
    if (fs.existsSync(REPOSITORY)) throw new Error("repository already exists")
    const parent = fs.realpathSync(path.dirname(REPOSITORY))
    if (parent !== "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001") throw new Error("workspace parent differs")
    run(["clone", "--no-checkout", "--origin", "origin", REMOTE, REPOSITORY], gitEnv)
    run(["-C", REPOSITORY, "fetch", "--no-tags", "origin", "main"], gitEnv)
    if (run(["--no-replace-objects", "-C", REPOSITORY, "rev-parse", "origin/main"]) !== bound.baseSha) throw new Error("fresh base differs")
  } else {
    if (fs.realpathSync(REPOSITORY) !== REPOSITORY || fs.lstatSync(REPOSITORY).isSymbolicLink()) throw new Error("repository path differs")
    if (run(["-C", REPOSITORY, "remote", "get-url", "origin"]) !== REMOTE || run(["-C", REPOSITORY, "status", "--porcelain"]) !== "") throw new Error("repository state differs")
    head = run(["--no-replace-objects", "-C", REPOSITORY, "rev-parse", "HEAD"])
    if (!/^[a-f0-9]{40}$/.test(head)) throw new Error("repository head differs")
    if (operation === "PUSH_AUTHORIZED_BRANCH") {
      const marker = "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001/.williamos-commit-created"
      const markerStat = fs.lstatSync(marker); const markerValue = fs.readFileSync(marker, "utf8")
      if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1 || markerValue !== `${head}\n`) throw new Error("committed-head marker differs")
      run(["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-C", REPOSITORY, "push", "origin", `HEAD:refs/heads/${bound.branch}`], gitEnv)
    }
    else run(["-C", REPOSITORY, "fetch", "--no-tags", "origin", "main"], gitEnv)
  }
  return { head, reasonCode: "GIT_OPERATION_VERIFIED", status: "GIT_OPERATION_VERIFIED" }
}

const server = net.createServer((socket) => {
  server.close()
  let bytes = Buffer.alloc(0)
  socket.setTimeout(30_000)
  socket.on("data", (chunk) => { bytes = Buffer.concat([bytes, chunk]); if (bytes.length > 1_600_000) socket.destroy() })
  socket.once("timeout", () => socket.destroy())
  socket.once("end", () => {
    try {
      if (!bytes.length || bytes.at(-1) !== 10 || bytes.subarray(0, -1).includes(10)) throw new Error("request framing differs")
      socket.end(`${canonical(execute(JSON.parse(bytes.subarray(0, -1).toString("utf8"))))}\n`)
    } catch { socket.end(`${canonical({ head: null, reasonCode: "GIT_BROKER_REJECTED", status: "BLOCKED" })}\n`) }
  })
})
server.maxConnections = 1
server.on("error", () => { process.exitCode = 2 })
server.listen({ fd: 3 })
