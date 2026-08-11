#!/usr/bin/node
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const NODE = "/usr/bin/node"
const BOOTSTRAP = "/usr/local/libexec/williamos/aegis-standing-hash-bootstrap.mjs"
const SOURCE_IP = "192.168.1.154"
const SAFE_ID = "[A-Za-z0-9][A-Za-z0-9._-]{2,255}"
const ADMISSION = `docs/reports/standing-dispatch/(${SAFE_ID}\\.json)`
const regexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const FIXED_COMMAND = `${regexEscape(NODE)} ${regexEscape(BOOTSTRAP)}`
const REQUEST_FIRST = new RegExp(`^${FIXED_COMMAND} --request (${SAFE_ID}) --admission ${ADMISSION}$`)
const FIXED_ENV = Object.freeze({
  HOME: "/home/williamos-fabric",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  LOGNAME: "williamos-fabric",
  PATH: "/usr/bin:/bin",
  USER: "williamos-fabric",
})

function reject(code) {
  throw new Error(code)
}

function parseSshConnection(connection) {
  if (typeof connection !== "string" || connection.includes("\0") || /[\r\n\t]/.test(connection)) {
    reject("SSH_CONNECTION_INVALID")
  }
  const fields = connection.split(" ")
  if (fields.length !== 4 || fields.some((field) => field.length === 0) || fields[0] !== SOURCE_IP) {
    reject("SSH_CONNECTION_SOURCE_REJECTED")
  }
  for (const port of [fields[1], fields[3]]) {
    if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      reject("SSH_CONNECTION_INVALID")
    }
  }
  if (!/^[A-Fa-f0-9:.]+$/.test(fields[2])) reject("SSH_CONNECTION_INVALID")
}

export function parseStandingSshCommand(command) {
  if (typeof command !== "string" || command.length < 1 || command.length > 1024
    || command.trim() !== command || command.includes("\0") || /[\r\n\t]/.test(command)
    || command.includes("  ")) {
    reject("SSH_ORIGINAL_COMMAND_FORMAT_INVALID")
  }

  let match = REQUEST_FIRST.exec(command)
  if (match) {
    const [, request, admissionFile] = match
    return {
      executable: NODE,
      args: [BOOTSTRAP, "--request", request, "--admission", `docs/reports/standing-dispatch/${admissionFile}`],
    }
  }

  reject("SSH_ORIGINAL_COMMAND_NOT_ALLOWLISTED")
}

export function runStandingSshEntrypoint({
  env = process.env,
  platform = process.platform,
  getuid = process.getuid,
  username = () => os.userInfo().username,
  spawnSyncApi = spawnSync,
} = {}) {
  if (platform !== "linux") reject("STANDING_TRANSPORT_LINUX_REQUIRED")
  const uid = typeof getuid === "function" ? getuid() : undefined
  if (!Number.isSafeInteger(uid) || uid <= 0 || username() !== "williamos-fabric") {
    reject("STANDING_TRANSPORT_IDENTITY_REJECTED")
  }
  if (Object.hasOwn(env, "SSH_TTY")) reject("STANDING_TRANSPORT_TTY_REJECTED")
  parseSshConnection(env.SSH_CONNECTION)
  const parsed = parseStandingSshCommand(env.SSH_ORIGINAL_COMMAND)
  const child = spawnSyncApi(parsed.executable, parsed.args, {
    env: FIXED_ENV,
    shell: false,
    stdio: "inherit",
  })
  if (child.error) throw child.error
  if (!Number.isInteger(child.status)) reject("STANDING_TRANSPORT_CHILD_STATUS_INVALID")
  return child.status
}

function main() {
  try {
    process.exitCode = runStandingSshEntrypoint()
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schema_version: "1.0-aegis-standing-ssh-entrypoint-error",
      status: "FAILED_CLOSED",
      code: "AEGIS_STANDING_SSH_ENTRYPOINT_REJECTED",
      detail: String(error?.message ?? error).slice(0, 256),
      execution_authorized: false,
      scheduler_activated: false,
      network_accessed: false,
    })}\n`)
    process.exitCode = 2
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
