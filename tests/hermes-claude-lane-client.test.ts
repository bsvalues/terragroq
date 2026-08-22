import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CLAUDE_LANE_ALLOWED_TOOLS,
  CLAUDE_LANE_CODES,
  CLAUDE_LANE_ID,
  CLAUDE_LANE_PERMISSION_MODE,
  CLAUDE_LANE_SESSION_ID_PATTERN,
  CLAUDE_LANE_STRIPPED_ENVIRONMENT_KEYS,
  ClaudeLaneClient,
  buildClaudeLaneResultChannelContract,
  claudeLaneThreadId,
  isClaudeLaneAvailable,
  resolveClaudeLaneBinary,
} from "../scripts/hermes-bridge/claude-lane-client.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "../scripts/hermes-bridge/prompt.mjs"

const roots: string[] = []

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-lane-"))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const readyResult = {
  result: "READY_FOR_VALIDATION",
  workOrder: "WO-HERMES-77-001",
  branch: "codex/hermes-goal-77-77",
  commit: null,
  prUrl: null,
  merged: false,
  mergeCommit: null,
  validation: ["pass"],
  reviewThreads: 0,
  ownerTouchCount: 0,
  blockedScopeCrossed: false,
  nextState: "READY_FOR_HERMES_MERGE",
  blockedAction: null,
  authorityBoundary: null,
  minimumChoice: null,
  approveConsequence: null,
  denyConsequence: null,
  findings: [],
}

/** The CLI's real `--output-format json` envelope shape, as observed from the installed binary. */
function envelope(sessionId: string, resultText: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: sessionId,
    num_turns: 1,
    result: resultText,
    ...overrides,
  })
}

function transcript(runId: string, body: unknown, prose = "I made the change.") {
  return [
    prose,
    `HERMES_TURN_OUTPUT runId=${runId}`,
    JSON.stringify(body),
    "HERMES_TURN_OUTPUT_END",
  ].join("\n")
}

type FakeChild = EventEmitter & {
  stdout: EventEmitter & { setEncoding?: () => void }
  stderr: EventEmitter & { setEncoding?: () => void }
  stdin: { end: () => void }
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} })
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} })
  child.stdin = { end: () => {} }
  child.kill = vi.fn()
  return child
}

/**
 * A CLI stand-in that answers each turn from a scripted list, and — crucially — remembers what it was
 * told. `conversation` is what proves continuity: a turn dispatched with `--resume` can see the
 * earlier turn's prompt, and a turn dispatched with `--session-id` starts empty.
 */
function scriptedSpawn(script: Array<(context: {
  args: string[]
  sessionId: string
  runId: string
  conversation: string[]
}) => { stdout?: string, stderr?: string, exitCode?: number, signal?: string | null }>) {
  const calls: Array<{ command: string, args: string[], options: any }> = []
  const conversation: string[] = []
  let index = 0
  const spawn = vi.fn((command: string, args: string[], options: any) => {
    calls.push({ command, args, options })
    const child = fakeChild()
    const resumed = args.includes("--resume")
    const sessionId = args[args.indexOf(resumed ? "--resume" : "--session-id") + 1]
    const prompt = args[args.indexOf("-p") + 1]
    const runId = /runId=([A-Za-z0-9-]+)/.exec(prompt)?.[1] ?? ""
    // A fresh `--session-id` conversation has forgotten everything; a `--resume` one has not.
    if (!resumed) conversation.length = 0
    const visible = [...conversation]
    conversation.push(prompt)
    const step = script[Math.min(index, script.length - 1)]
    index += 1
    queueMicrotask(() => {
      const outcome = step({ args, sessionId, runId, conversation: visible })
      if (outcome.stdout) child.stdout.emit("data", outcome.stdout)
      if (outcome.stderr) child.stderr.emit("data", outcome.stderr)
      child.emit("close", outcome.exitCode ?? 0, outcome.signal ?? null)
    })
    return child
  })
  return { spawn, calls, conversation }
}

function client(cwd: string, spawn: any, overrides: Record<string, unknown> = {}) {
  return new ClaudeLaneClient({
    cwd,
    workOrderId: "WO-HERMES-77-001",
    command: "/fake/claude",
    spawn,
    env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-live-must-not-travel", ANTHROPIC_AUTH_TOKEN: "tok-must-not-travel" },
    ...overrides,
  })
}

describe("claude lane thread identity", () => {
  it("mints a stable UUID session id per workspace, not a fresh one per call", () => {
    const cwd = workspace()
    const first = claudeLaneThreadId({ workspacePath: cwd, workOrderId: "WO-1" })
    const second = claudeLaneThreadId({ workspacePath: cwd, workOrderId: "WO-1" })
    expect(first).toBe(second)
    // Must be a real UUID: `--session-id` refuses anything else, so a non-UUID id would make native
    // continuity impossible rather than merely ugly.
    expect(first).toMatch(CLAUDE_LANE_SESSION_ID_PATTERN)
    expect(claudeLaneThreadId({ workspacePath: cwd, workOrderId: "WO-2" })).not.toBe(first)
  })

  it("does not leak the worktree path into the persisted id", () => {
    const cwd = workspace()
    expect(claudeLaneThreadId({ workspacePath: cwd })).not.toContain(path.basename(cwd))
  })

  it("survives a startThread/resumeThread round trip and rejects a foreign thread", async () => {
    const cwd = workspace()
    const { spawn } = scriptedSpawn([() => ({ stdout: "" })])
    const lane = client(cwd, spawn)
    await lane.connect()
    const threadId = await lane.startThread({ cwd })
    expect(await lane.resumeThread(threadId, { cwd })).toBe(threadId)
    // A checkpoint carrying another provider's thread id must not be silently adopted.
    await expect(lane.resumeThread("thread-77", { cwd })).rejects.toMatchObject({
      laneCode: CLAUDE_LANE_CODES.THREAD_UNKNOWN,
    })
  })
})

describe("claude lane turn execution", () => {
  it("returns a schema-valid finalText on the delimited result channel", async () => {
    const cwd = workspace()
    const { spawn, calls } = scriptedSpawn([
      ({ sessionId, runId }) => ({ stdout: envelope(sessionId, transcript(runId, readyResult)) }),
    ])
    const lane = client(cwd, spawn)
    await lane.connect()
    const threadId = await lane.startThread({ cwd })
    const turn = await lane.runTurn({ threadId, prompt: "Deliver WO-HERMES-77-001.", turn: { outputSchema: HERMES_TURN_OUTPUT_SCHEMA } })

    expect(turn).toMatchObject({ threadId, status: "completed" })
    expect(JSON.parse(turn.finalText)).toEqual(readyResult)
    // A bare JSON object, so the orchestrator's permissive first-brace/last-brace fallback is
    // unreachable from this lane.
    expect(turn.finalText.trim().startsWith("{")).toBe(true)
    expect(calls[0].args).toContain("--output-format")
    expect(calls[0].args).toContain("json")
  })

  it("mirrors the kernel's bounded invocation contract", async () => {
    const cwd = workspace()
    const { spawn, calls } = scriptedSpawn([
      ({ sessionId, runId }) => ({ stdout: envelope(sessionId, transcript(runId, readyResult)) }),
    ])
    const lane = client(cwd, spawn)
    await lane.connect()
    await lane.runTurn({ threadId: await lane.startThread({ cwd }), prompt: "Deliver." })
    const args = calls[0].args
    expect(args[args.indexOf("--permission-mode") + 1]).toBe(CLAUDE_LANE_PERMISSION_MODE)
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(CLAUDE_LANE_ALLOWED_TOOLS)
    expect(calls[0].options.cwd).toBe(cwd)
  })

  it("strips the credentials the child must never inherit", async () => {
    const cwd = workspace()
    const { spawn, calls } = scriptedSpawn([
      ({ sessionId, runId }) => ({ stdout: envelope(sessionId, transcript(runId, readyResult)) }),
    ])
    const lane = client(cwd, spawn)
    await lane.connect()
    await lane.runTurn({ threadId: await lane.startThread({ cwd }), prompt: "Deliver." })
    for (const key of CLAUDE_LANE_STRIPPED_ENVIRONMENT_KEYS) {
      expect(calls[0].options.env).not.toHaveProperty(key)
    }
    expect(JSON.stringify(calls[0].options.env)).not.toContain("must-not-travel")
    // Everything else still travels: the lane needs its ambient environment to resolve its session.
    expect(calls[0].options.env.PATH).toBe("/usr/bin")
  })

  it("carries the prior turn's context into the second turn instead of faking continuity", async () => {
    const cwd = workspace()
    const { spawn, calls } = scriptedSpawn([
      ({ sessionId, runId }) => ({ stdout: envelope(sessionId, transcript(runId, readyResult)) }),
      // Turn two answers from what it can actually SEE of turn one. If the lane had started a fresh
      // amnesiac invocation, `conversation` would be empty and this turn would return the wall
      // marker below — which is exactly the silent failure this test exists to catch.
      ({ sessionId, runId, conversation }) => ({
        stdout: envelope(sessionId, transcript(runId, {
          ...readyResult,
          validation: conversation.some((entry) => entry.includes("REMEDIATION-ANCHOR"))
            ? ["saw-first-turn"]
            : ["NO_PRIOR_CONTEXT"],
        })),
      }),
    ])
    const lane = client(cwd, spawn)
    await lane.connect()
    const threadId = await lane.startThread({ cwd })
    await lane.runTurn({ threadId, prompt: "Deliver REMEDIATION-ANCHOR." })
    const second = await lane.runTurn({ threadId, prompt: "Address the review findings." })

    expect(JSON.parse(second.finalText).validation).toEqual(["saw-first-turn"])
    // And it is the CLI's own session mechanism doing it, not a re-pasted transcript.
    expect(calls[0].args).toContain("--session-id")
    expect(calls[0].args[calls[0].args.indexOf("--session-id") + 1]).toBe(threadId)
    expect(calls[1].args).toContain("--resume")
    expect(calls[1].args[calls[1].args.indexOf("--resume") + 1]).toBe(threadId)
    expect(calls[1].args).not.toContain("--session-id")
  })

  it("resumes the native session after a checkpoint recovery, not a fresh conversation", async () => {
    const cwd = workspace()
    const { spawn, calls } = scriptedSpawn([
      ({ sessionId, runId }) => ({ stdout: envelope(sessionId, transcript(runId, readyResult)) }),
    ])
    const lane = client(cwd, spawn)
    await lane.connect()
    // What a later cycle does: it has a persisted thread id and resumes it.
    const threadId = await lane.resumeThread(claudeLaneThreadId({ workspacePath: cwd, workOrderId: "WO-HERMES-77-001" }), { cwd })
    await lane.runTurn({ threadId, prompt: "Continue." })
    expect(calls[0].args).toContain("--resume")
    expect(calls[0].args).not.toContain("--session-id")
  })
})

describe("claude lane process failure contract", () => {
  const cwd = () => workspace()

  it("walls when the binary cannot be located", async () => {
    const lane = new ClaudeLaneClient({
      cwd: cwd(),
      spawn: vi.fn(),
      env: { PATH: "" },
      existsSync: () => false,
      homedir: () => "/nowhere",
    })
    await expect(lane.connect()).rejects.toMatchObject({ code: CLAUDE_LANE_CODES.BINARY_MISSING })
  })

  it("walls when the workspace is not a directory", async () => {
    const root = workspace()
    const file = path.join(root, "not-a-directory")
    fs.writeFileSync(file, "x")
    const lane = new ClaudeLaneClient({ cwd: file, command: "/fake/claude", spawn: vi.fn() })
    await expect(lane.connect()).rejects.toMatchObject({ code: CLAUDE_LANE_CODES.WORKSPACE })
  })

  it("refuses to run a turn before connect", async () => {
    const lane = client(cwd(), vi.fn())
    await expect(lane.runTurn({ prompt: "Deliver." })).rejects.toMatchObject({
      code: CLAUDE_LANE_CODES.NOT_CONNECTED,
    })
  })

  it("types a process launch failure distinctly from a turn failure", async () => {
    const root = cwd()
    const spawn = vi.fn(() => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }) })
    const lane = client(root, spawn)
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.SPAWN_FAILED })
  })

  it("types an async spawn error too", async () => {
    const root = cwd()
    const child = fakeChild()
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit("error", Object.assign(new Error("EACCES"), { code: "EACCES" })))
      return child
    })
    const lane = client(root, spawn)
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.SPAWN_FAILED })
  })

  it("types a non-zero exit", async () => {
    const root = cwd()
    const { spawn } = scriptedSpawn([() => ({ stdout: "", stderr: "boom", exitCode: 2 })])
    const lane = client(root, spawn)
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.NONZERO_EXIT, code: "APP_SERVER_TURN_FAILED" })
  })

  it("types a killed process separately from a non-zero exit", async () => {
    const root = cwd()
    const { spawn } = scriptedSpawn([() => ({ stdout: "", exitCode: null as any, signal: "SIGKILL" })])
    const lane = client(root, spawn)
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.KILLED })
  })

  it("kills the child and rejects on timeout", async () => {
    const root = cwd()
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    const timers: Array<() => void> = []
    const lane = client(root, spawn, {
      setTimer: (fn: () => void) => { timers.push(fn); return { unref: () => {} } },
      clearTimer: () => {},
    })
    await lane.connect()
    const pending = lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver.", timeoutMs: 1_000 })
    expect(timers).toHaveLength(1)
    timers[0]()

    await expect(pending).rejects.toMatchObject({
      laneCode: CLAUDE_LANE_CODES.TIMEOUT,
      code: "APP_SERVER_TIMEOUT",
    })
    expect(child.kill).toHaveBeenCalledWith("SIGTERM")
    // The grace-window escalation is armed, so a child that ignores TERM is not left holding the tree.
    expect(timers).toHaveLength(2)
    timers[1]()
    expect(child.kill).toHaveBeenCalledWith("SIGKILL")
  })

  it("types empty stdout rather than treating silence as a result", async () => {
    const root = cwd()
    const { spawn } = scriptedSpawn([() => ({ stdout: "   \n", stderr: "warning: something" })])
    const lane = client(root, spawn)
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.EMPTY_STDOUT })
  })
})

describe("claude lane structured-output contract", () => {
  const run = async (stdout: string, overrides: Record<string, unknown> = {}) => {
    const cwd = workspace()
    const { spawn } = scriptedSpawn([() => ({ stdout })])
    const lane = client(cwd, spawn, overrides)
    await lane.connect()
    return lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." })
  }

  it("types a non-envelope stdout", async () => {
    await expect(run("I finished the work.")).rejects.toMatchObject({
      laneCode: CLAUDE_LANE_CODES.ENVELOPE_INVALID,
    })
  })

  it("types an envelope that is not a success result", async () => {
    const cwd = workspace()
    const { spawn } = scriptedSpawn([({ sessionId }) => ({
      stdout: envelope(sessionId, "", { subtype: "error_during_execution", is_error: true }),
    })])
    const lane = client(cwd, spawn)
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.TURN_ERROR })
  })

  it("walls when the CLI answers on a different session than the one asked for", async () => {
    const cwd = workspace()
    const { spawn } = scriptedSpawn([({ runId }) => ({
      // A forked session: continuity silently lost. This is the failure the check exists for.
      stdout: envelope("99999999-9999-4999-8999-999999999999", transcript(runId, readyResult)),
    })])
    const lane = client(cwd, spawn)
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.SESSION_MISMATCH })
  })

  it("fails closed on prose with no delimited result channel", async () => {
    const cwd = workspace()
    const { spawn } = scriptedSpawn([({ sessionId }) => ({
      stdout: envelope(sessionId, "I implemented it. Config was { \"result\": \"READY_FOR_VALIDATION\" } roughly."),
    })])
    const lane = client(cwd, spawn)
    await lane.connect()
    // The orchestrator's permissive brace scan would have accepted that quoted fragment. This lane
    // never offers it the chance.
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.RESULT_CHANNEL_MISSING })
  })

  it("fails closed when two delimited blocks compete", async () => {
    const cwd = workspace()
    const { spawn } = scriptedSpawn([({ sessionId, runId }) => ({
      stdout: envelope(sessionId, [
        transcript(runId, readyResult),
        transcript(runId, { ...readyResult, ownerTouchCount: 3 }),
      ].join("\n")),
    })])
    const lane = client(cwd, spawn)
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.RESULT_CHANNEL_AMBIGUOUS })
  })

  it("types malformed terminal JSON separately from a schema-invalid result", async () => {
    const cwd = workspace()
    const { spawn } = scriptedSpawn([({ sessionId, runId }) => ({
      stdout: envelope(sessionId, [
        `HERMES_TURN_OUTPUT runId=${runId}`,
        "{ not json at all",
        "HERMES_TURN_OUTPUT_END",
      ].join("\n")),
    })])
    const lane = client(cwd, spawn)
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.RESULT_MALFORMED })
  })

  it("types a schema-invalid result", async () => {
    const cwd = workspace()
    const { spawn } = scriptedSpawn([({ sessionId, runId }) => ({
      stdout: envelope(sessionId, transcript(runId, { ...readyResult, result: "ALL_GOOD" })),
    })])
    const lane = client(cwd, spawn)
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.RESULT_SCHEMA_INVALID })
  })

  it("never lets stderr reach finalText", async () => {
    const cwd = workspace()
    const { spawn } = scriptedSpawn([({ sessionId, runId }) => ({
      stdout: envelope(sessionId, transcript(runId, readyResult)),
      stderr: `HERMES_TURN_OUTPUT runId=${runId}\n${JSON.stringify({ ...readyResult, ownerTouchCount: 9 })}\nHERMES_TURN_OUTPUT_END`,
    })])
    const lane = client(cwd, spawn)
    await lane.connect()
    const turn = await lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." })
    // stderr forged a perfectly well-formed result block and it counted for nothing.
    expect(JSON.parse(turn.finalText).ownerTouchCount).toBe(0)
    expect(turn.finalText).not.toContain("9")
  })

  it("keeps provider prose out of the persisted error detail", async () => {
    const cwd = workspace()
    const secret = "sk-live-abcdefghijklmnopqrstuvwxyz"
    const { spawn } = scriptedSpawn([({ sessionId }) => ({
      stdout: envelope(sessionId, `I could not finish. You've hit your usage limit. Key was ${secret}.`),
    })])
    const lane = client(cwd, spawn)
    await lane.connect()
    const failure = await lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }).catch((error) => error)
    expect(failure.detail).toBe(`${CLAUDE_LANE_CODES.RESULT_CHANNEL_MISSING}`)
    expect(JSON.stringify(failure)).not.toContain(secret)
    // Critically: a claude-lane message containing "usage limit" must never be classified as a CODEX
    // usage limit, or the reroute would mark the wrong lane exhausted.
    expect(failure.usageLimit).toBe(false)
    expect(failure.evidenceDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("refuses a prompt that would exceed the argv budget", async () => {
    const cwd = workspace()
    const { spawn } = scriptedSpawn([() => ({ stdout: "" })])
    const lane = client(cwd, spawn, { maxPromptChars: 100 })
    await lane.connect()
    await expect(lane.runTurn({ threadId: await lane.startThread(), prompt: "Deliver." }))
      .rejects.toMatchObject({ laneCode: CLAUDE_LANE_CODES.PROMPT_TOO_LONG })
    expect(spawn).not.toHaveBeenCalled()
  })

  it("states the result channel and the canonical schema in the prompt it sends", () => {
    const contract = buildClaudeLaneResultChannelContract("run-abcdef0123456789")
    expect(contract).toContain("HERMES_TURN_OUTPUT runId=run-abcdef0123456789")
    expect(contract).toContain("HERMES_TURN_OUTPUT_END")
    expect(contract).toContain(JSON.stringify(HERMES_TURN_OUTPUT_SCHEMA))
  })
})

describe("claude lane availability", () => {
  it("reports unavailable when nothing resolves, and honours an explicit override", () => {
    expect(resolveClaudeLaneBinary({
      env: { PATH: "" }, platform: "linux", existsSync: () => false, homedir: () => "/nowhere",
    })).toBeNull()
    expect(isClaudeLaneAvailable({
      env: { WILLIAMOS_CLAUDE_LANE_BIN: "/opt/claude" }, existsSync: (p: string) => p === "/opt/claude",
    })).toBe(true)
    // An override that does not exist is not availability.
    expect(isClaudeLaneAvailable({
      env: { WILLIAMOS_CLAUDE_LANE_BIN: "/opt/claude" }, existsSync: () => false,
    })).toBe(false)
  })

  it("does not accept a .cmd/.bat shim node cannot spawn without a shell", () => {
    expect(resolveClaudeLaneBinary({
      env: { PATH: "C:\\bin" },
      platform: "win32",
      existsSync: (candidate: string) => candidate.endsWith("claude.cmd"),
      homedir: () => "C:\\Users\\x",
    })).toBeNull()
  })
})

describe("claude lane governance parity with the runtime-operator kernel", () => {
  it("invokes the provider under the same security rule the kernel already uses", async () => {
    // Sharing by import is not available in this direction: the kernel's `run()` is a module-private
    // execFile wrapper carrying Codex rate-limit matching, and scripts/runtime-operator/** is a
    // governance-blocked changed path (FORBIDDEN_CHANGED_PATH in orchestrator.mjs), so it can be
    // neither exported nor edited from here. The rule is therefore stated once in
    // claude-lane-client.mjs and PINNED against the kernel's source: if either side drifts, this
    // fails, which is the property sharing was for.
    const kernel = await import("node:fs/promises").then((io) => io.readFile(
      new URL("../scripts/runtime-operator/williamos-adapters.mjs", import.meta.url), "utf8",
    ))
    const claudeBranch = kernel.slice(kernel.indexOf(`lane.id === "${CLAUDE_LANE_ID}"`))
      .slice(0, 1_500)
    expect(claudeBranch).toContain(`"--permission-mode", "${CLAUDE_LANE_PERMISSION_MODE}"`)
    expect(claudeBranch).toContain(`"--allowedTools", "${CLAUDE_LANE_ALLOWED_TOOLS}"`)
    for (const key of CLAUDE_LANE_STRIPPED_ENVIRONMENT_KEYS) {
      expect(claudeBranch).toContain(`delete environment.${key}`)
    }
  })
})
