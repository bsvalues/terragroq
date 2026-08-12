import { describe, expect, it, vi } from "vitest"

import {
  parseStandingSshCommand,
  runStandingSshEntrypoint,
} from "../scripts/execution-fabric/provision/aegis-standing-hash-ssh-entrypoint.mjs"

const NODE = "/usr/bin/node"
const BOOTSTRAP = "/usr/local/libexec/williamos/aegis-standing-hash-bootstrap.mjs"
const REQUEST = "standing-request-001"
const ADMISSION = "docs/reports/standing-dispatch/admission-001.json"
const REQUEST_FIRST = `${NODE} ${BOOTSTRAP} --request ${REQUEST} --admission ${ADMISSION}`

const baseEnv = () => ({
  SSH_CONNECTION: "192.168.88.9 49152 192.168.88.6 22",
  SSH_ORIGINAL_COMMAND: REQUEST_FIRST,
  ATTACKER_SECRET: "must-not-reach-child",
  NODE_OPTIONS: "--require=/tmp/attacker.cjs",
  PATH: "/tmp/attacker-bin",
})

function harness(overrides: Record<string, unknown> = {}) {
  const spawnSyncApi = vi.fn(() => ({ status: 0, error: undefined }))
  const options = {
    env: baseEnv(),
    platform: "linux",
    getuid: () => 1001,
    username: () => "williamos-fabric",
    spawnSyncApi,
    ...overrides,
  }
  return { options, spawnSyncApi }
}

describe("AEGIS standing hash SSH command admission", () => {
  it("accepts the exact request-first command", () => {
    expect(parseStandingSshCommand(REQUEST_FIRST)).toEqual({
      executable: NODE,
      args: [BOOTSTRAP, "--request", REQUEST, "--admission", ADMISSION],
    })
  })

  it.each([
    ["missing request option", `${NODE} ${BOOTSTRAP} --admission ${ADMISSION}`],
    ["missing admission option", `${NODE} ${BOOTSTRAP} --request ${REQUEST}`],
    ["missing request value", `${NODE} ${BOOTSTRAP} --request --admission ${ADMISSION}`],
    ["missing admission value", `${NODE} ${BOOTSTRAP} --request ${REQUEST} --admission`],
    ["duplicate request", `${REQUEST_FIRST} --request ${REQUEST}`],
    ["duplicate admission", `${REQUEST_FIRST} --admission ${ADMISSION}`],
    ["reversed option order", `${NODE} ${BOOTSTRAP} --admission ${ADMISSION} --request ${REQUEST}`],
    ["extra token", `${REQUEST_FIRST} unexpected`],
    ["alternate executable", `/bin/node ${BOOTSTRAP} --request ${REQUEST} --admission ${ADMISSION}`],
    ["relative executable", `node ${BOOTSTRAP} --request ${REQUEST} --admission ${ADMISSION}`],
    ["alternate bootstrap", `${NODE} /tmp/bootstrap.mjs --request ${REQUEST} --admission ${ADMISSION}`],
    ["environment assignment prefix", `NODE_OPTIONS=--inspect ${REQUEST_FIRST}`],
    ["env executable prefix", `/usr/bin/env SAFE=1 ${REQUEST_FIRST}`],
    ["quoted executable", `'${NODE}' ${BOOTSTRAP} --request ${REQUEST} --admission ${ADMISSION}`],
    ["quoted request", `${NODE} ${BOOTSTRAP} --request '${REQUEST}' --admission ${ADMISSION}`],
    ["quoted admission", `${NODE} ${BOOTSTRAP} --request ${REQUEST} --admission '${ADMISSION}'`],
  ])("rejects %s", (_label, command) => {
    expect(() => parseStandingSshCommand(command)).toThrow("SSH_ORIGINAL_COMMAND_NOT_ALLOWLISTED")
  })

  it.each([
    ["leading space", ` ${REQUEST_FIRST}`],
    ["trailing space", `${REQUEST_FIRST} `],
    ["repeated space", REQUEST_FIRST.replace(" --request", "  --request")],
    ["tab", REQUEST_FIRST.replace(" --request", "\t--request")],
    ["line feed", `${REQUEST_FIRST}\n`],
    ["carriage return", `${REQUEST_FIRST}\r`],
    ["embedded NUL", REQUEST_FIRST.replace(REQUEST, `${REQUEST}\0suffix`)],
  ])("rejects invalid command whitespace: %s", (_label, command) => {
    expect(() => parseStandingSshCommand(command)).toThrow("SSH_ORIGINAL_COMMAND_FORMAT_INVALID")
  })

  it.each([
    ["semicolon", `${REQUEST_FIRST}; id`],
    ["pipe", `${REQUEST_FIRST} | id`],
    ["output redirect", `${REQUEST_FIRST} > /tmp/result`],
    ["input redirect", `${REQUEST_FIRST} < /tmp/input`],
    ["and operator", `${REQUEST_FIRST} && id`],
    ["command substitution", REQUEST_FIRST.replace(REQUEST, "$(id)")],
    ["backticks", REQUEST_FIRST.replace(REQUEST, "`id`")],
  ])("rejects shell syntax: %s", (_label, command) => {
    expect(() => parseStandingSshCommand(command)).toThrow("SSH_ORIGINAL_COMMAND_NOT_ALLOWLISTED")
  })

  it.each([
    ["absolute path", "/tmp/admission.json"],
    ["traversal", "docs/reports/standing-dispatch/../admission.json"],
    ["nested path", "docs/reports/standing-dispatch/nested/admission.json"],
    ["backslash path", String.raw`docs\reports\standing-dispatch\admission.json`],
    ["NUL path", `docs/reports/standing-dispatch/admission\0.json`],
  ])("rejects unsafe admission path: %s", (_label, admission) => {
    const command = `${NODE} ${BOOTSTRAP} --request ${REQUEST} --admission ${admission}`
    const expected = admission.includes("\0")
      ? "SSH_ORIGINAL_COMMAND_FORMAT_INVALID"
      : "SSH_ORIGINAL_COMMAND_NOT_ALLOWLISTED"
    expect(() => parseStandingSshCommand(command)).toThrow(expected)
  })

  it.each([
    ["too short", "ab"],
    ["leading punctuation", "-request-001"],
    ["slash", "request/001"],
    ["traversal", "../request-001"],
    ["space", "request 001"],
    ["shell punctuation", "request;id"],
    ["NUL", "request\0id"],
  ])("rejects unsafe request ID: %s", (_label, request) => {
    const command = `${NODE} ${BOOTSTRAP} --request ${request} --admission ${ADMISSION}`
    const expected = request.includes("\0")
      ? "SSH_ORIGINAL_COMMAND_FORMAT_INVALID"
      : "SSH_ORIGINAL_COMMAND_NOT_ALLOWLISTED"
    expect(() => parseStandingSshCommand(command)).toThrow(expected)
  })
})

describe("runStandingSshEntrypoint", () => {
  it.each([
    ["wrong platform", { platform: "win32" }, "STANDING_TRANSPORT_LINUX_REQUIRED"],
    ["root UID", { getuid: () => 0 }, "STANDING_TRANSPORT_IDENTITY_REJECTED"],
    ["wrong user", { username: () => "root" }, "STANDING_TRANSPORT_IDENTITY_REJECTED"],
    ["wrong source IP", { env: { ...baseEnv(), SSH_CONNECTION: "192.168.1.99 49152 192.168.1.155 22" } }, "SSH_CONNECTION_SOURCE_REJECTED"],
    ["PTY", { env: { ...baseEnv(), SSH_TTY: "/dev/pts/0" } }, "STANDING_TRANSPORT_TTY_REJECTED"],
    ["empty PTY marker", { env: { ...baseEnv(), SSH_TTY: "" } }, "STANDING_TRANSPORT_TTY_REJECTED"],
    ["missing SSH command", { env: { SSH_CONNECTION: baseEnv().SSH_CONNECTION } }, "SSH_ORIGINAL_COMMAND_FORMAT_INVALID"],
  ])("rejects %s before spawning", (_label, overrides, code) => {
    const { options, spawnSyncApi } = harness(overrides)
    expect(() => runStandingSshEntrypoint(options)).toThrow(code)
    expect(spawnSyncApi).not.toHaveBeenCalled()
  })

  it("spawns only the fixed executable and arguments with shell disabled and a sanitized environment", () => {
    const { options, spawnSyncApi } = harness()

    expect(runStandingSshEntrypoint(options)).toBe(0)
    expect(spawnSyncApi).toHaveBeenCalledOnce()
    expect(spawnSyncApi).toHaveBeenCalledWith(
      NODE,
      [BOOTSTRAP, "--request", REQUEST, "--admission", ADMISSION],
      {
        env: {
          HOME: "/home/williamos-fabric",
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          LOGNAME: "williamos-fabric",
          PATH: "/usr/bin:/bin",
          USER: "williamos-fabric",
        },
        shell: false,
        stdio: "inherit",
      },
    )
    const childEnv = spawnSyncApi.mock.calls[0][2].env
    expect(childEnv).not.toHaveProperty("ATTACKER_SECRET")
    expect(childEnv).not.toHaveProperty("NODE_OPTIONS")
    expect(childEnv).not.toHaveProperty("SSH_ORIGINAL_COMMAND")
    expect(childEnv).not.toHaveProperty("SSH_CONNECTION")
  })

  it.each([0, 1, 42, 255])("propagates child exit status %i", (status) => {
    const spawnSyncApi = vi.fn(() => ({ status, error: undefined }))
    const { options } = harness({ spawnSyncApi })
    expect(runStandingSshEntrypoint(options)).toBe(status)
  })

  it("propagates a child spawn error", () => {
    const childError = new Error("spawn failed")
    const spawnSyncApi = vi.fn(() => ({ status: null, error: childError }))
    const { options } = harness({ spawnSyncApi })
    expect(() => runStandingSshEntrypoint(options)).toThrow(childError)
  })

  it("rejects a child without an integer exit status", () => {
    const spawnSyncApi = vi.fn(() => ({ status: null, error: undefined }))
    const { options } = harness({ spawnSyncApi })
    expect(() => runStandingSshEntrypoint(options)).toThrow("STANDING_TRANSPORT_CHILD_STATUS_INVALID")
  })
})
