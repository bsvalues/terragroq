/**
 * The `claude` implementation lane, spoken as the orchestrator's client surface.
 *
 * `scripts/runtime-operator/worker-lanes.mjs` states the policy in its header: "provider exhaustion
 * reroutes when another approved lane can satisfy the work order -- parking as a typed timed wait
 * only when nothing capable remains". The runtime-operator kernel implements it; the hermes-bridge
 * dispatch path could not, because the only client it knew how to build speaks the Codex App Server
 * JSON-RPC protocol. So an exhausted Codex meter parked work for days while an approved,
 * authenticated `claude` lane sat idle. This module is the missing executor: the same five-method
 * surface the orchestrator consumes (`connect`, `startThread`, `resumeThread`, `runTurn`, `close`),
 * backed by the local `claude` CLI instead of an App Server.
 *
 * It is a PROVIDER ADAPTER BENEATH HERMES, not a second orchestration system. It owns no agent loop,
 * no validators, no Git, no GitHub, no policy. It runs one bounded CLI turn inside the worktree the
 * host already prepared and hands back the turn JSON. Every wall, checkpoint, lease, reservation and
 * completion gate stays where it already is.
 *
 * Three properties are load-bearing and each is enforced here rather than assumed:
 *
 * 1. THREAD CONTINUITY IS REAL. Hermes runs multiple turns against one thread -- remediation, review
 *    follow-up, owner-decision resume. A `resumeThread` that quietly started a fresh, amnesiac CLI
 *    invocation would turn stateful remediation into unrelated one-shot prompts and would still look
 *    green. So this lane uses the CLI's NATIVE session mechanism: `--session-id <uuid>` opens the
 *    conversation, `--resume <uuid>` continues it, and the `session_id` the CLI reports back is
 *    checked against the id we asked for on every single turn. A mismatch is a wall, not a warning.
 *    Verified live before this was written: a `--resume` turn recalled the prior turn's content and
 *    returned the same session id (no fork).
 *
 * 2. THE RESULT ARRIVES ON A DELIBERATELY DELIMITED CHANNEL. `parseTurnResult` in the orchestrator
 *    falls back to scanning from the first `{` to the last `}`. That is tolerable for an App Server
 *    frame and dangerous for a CLI transcript, where arbitrary prose containing braces could be
 *    coerced into a "result". This executor therefore never hands a transcript to that fallback. It
 *    takes stdout as ONE `--output-format json` envelope, reads the assistant text out of it, and
 *    accepts only a block delimited by a per-run sentinel minted for this turn. Zero blocks and two
 *    blocks are both walls. What it returns is a canonical re-serialisation of the validated object,
 *    so the permissive fallback is unreachable by construction. stderr NEVER reaches `finalText`; it
 *    is diagnostic evidence, kept only as a digest.
 *
 * 3. NOTHING VERBATIM ESCAPES. The transcript is passed through `sanitizeAppServerText` before it is
 *    parsed, and error `detail` is a typed token plus a digest -- never provider prose. Both matter:
 *    the orchestrator persists `error.detail` into a durable checkpoint, and
 *    `AppServerTurnEndedError` classifies its detail as a Codex usage limit, so raw text here could
 *    both leak and mark the wrong lane exhausted.
 */

import { spawn as nodeSpawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  AppServerTimeoutError,
  AppServerTurnEndedError,
  AppServerWallError,
  sanitizeAppServerText,
} from "./app-server-client.mjs"
import {
  sentinelBlocks,
  TURN_OUTPUT_SENTINEL_CLOSE,
  TURN_OUTPUT_SENTINEL_OPEN,
  validateAgainstTurnSchema,
} from "./hermes-kernel-output.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "./prompt.mjs"

/** The roster id this executor serves; must match `laneRoster()`'s claude lane. */
export const CLAUDE_LANE_ID = "claude"

/**
 * The invocation contract, shared with the runtime-operator kernel rather than re-decided.
 *
 * The kernel already invokes this exact provider (`williamos-adapters.mjs`, the `claude` branch of
 * `invokeCodex`) with `--permission-mode acceptEdits`, `--allowedTools "Edit Write Read Grep Glob
 * LS"`, and ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN deleted from the child environment. Two Claude
 * invocation paths with slightly different security rules is exactly the liability to avoid, so these
 * constants are the single statement of the rule and `tests/hermes-claude-lane-client.test.ts` pins
 * them against the kernel's source: if either side drifts, that test fails.
 *
 * The kernel's own `run()` helper is NOT reused, and deliberately so -- see the report/tests: it is a
 * module-private `execFile` wrapper carrying Codex rate-limit string matching and `PROCESS_WALL`
 * semantics, and `scripts/runtime-operator/**` is a governance-blocked changed path
 * (`FORBIDDEN_CHANGED_PATH` in orchestrator.mjs), so it can be neither exported nor edited from here.
 * What is genuinely shared is the security rule above, pinned by test.
 */
export const CLAUDE_LANE_PERMISSION_MODE = "acceptEdits"
export const CLAUDE_LANE_ALLOWED_TOOLS = "Edit Write Read Grep Glob LS"
export const CLAUDE_LANE_STRIPPED_ENVIRONMENT_KEYS = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
])

/**
 * Typed lane failures. Every rejection out of this module carries one as `laneCode`.
 *
 * Process behaviour is part of the execution contract, so launch, exit, signal, timeout and each
 * distinct output defect get their own code rather than collapsing into one "it failed".
 */
export const CLAUDE_LANE_CODES = Object.freeze({
  BINARY_MISSING: "CLAUDE_LANE_BINARY_MISSING",
  WORKSPACE: "CLAUDE_LANE_WORKSPACE",
  NOT_CONNECTED: "CLAUDE_LANE_NOT_CONNECTED",
  THREAD_UNKNOWN: "CLAUDE_LANE_THREAD_UNKNOWN",
  SESSION_MISMATCH: "CLAUDE_LANE_SESSION_MISMATCH",
  PROMPT_INVALID: "CLAUDE_LANE_PROMPT_INVALID",
  PROMPT_TOO_LONG: "CLAUDE_LANE_PROMPT_TOO_LONG",
  SPAWN_FAILED: "CLAUDE_LANE_SPAWN_FAILED",
  TIMEOUT: "CLAUDE_LANE_TIMEOUT",
  KILLED: "CLAUDE_LANE_KILLED",
  NONZERO_EXIT: "CLAUDE_LANE_NONZERO_EXIT",
  OUTPUT_LIMIT: "CLAUDE_LANE_OUTPUT_LIMIT",
  EMPTY_STDOUT: "CLAUDE_LANE_EMPTY_STDOUT",
  ENVELOPE_INVALID: "CLAUDE_LANE_ENVELOPE_INVALID",
  TURN_ERROR: "CLAUDE_LANE_TURN_ERROR",
  RESULT_CHANNEL_MISSING: "CLAUDE_LANE_RESULT_CHANNEL_MISSING",
  RESULT_CHANNEL_AMBIGUOUS: "CLAUDE_LANE_RESULT_CHANNEL_AMBIGUOUS",
  RESULT_MALFORMED: "CLAUDE_LANE_RESULT_MALFORMED",
  RESULT_SCHEMA_INVALID: "CLAUDE_LANE_RESULT_SCHEMA_INVALID",
})

const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000
const DEFAULT_KILL_GRACE_MS = 5_000
const DEFAULT_MAX_PROMPT_CHARS = 30_000
const DEFAULT_MAX_OUTPUT_CHARS = 16 * 1024 * 1024
const MAX_TURN_DETAIL_CHARS = 200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

function laneWall(code, method) {
  const error = new AppServerWallError(code, method)
  error.laneCode = code
  error.lane = CLAUDE_LANE_ID
  return error
}

/**
 * The native session id this lane uses for one worktree, as a stable UUID.
 *
 * It has to be a UUID because that is what `--session-id` accepts, and it has to be DETERMINISTIC
 * because the orchestrator persists whatever `startThread` returns into a durable checkpoint and
 * hands it back on a later cycle -- a fresh random id per call would leave every checkpoint pointing
 * at a conversation nobody can name. Derived from the workspace (and work order, when known) so the
 * same worktree keeps the same conversation, and the digest rather than the raw path is what travels.
 */
export function claudeLaneThreadId({ workspacePath, workOrderId = null } = {}) {
  const material = JSON.stringify([
    "hermes-claude-lane.v1",
    path.resolve(requiredString(workspacePath, "workspacePath")),
    typeof workOrderId === "string" && workOrderId.trim() !== "" ? workOrderId.trim() : null,
  ])
  const hex = createHash("sha256").update(material).digest("hex")
  const variant = "89ab"[parseInt(hex[16], 16) % 4]
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-")
}

/**
 * Locate the `claude` CLI, or null when it cannot be proven present.
 *
 * Null is a finding, not an inconvenience: the reroute may only claim this lane when the binary
 * actually exists on THIS host. (It exists on the workstation and not on AEGIS, so "the roster lists
 * it" is not evidence.) `.cmd`/`.bat` shims are deliberately not accepted: Node refuses to spawn them
 * without `shell: true`, and turning on a shell to accommodate one packaging choice would put a
 * command-injection surface under a prompt-carrying argv.
 */
export function resolveClaudeLaneBinary({
  env = process.env,
  platform = process.platform,
  existsSync = fs.existsSync,
  homedir = os.homedir,
} = {}) {
  const leaves = platform === "win32" ? ["claude.exe", "claude"] : ["claude"]
  const override = env?.WILLIAMOS_CLAUDE_LANE_BIN
  if (typeof override === "string" && override.trim() !== "") {
    try { return existsSync(override) ? override : null } catch { return null }
  }
  let home = ""
  try { home = homedir() ?? "" } catch { home = "" }
  const roots = []
  if (home) roots.push(path.join(home, ".local", "bin"))
  const pathKey = Object.keys(env ?? {}).find((key) => key.toUpperCase() === "PATH")
  const separator = platform === "win32" ? ";" : ":"
  for (const entry of String(env?.[pathKey] ?? "").split(separator)) {
    if (entry.trim() !== "") roots.push(entry)
  }
  for (const root of roots) {
    for (const leaf of leaves) {
      const candidate = path.join(root, leaf)
      try { if (existsSync(candidate)) return candidate } catch { /* unreadable entry is not a match */ }
    }
  }
  return null
}

/** Whether this host can actually serve the claude lane right now. */
export function isClaudeLaneAvailable(options = {}) {
  return resolveClaudeLaneBinary(options) !== null
}

/**
 * The terminal-result channel contract, appended to the Hermes prompt.
 *
 * The bridge prompt states WHAT the worker must report; this states the one channel Hermes will read
 * it from. The run id is minted for this turn only, so repository content the worker quotes cannot
 * pre-forge a delimited answer block -- forging one would require knowing a value that did not exist
 * when the content was written.
 */
export function buildClaudeLaneResultChannelContract(runId) {
  requiredString(runId, "runId")
  return [
    "TERMINAL RESULT CHANNEL (Hermes reads only this):",
    `Finish your final message by printing a line reading exactly "${TURN_OUTPUT_SENTINEL_OPEN} runId=${runId}", then exactly one JSON object satisfying the schema below, then a line reading exactly "${TURN_OUTPUT_SENTINEL_CLOSE}".`,
    "Emit that pair of lines exactly once, around the answer object only, and never around anything you quote from a file. Nothing outside those two lines is read as your result.",
    "Do not commit, push, open PRs, or touch paths outside the reservations named above.",
    JSON.stringify(HERMES_TURN_OUTPUT_SCHEMA),
  ].join("\n")
}

/**
 * A claude-lane executor with the five-method surface the Hermes orchestrator consumes.
 *
 * `spawn` and every timer are injected so the surface is testable without launching a real CLI.
 */
export class ClaudeLaneClient {
  /** @param {any} options */
  constructor({
    cwd,
    workOrderId = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    spawn = nodeSpawn,
    command = null,
    env = null,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    maxPromptChars = DEFAULT_MAX_PROMPT_CHARS,
    maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
    existsSync = fs.existsSync,
    statSync = fs.statSync,
    platform = process.platform,
    homedir = os.homedir,
  } = {}) {
    this.cwd = requiredString(cwd, "cwd")
    this.workOrderId = typeof workOrderId === "string" && workOrderId.trim() !== "" ? workOrderId.trim() : null
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
    this.spawn = spawn
    this.command = typeof command === "string" && command.trim() !== "" ? command : null
    this.env = env
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.killGraceMs = killGraceMs
    this.maxPromptChars = maxPromptChars
    this.maxOutputChars = maxOutputChars
    this.existsSync = existsSync
    this.statSync = statSync
    this.platform = platform
    this.homedir = homedir
    this.lane = CLAUDE_LANE_ID
    this.threadId = claudeLaneThreadId({ workspacePath: this.cwd, workOrderId: this.workOrderId })
    this.connected = false
    this.child = null
    /**
     * Which native session flag the next turn uses. `startThread` opens the conversation, everything
     * afterwards -- a resumed cycle, or simply the second turn of a remediation loop -- continues it.
     * This is the whole of thread continuity, and it is why the field is set in three places rather
     * than one: a turn that succeeded is a turn the next prompt must be able to see.
     */
    this.sessionOpened = false
    this.turnCount = 0
  }

  /** The env the child sees: the ambient environment minus the credentials it must not inherit. */
  childEnvironment() {
    const environment = { ...(this.env ?? process.env) }
    const stripped = new Set(CLAUDE_LANE_STRIPPED_ENVIRONMENT_KEYS)
    for (const key of Object.keys(environment)) {
      if (stripped.has(key.toUpperCase())) delete environment[key]
    }
    return environment
  }

  /**
   * Prove the lane can actually run before anything is dispatched to it: a resolvable binary and an
   * existing workspace directory. Both are walls, because a lane that cannot run must say so at
   * connect rather than surfacing as a mysterious failed turn after a lease has been taken.
   */
  async connect() {
    if (this.connected) return
    const binary = this.command ?? resolveClaudeLaneBinary({
      env: this.env ?? process.env,
      platform: this.platform,
      existsSync: this.existsSync,
      homedir: this.homedir,
    })
    if (!binary) throw laneWall(CLAUDE_LANE_CODES.BINARY_MISSING, "connect")
    let directory = false
    try {
      directory = this.statSync(this.cwd, { throwIfNoEntry: false })?.isDirectory() === true
    } catch { directory = false }
    if (!directory) throw laneWall(CLAUDE_LANE_CODES.WORKSPACE, "connect")
    this.command = binary
    this.connected = true
  }

  #assertConnected(method) {
    if (!this.connected) throw laneWall(CLAUDE_LANE_CODES.NOT_CONNECTED, method)
  }

  /**
   * A caller-supplied cwd must be the one this client was built for. The orchestrator passes the
   * worktree it prepared on every call; honouring a different one would run the lane against a tree
   * this client never verified.
   */
  #assertWorkspace(params, method) {
    const requested = params?.cwd
    if (requested === undefined || requested === null) return
    if (typeof requested !== "string" || path.resolve(requested) !== path.resolve(this.cwd)) {
      throw laneWall(CLAUDE_LANE_CODES.WORKSPACE, method)
    }
  }

  /** Open the conversation. The next turn mints the native session with `--session-id`. */
  async startThread(params = {}) {
    this.#assertConnected("startThread")
    this.#assertWorkspace(params, "startThread")
    this.sessionOpened = false
    return this.threadId
  }

  /**
   * Continue an existing conversation.
   *
   * Any id other than this workspace's is a wall. That is the fail-closed answer and also the useful
   * one: on the ordinary path the orchestrator treats a failed resume as "start a fresh thread", so a
   * checkpoint carrying another provider's thread id degrades to a clean new conversation -- while an
   * approved owner-decision resume, which MUST continue its original thread, correctly refuses to be
   * silently continued by a different provider.
   */
  async resumeThread(threadId, params = {}) {
    this.#assertConnected("resumeThread")
    this.#assertWorkspace(params, "resumeThread")
    if (threadId !== this.threadId) throw laneWall(CLAUDE_LANE_CODES.THREAD_UNKNOWN, "resumeThread")
    this.sessionOpened = true
    return this.threadId
  }

  /**
   * A typed turn failure.
   *
   * `detail` is a typed token and a digest -- never provider output. The orchestrator persists
   * `error.detail` into a durable checkpoint, and `AppServerTurnEndedError` classifies its detail as
   * a Codex usage limit, so raw CLI text here would both persist unreviewed prose and let a
   * claude-lane message that merely contains the words "usage limit" mark the CODEX lane exhausted.
   */
  #turnFailure(laneCode, reason = null, evidence = null) {
    const token = reason ? `${laneCode}:${String(reason).slice(0, 120)}` : laneCode
    const error = new AppServerTurnEndedError("failed", token.slice(0, MAX_TURN_DETAIL_CHARS))
    error.laneCode = laneCode
    error.lane = CLAUDE_LANE_ID
    if (typeof evidence === "string" && evidence !== "") {
      error.evidenceDigest = createHash("sha256").update(evidence).digest("hex")
    }
    return error
  }

  #timeoutFailure(budgetMs) {
    const error = new AppServerTimeoutError(budgetMs)
    error.laneCode = CLAUDE_LANE_CODES.TIMEOUT
    error.lane = CLAUDE_LANE_ID
    return error
  }

  /** The exact argv for one turn: the shared security rule, plus this turn's session flag. */
  #turnArguments(promptText) {
    return [
      "-p", promptText,
      "--output-format", "json",
      ...(this.sessionOpened ? ["--resume", this.threadId] : ["--session-id", this.threadId]),
      "--permission-mode", CLAUDE_LANE_PERMISSION_MODE,
      "--allowedTools", CLAUDE_LANE_ALLOWED_TOOLS,
    ]
  }

  /**
   * Run the CLI once and collect its output.
   *
   * On timeout the child is killed (TERM, then KILL after a grace window) and the promise rejects
   * immediately -- an orphaned provider process still holding the worktree is worse than a lost turn.
   */
  #execute(promptText, budgetMs) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = this.spawn(this.command, this.#turnArguments(promptText), {
          cwd: this.cwd,
          env: this.childEnvironment(),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        })
      } catch (error) {
        reject(this.#turnFailure(CLAUDE_LANE_CODES.SPAWN_FAILED, error?.code ?? "spawn"))
        return
      }
      this.child = child
      let stdout = ""
      let stderr = ""
      let settled = false
      let timer = null
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        if (timer) this.clearTimer(timer)
        if (this.child === child) this.child = null
        callback(value)
      }
      const kill = () => {
        try { child.kill?.("SIGTERM") } catch { /* already gone */ }
        const escalation = this.setTimer(() => {
          try { child.kill?.("SIGKILL") } catch { /* already gone */ }
        }, this.killGraceMs)
        escalation?.unref?.()
      }
      const collect = (stream, append) => {
        stream?.setEncoding?.("utf8")
        stream?.on?.("data", (chunk) => {
          if (append(String(chunk))) {
            kill()
            finish(reject, this.#turnFailure(CLAUDE_LANE_CODES.OUTPUT_LIMIT, String(this.maxOutputChars)))
          }
        })
      }
      collect(child.stdout, (text) => { stdout += text; return stdout.length > this.maxOutputChars })
      collect(child.stderr, (text) => { stderr += text; return stderr.length > this.maxOutputChars })
      child.on?.("error", (error) => {
        kill()
        finish(reject, this.#turnFailure(CLAUDE_LANE_CODES.SPAWN_FAILED, error?.code ?? "spawn"))
      })
      child.on?.("close", (code, signal) => {
        finish(resolve, { exitCode: code ?? null, signal: signal ?? null, stdout, stderr })
      })
      try { child.stdin?.end?.() } catch { /* the prompt travels in argv, not stdin */ }
      if (Number.isFinite(budgetMs) && budgetMs > 0) {
        timer = this.setTimer(() => {
          kill()
          finish(reject, this.#timeoutFailure(budgetMs))
        }, budgetMs)
        timer?.unref?.()
      }
    })
  }

  /**
   * One bounded turn: dispatch the prompt, read the delimited result channel, or fail closed.
   *
   * Every defect on the way gets its own typed code, because "the turn failed" is not a diagnosis.
   * The canonical contract is a floor: a caller-supplied `turn.outputSchema` may TIGHTEN it but can
   * never replace or weaken it.
   */
  async runTurn({ threadId, prompt, turn = {}, timeoutMs = this.timeoutMs } = {}) {
    this.#assertConnected("runTurn")
    if (threadId !== undefined && threadId !== null && threadId !== this.threadId) {
      throw laneWall(CLAUDE_LANE_CODES.THREAD_UNKNOWN, "runTurn")
    }
    if (typeof prompt !== "string" || prompt.trim() === "") {
      throw this.#turnFailure(CLAUDE_LANE_CODES.PROMPT_INVALID, "empty")
    }
    const runId = `run-${createHash("sha256")
      .update(`${this.threadId}:${this.turnCount + 1}`).digest("hex").slice(0, 32)}`
    const promptText = `${prompt}\n\n${buildClaudeLaneResultChannelContract(runId)}`
    if (promptText.length > this.maxPromptChars) {
      throw this.#turnFailure(CLAUDE_LANE_CODES.PROMPT_TOO_LONG, String(promptText.length))
    }
    const budgetMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.timeoutMs
    const outcome = await this.#execute(promptText, budgetMs)
    this.turnCount += 1
    // A signal death and a non-zero exit are different events with different remedies (something
    // killed the provider vs. the provider refused the work), so they get different codes.
    const stderrDigest = sanitizeAppServerText(String(outcome.stderr ?? ""))
    if (outcome.signal) {
      throw this.#turnFailure(CLAUDE_LANE_CODES.KILLED, String(outcome.signal), stderrDigest)
    }
    if (outcome.exitCode !== 0) {
      throw this.#turnFailure(CLAUDE_LANE_CODES.NONZERO_EXIT, `exit=${outcome.exitCode ?? "unknown"}`, stderrDigest)
    }
    // stdout is the ONLY result channel. stderr is CLI chatter -- warnings, progress, deprecations --
    // and is never read as an answer, only digested as evidence.
    const raw = String(outcome.stdout ?? "").trim()
    if (raw === "") throw this.#turnFailure(CLAUDE_LANE_CODES.EMPTY_STDOUT, null, stderrDigest)
    let envelope
    try { envelope = JSON.parse(raw) } catch {
      throw this.#turnFailure(CLAUDE_LANE_CODES.ENVELOPE_INVALID, "not-json", raw)
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
      || envelope.type !== "result" || typeof envelope.result !== "string") {
      throw this.#turnFailure(CLAUDE_LANE_CODES.ENVELOPE_INVALID, "shape", raw)
    }
    if (envelope.is_error === true || envelope.subtype !== "success") {
      throw this.#turnFailure(
        CLAUDE_LANE_CODES.TURN_ERROR,
        String(envelope.subtype ?? "error").slice(0, 60),
        raw,
      )
    }
    // Continuity, checked rather than hoped for: the CLI reports the session it actually ran, so a
    // silent fork or a redirected conversation is caught here instead of becoming an amnesiac turn
    // that still looks green.
    if (envelope.session_id !== this.threadId) {
      throw this.#turnFailure(CLAUDE_LANE_CODES.SESSION_MISMATCH, "session", raw)
    }
    // Redact BEFORE parsing, not before persisting: everything downstream derives from this string,
    // so redacting once here is what makes "nothing verbatim" hold on every path out of this module.
    // A secret-shaped span inside the answer object breaks its JSON and the turn fails closed --
    // the correct outcome for a turn result carrying a credential.
    const transcript = sanitizeAppServerText(envelope.result)
    const blocks = sentinelBlocks(transcript, runId)
    if (blocks.length === 0) {
      throw this.#turnFailure(CLAUDE_LANE_CODES.RESULT_CHANNEL_MISSING, null, transcript)
    }
    if (blocks.length > 1) {
      throw this.#turnFailure(CLAUDE_LANE_CODES.RESULT_CHANNEL_AMBIGUOUS, String(blocks.length), transcript)
    }
    let parsed
    try { parsed = JSON.parse(blocks[0]) } catch {
      throw this.#turnFailure(CLAUDE_LANE_CODES.RESULT_MALFORMED, "not-json", transcript)
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw this.#turnFailure(CLAUDE_LANE_CODES.RESULT_MALFORMED, "not-an-object", transcript)
    }
    const structural = validateAgainstTurnSchema(parsed, HERMES_TURN_OUTPUT_SCHEMA)
    if (!structural.ok) {
      throw this.#turnFailure(CLAUDE_LANE_CODES.RESULT_SCHEMA_INVALID, structural.reason, transcript)
    }
    if (turn?.outputSchema) {
      const tightened = validateAgainstTurnSchema(parsed, turn.outputSchema)
      if (!tightened.ok) {
        throw this.#turnFailure(CLAUDE_LANE_CODES.RESULT_SCHEMA_INVALID, tightened.reason, transcript)
      }
    }
    // This turn happened and the provider remembers it, so the next one must continue it.
    this.sessionOpened = true
    return {
      threadId: this.threadId,
      turnId: runId,
      status: "completed",
      // Canonical re-serialisation of the validated object, never the transcript: what the
      // orchestrator's `parseTurnResult` receives is already a bare JSON object, so its permissive
      // first-brace-to-last-brace fallback is unreachable from this lane by construction.
      finalText: JSON.stringify(parsed),
    }
  }

  close() {
    this.connected = false
    const child = this.child
    this.child = null
    if (child) {
      try { child.kill?.("SIGTERM") } catch { /* already gone */ }
    }
  }
}

/** Factory matching the orchestrator's `clientFactory(worktreePath)` seam. */
export function createClaudeLaneClient(options = {}) {
  return new ClaudeLaneClient(options)
}

/** Exposed for the parity guard test; the session id must satisfy the CLI's `--session-id` rule. */
export const CLAUDE_LANE_SESSION_ID_PATTERN = UUID
