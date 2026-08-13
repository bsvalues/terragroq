#!/usr/bin/node
import { spawnSync } from "node:child_process"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const NODE = "/usr/bin/node"
const LAUNCHER = "/usr/local/libexec/williamos-aegis-remote-dev-network-launcher.mjs"
const OPERATIONS = new Set([
  "PROVE_PREFLIGHT", "CREATE_WORKSPACE", "APPLY_RESERVED_PATCH", "RESTORE_DOTNET",
  "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE",
  "COMMIT_RESERVED_PATHS", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE", "CLEAN_EXACT_WORKSPACE",
])
const BASE64_SOURCE = "(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?"
const COMMAND = new RegExp(`^${NODE.replaceAll("/", "\\/")} ${LAUNCHER.replaceAll("/", "\\/")} (${BASE64_SOURCE}) (${[...OPERATIONS].join("|")}) (${BASE64_SOURCE}) '(${BASE64_SOURCE})' ([1-3]) (null|[a-f0-9]{64})$`)
const ACTIVATION_COMMAND = new RegExp(`^activation (${BASE64_SOURCE})$`)
const ACTIVATION_SOCKET = "/run/williamos-fabric/remote-dev-activation.sock"
const ACTIVATION_RELAY_TIMEOUT_MS = 60_000

function canonicalBase64(value, maximumBytes, allowEmpty = false) {
  if (!allowEmpty && value.length === 0) return false
  const bytes = Buffer.from(value, "base64")
  return bytes.length <= maximumBytes && (allowEmpty || bytes.length > 0) && bytes.toString("base64") === value
}

export function parseBoundedSshCommand(command) {
  if (typeof command !== "string" || command.length < 1 || command.length > 3_000_000 || command.includes("\0") || command.includes("\n") || command.includes("\r") || command.includes("\t") || command.trim() !== command || command.includes("  ")) throw new Error("SSH_ORIGINAL_COMMAND_FORMAT_INVALID")
  const activation = ACTIVATION_COMMAND.exec(command)
  if (activation) {
    if (!canonicalBase64(activation[1], 3_000_000)) throw new Error("SSH_ORIGINAL_COMMAND_ARGUMENT_INVALID")
    return { activationRequest: Buffer.from(activation[1], "base64") }
  }
  const match = COMMAND.exec(command)
  if (!match) throw new Error("SSH_ORIGINAL_COMMAND_NOT_ALLOWLISTED")
  const [, ticket, operation, packet, patchArgument, attempt, previous] = match
  if (!canonicalBase64(ticket, 65_536) || !canonicalBase64(packet, 1_048_576) || !canonicalBase64(patchArgument, 1_048_576, true)) throw new Error("SSH_ORIGINAL_COMMAND_ARGUMENT_INVALID")
  return { executable: NODE, args: [LAUNCHER, ticket, operation, packet, patchArgument, attempt, previous] }
}

function relayActivation(bytes) {
  const socket = net.createConnection(ACTIVATION_SOCKET)
  const chunks = []; let length = 0
  socket.setTimeout(ACTIVATION_RELAY_TIMEOUT_MS)
  socket.on("connect", () => socket.end(bytes))
  socket.on("data", value => { length += value.length; if (length > 1_048_576) return socket.destroy(new Error("activation bridge response too large")); chunks.push(value) })
  socket.on("end", () => { const response=Buffer.concat(chunks);process.stdout.write(response);try{const parsed=JSON.parse(response);if(parsed.status === "BLOCKED")process.exitCode=2}catch{process.exitCode=2} })
  socket.on("timeout", () => socket.destroy(new Error("activation bridge timeout")))
  socket.on("error", error => { process.stdout.write(`${JSON.stringify({ status: "BLOCKED", reasonCode: "ACTIVATION_BRIDGE_UNAVAILABLE", detail: String(error.message).slice(0, 256), executionAuthorized: false })}\n`); process.exitCode = 2 })
}

function main() {
  try {
    if (process.platform !== "linux") throw new Error("BOUNDED_TRANSPORT_LINUX_REQUIRED")
    const parsed = parseBoundedSshCommand(process.env.SSH_ORIGINAL_COMMAND)
    if (parsed.activationRequest) { relayActivation(parsed.activationRequest); return }
    const child = spawnSync(parsed.executable, parsed.args, { stdio: "inherit", env: Object.freeze({
      HOME: "/home/williamos-fabric",
      LANG: "C.UTF-8",
      LOGNAME: "williamos-fabric",
      PATH: "/usr/bin:/bin",
      USER: "williamos-fabric",
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "",
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? "",
    }) })
    if (child.error) throw child.error
    process.exitCode = Number.isInteger(child.status) ? child.status : 2
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "BLOCKED", reasonCode: "BOUNDED_TRANSPORT_REJECTED", detail: String(error?.message ?? error).slice(0, 256), executionAuthorized: false })}\n`)
    process.exitCode = 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
