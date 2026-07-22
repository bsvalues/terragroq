import { spawn as nodeSpawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
])

const USER_INPUT_METHODS = new Set([
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
])

const FORBIDDEN_ITEM_TYPES = new Set(["mcpToolCall", "dynamicToolCall", "webSearch"])

const CODEX_ENVIRONMENT_KEYS = new Set([
  "APPDATA", "CODEX_HOME", "COLORTERM", "COMSPEC", "HOME", "HOMEDRIVE", "HOMEPATH",
  "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE",
  "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TERM", "TMP", "USERDOMAIN", "USERNAME",
  "USERPROFILE", "WINDIR",
])

const SECRET_PATTERNS = [
  /\b(?:sk|sess|key|token)-[A-Za-z0-9._-]{8,}\b/gi,
  /\bauthorization\s*:\s*(?:bearer|basic)\s+[^\s,;]+/gi,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:bearer|token|api[_-]?key|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi,
  /\b(?:gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
]

export class AppServerWallError extends Error {
  constructor(code, method) {
    super(`Codex App Server stopped at ${code}: ${method}`)
    this.name = "AppServerWallError"
    this.code = code
    this.method = method
  }
}

export class AppServerTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Codex App Server turn exceeded ${timeoutMs}ms`)
    this.name = "AppServerTimeoutError"
    this.code = "APP_SERVER_TIMEOUT"
    this.timeoutMs = timeoutMs
  }
}

export class AppServerCancelledError extends Error {
  constructor() {
    super("Codex App Server turn was cancelled")
    this.name = "AppServerCancelledError"
    this.code = "APP_SERVER_CANCELLED"
  }
}

export class AppServerTurnEndedError extends Error {
  constructor(status) {
    super(`Codex App Server turn ended with ${status}`)
    this.name = "AppServerTurnEndedError"
    this.code = status === "failed" ? "APP_SERVER_TURN_FAILED" : "APP_SERVER_TURN_INTERRUPTED"
    this.status = status
  }
}

export function sanitizeAppServerText(value) {
  let text = typeof value === "string" ? value : ""
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[REDACTED]")
  return text
}

export function createCodexChildEnvironment(source = process.env, {
  platform = process.platform,
  existsSync = fs.existsSync,
} = {}) {
  const environment = Object.fromEntries(
    Object.entries(source).filter(([key]) => CODEX_ENVIRONMENT_KEYS.has(key.toUpperCase())),
  )
  if (platform === "win32") {
    const stablePowerShell = "C:\\Program Files\\PowerShell\\7"
    if (existsSync(path.join(stablePowerShell, "pwsh.exe"))) {
      const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ?? "PATH"
      const entries = String(environment[pathKey] ?? "").split(";").filter(Boolean)
      const normalizedStablePath = path.win32.normalize(stablePowerShell).replace(/[\\/]+$/, "").toLowerCase()
      const hasStablePowerShell = entries.some((entry) => (
        path.win32.normalize(entry).replace(/[\\/]+$/, "").toLowerCase() === normalizedStablePath
      ))
      if (!hasStablePowerShell) {
        environment[pathKey] = [stablePowerShell, ...entries].join(";")
      }
    }
  }
  return environment
}

function defaultLaunch() {
  if (process.platform !== "win32") return { command: "codex", args: ["app-server", "--stdio"] }
  const entrypoint = path.join(
    process.env.APPDATA ?? "",
    "npm", "node_modules", "@openai", "codex", "bin", "codex.js",
  )
  if (!fs.existsSync(entrypoint)) {
    throw new AppServerWallError("APP_SERVER_ENTRYPOINT_MISSING", "codex.js")
  }
  return { command: process.execPath, args: [entrypoint, "app-server", "--stdio"] }
}

export class CodexAppServerClient {
  /** @param {any} options */
  constructor({
    spawn = nodeSpawn,
    command,
    args,
    cwd,
    env,
    timeoutMs = 120_000,
    turnPollMs = 15_000,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = Date.now,
    onNotification = () => {},
  } = {}) {
    this.spawn = spawn
    const launch = command ? { command, args: args ?? ["app-server", "--stdio"] } : defaultLaunch()
    this.command = launch.command
    this.args = [...launch.args]
    this.cwd = cwd
    this.env = createCodexChildEnvironment(env ?? process.env)
    this.timeoutMs = timeoutMs
    this.turnPollMs = turnPollMs
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.now = now
    this.onNotification = onNotification
    this.nextId = 1
    this.pending = new Map()
    this.completedIds = new Set()
    this.buffer = ""
    this.process = null
    this.turnWaiter = null
    this.startingThreadId = null
    this.completedTurns = new Map()
    this.terminalReconciliations = new Set()
    this.turnText = new Map()
    this.wall = null
  }

  async connect() {
    if (this.process) return
    this.process = this.spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.process.stdout.setEncoding?.("utf8")
    this.process.stdout.on("data", (chunk) => this.#consume(chunk))
    this.process.stderr.resume?.()
    this.process.on("error", (error) => this.#fail(error))
    this.process.on("exit", (code, signal) => {
      if (!this.wall && (code !== 0 || this.pending.size > 0 || this.turnWaiter)) {
        this.#fail(new Error(`Codex App Server exited (${code ?? signal ?? "unknown"})`))
      }
    })

    await this.request("initialize", {
      clientInfo: { name: "williamos-hermes-bridge", title: "WilliamOS Hermes Bridge", version: "1" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })
    this.notify("initialized")
  }

  request(method, params) {
    if (!this.process) throw new Error("Codex App Server is not connected")
    const id = this.nextId++
    const message = { method, id }
    if (params !== undefined) message.params = params
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.#write(message)
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  notify(method, params) {
    const message = { method }
    if (params !== undefined) message.params = params
    this.#write(message)
  }

  async startThread(params = {}) {
    const response = await this.request("thread/start", params)
    return response.thread.id
  }

  async resumeThread(threadId, params = {}) {
    const response = await this.request("thread/resume", { ...params, threadId })
    return response.thread.id
  }

  /** @param {any} options */
  async runTurn({ threadId, prompt, input, turn = {}, timeoutMs = this.timeoutMs, signal } = {}) {
    if (this.turnWaiter) throw new Error("Only one turn may run per App Server client")
    if (signal?.aborted) throw new AppServerCancelledError()

    const turnInput = input ?? [{ type: "text", text: prompt ?? "", text_elements: [] }]
    const deadline = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? this.now() + timeoutMs : null
    this.startingThreadId = threadId
    let started
    try {
      started = await this.#awaitTurnStart(
        this.request("turn/start", { ...turn, threadId, input: turnInput }),
        timeoutMs,
        signal,
      )
    } catch (error) {
      this.startingThreadId = null
      throw error
    }
    const turnId = started.turn.id
    if (this.wall) throw this.wall

    return new Promise((resolve, reject) => {
      let timer
      let pollTimer
      const finish = (callback, value) => {
        if (!this.turnWaiter) return
        this.turnWaiter = null
        if (timer) this.clearTimer(timer)
        if (pollTimer) this.clearTimer(pollTimer)
        signal?.removeEventListener?.("abort", abort)
        callback(value)
      }
      const interrupt = (error) => {
        this.request("turn/interrupt", { threadId, turnId }).catch(() => {})
        finish(reject, error)
      }
      const abort = () => interrupt(new AppServerCancelledError())

      this.turnWaiter = { threadId, turnId, resolve: (value) => finish(resolve, value), reject: (error) => finish(reject, error) }
      this.startingThreadId = null
      const schedulePoll = () => {
        pollTimer = this.setTimer(async () => {
          await this.#reconcileTerminalTurn(threadId, turnId)
          if (this.turnWaiter) schedulePoll()
        }, this.turnPollMs)
        pollTimer.unref?.()
      }
      schedulePoll()
      const completed = this.completedTurns.get(`${threadId}:${turnId}`)
      if (completed) {
        this.completedTurns.delete(`${threadId}:${turnId}`)
        if (completed.status === "completed") this.turnWaiter.resolve(completed)
        else this.turnWaiter.reject(new AppServerTurnEndedError(completed.status))
        return
      }
      if (deadline !== null) {
        const remainingMs = Math.max(0, deadline - this.now())
        timer = this.setTimer(() => interrupt(new AppServerTimeoutError(timeoutMs)), remainingMs)
      }
      signal?.addEventListener?.("abort", abort, { once: true })
    })
  }

  #awaitTurnStart(request, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      let settled = false
      let timer
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        if (timer) this.clearTimer(timer)
        signal?.removeEventListener?.("abort", abort)
        callback(value)
      }
      const abort = () => finish(reject, new AppServerCancelledError())
      request.then((value) => finish(resolve, value), (error) => finish(reject, error))
      if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
        timer = this.setTimer(() => finish(reject, new AppServerTimeoutError(timeoutMs)), timeoutMs)
      }
      signal?.addEventListener?.("abort", abort, { once: true })
    })
  }

  close() {
    if (!this.process) return
    this.process.stdin.end?.()
    this.process.kill?.()
    this.process = null
    this.#fail(new AppServerCancelledError())
  }

  #write(message) {
    if (!this.process?.stdin?.writable) throw new Error("Codex App Server stdin is not writable")
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #consume(chunk) {
    this.buffer += String(chunk)
    for (;;) {
      const newline = this.buffer.indexOf("\n")
      if (newline < 0) return
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      try {
        this.#handle(JSON.parse(line))
      } catch (error) {
        this.#fail(error)
      }
    }
  }

  #handle(message) {
    if (Object.hasOwn(message, "id") && !message.method) {
      if (this.completedIds.has(message.id)) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      this.completedIds.add(message.id)
      if (message.error) pending.reject(new Error(sanitizeAppServerText(message.error.message ?? "JSON-RPC error")))
      else pending.resolve(message.result)
      return
    }

    if (Object.hasOwn(message, "id") && message.method) {
      const code = APPROVAL_METHODS.has(message.method)
        ? "APP_SERVER_APPROVAL_REQUIRED"
        : USER_INPUT_METHODS.has(message.method)
          ? "APP_SERVER_USER_INPUT_REQUIRED"
          : "APP_SERVER_UNSUPPORTED_REQUEST"
      const wall = new AppServerWallError(code, message.method)
      this.wall = wall
      this.#write({ id: message.id, error: { code: -32001, message: code } })
      this.turnWaiter?.reject(wall)
      return
    }

    if (!message.method) return
    if (message.method === "item/started" && FORBIDDEN_ITEM_TYPES.has(message.params?.item?.type)) {
      const wall = new AppServerWallError("APP_SERVER_EXTERNAL_TOOL_WALL", message.params.item.type)
      this.wall = wall
      if (this.turnWaiter) {
        this.request("turn/interrupt", {
          threadId: this.turnWaiter.threadId,
          turnId: this.turnWaiter.turnId,
        }).catch(() => {})
        this.turnWaiter.reject(wall)
      }
      return
    }
    if (message.method === "item/agentMessage/delta") {
      const { threadId, turnId } = message.params ?? {}
      if (threadId && turnId) {
        const key = `${threadId}:${turnId}`
        const prior = this.turnText.get(key) ?? ""
        this.turnText.set(key, `${prior}${sanitizeAppServerText(message.params?.delta)}`)
      }
    }
    if (message.method === "turn/completed") {
      const { turn } = message.params ?? {}
      const threadId = message.params?.threadId ?? this.turnWaiter?.threadId ?? this.startingThreadId
      if (threadId && turn?.id) {
        const itemText = this.#finalText(turn.items)
        const bufferedText = this.turnText.get(`${threadId}:${turn.id}`) || ""
        if (turn.status === "completed" && !itemText && !bufferedText) {
          this.#reconcileTerminalTurn(threadId, turn.id)
          this.onNotification({ method: message.method, params: this.#sanitizeNotification(message) })
          return
        }
        const result = {
          threadId,
          turnId: turn.id,
          status: turn.status,
          finalText: itemText || bufferedText,
          error: turn.error ? { message: sanitizeAppServerText(turn.error.message) } : null,
        }
        this.turnText.delete(`${threadId}:${turn.id}`)
        if (this.turnWaiter && threadId === this.turnWaiter.threadId && turn.id === this.turnWaiter.turnId) {
          if (turn.status === "completed") this.turnWaiter.resolve(result)
          else this.turnWaiter.reject(new AppServerTurnEndedError(turn.status))
        } else {
          this.completedTurns.clear()
          this.completedTurns.set(`${threadId}:${turn.id}`, result)
        }
      }
    }
    if (message.method === "thread/status/changed"
      && ["idle", "systemError"].includes(message.params?.status?.type)
      && this.turnWaiter
      && message.params?.threadId === this.turnWaiter.threadId) {
      this.#reconcileTerminalTurn(this.turnWaiter.threadId, this.turnWaiter.turnId)
    }
    this.onNotification({ method: message.method, params: this.#sanitizeNotification(message) })
  }

  async #reconcileTerminalTurn(threadId, turnId) {
    const key = `${threadId}:${turnId}`
    if (this.terminalReconciliations.has(key)) return
    this.terminalReconciliations.add(key)
    try {
      const response = await this.request("thread/read", { threadId, includeTurns: true })
      const turn = response?.thread?.turns?.find((candidate) => candidate?.id === turnId)
      if (!turn || turn.status === "inProgress") return
      const result = {
        threadId,
        turnId,
        status: turn.status,
        finalText: this.#finalText(turn.items) || this.turnText.get(key) || "",
        error: turn.error ? { message: sanitizeAppServerText(turn.error.message) } : null,
      }
      this.turnText.delete(key)
      const waiterMatches = this.turnWaiter
        && this.turnWaiter.threadId === threadId && this.turnWaiter.turnId === turnId
      if (turn.status !== "completed") {
        if (waiterMatches) this.turnWaiter.reject(new AppServerTurnEndedError(turn.status))
        else {
          this.completedTurns.clear()
          this.completedTurns.set(key, result)
        }
        return
      }
      if (waiterMatches) this.turnWaiter.resolve(result)
      else {
        this.completedTurns.clear()
        this.completedTurns.set(key, result)
      }
    } catch (error) {
      if (error instanceof AppServerTurnEndedError) throw error
    } finally {
      this.terminalReconciliations.delete(key)
    }
  }

  #sanitizeNotification(message) {
    if (message.method === "item/agentMessage/delta") {
      return { threadId: message.params?.threadId, turnId: message.params?.turnId, delta: sanitizeAppServerText(message.params?.delta) }
    }
    if (message.method === "thread/status/changed") {
      return { threadId: message.params?.threadId, status: message.params?.status?.type ?? null }
    }
    if (message.method === "turn/started" || message.method === "turn/completed") {
      return { threadId: message.params?.threadId, turnId: message.params?.turn?.id, status: message.params?.turn?.status }
    }
    return undefined
  }

  #finalText(items) {
    const messages = Array.isArray(items)
      ? items.filter((item) => item?.type === "agentMessage").map((item) => sanitizeAppServerText(item.text))
      : []
    return messages.at(-1) ?? ""
  }

  #fail(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    this.turnWaiter?.reject(error)
  }
}
