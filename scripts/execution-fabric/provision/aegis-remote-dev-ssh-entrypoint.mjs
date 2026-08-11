#!/usr/bin/node
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const NODE = "/usr/bin/node"
const LAUNCHER = "/usr/local/libexec/williamos-aegis-remote-dev-network-launcher.mjs"
const OPERATIONS = new Set([
  "PROVE_PREFLIGHT", "CREATE_WORKSPACE", "APPLY_RESERVED_PATCH", "RESTORE_DOTNET",
  "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE",
  "COMMIT_RESERVED_PATHS", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE", "CLEAN_EXACT_WORKSPACE",
])
const TOKEN = /^[A-Za-z0-9_-]{1,131072}$/
const PATCH = /^(?:-|[A-Za-z0-9_-]{1,131072})$/
const ATTEMPT = /^(?:[1-9]|1[0-6])$/
const PREVIOUS = /^(?:GENESIS|[a-f0-9]{64})$/

export function parseBoundedSshCommand(command) {
  if (typeof command !== "string" || command.length < 1 || command.length > 524_288 || command.includes("\0") || command.includes("\n") || command.includes("\r") || command.includes("\t") || command.trim() !== command || command.includes("  ")) throw new Error("SSH_ORIGINAL_COMMAND_FORMAT_INVALID")
  const parts = command.split(" ")
  if (parts.length !== 8 || parts[0] !== NODE || parts[1] !== LAUNCHER) throw new Error("SSH_ORIGINAL_COMMAND_NOT_ALLOWLISTED")
  const [, , ticket, operation, packet, patchArgument, attempt, previous] = parts
  if (!TOKEN.test(ticket) || !OPERATIONS.has(operation) || !TOKEN.test(packet) || !PATCH.test(patchArgument) || !ATTEMPT.test(attempt) || !PREVIOUS.test(previous)) throw new Error("SSH_ORIGINAL_COMMAND_ARGUMENT_INVALID")
  return { executable: NODE, args: [LAUNCHER, ticket, operation, packet, patchArgument, attempt, previous] }
}

function main() {
  try {
    if (process.platform !== "linux") throw new Error("BOUNDED_TRANSPORT_LINUX_REQUIRED")
    const parsed = parseBoundedSshCommand(process.env.SSH_ORIGINAL_COMMAND)
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
