import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

export type HelloApplicationRuntimeSnapshot = Readonly<{
  state: "stopped" | "starting" | "running" | "failed"
  host: "127.0.0.1"
  port: number | null
  url: string | null
  pid: number | null
  workspaceRoot: string | null
  startedAt: string | null
  error: string | null
  logs: readonly string[]
}>

type RuntimeRecord = {
  child: ChildProcessWithoutNullStreams | null
  snapshot: HelloApplicationRuntimeSnapshot
}

const stoppedSnapshot = (): HelloApplicationRuntimeSnapshot => ({
  state: "stopped",
  host: "127.0.0.1",
  port: null,
  url: null,
  pid: null,
  workspaceRoot: null,
  startedAt: null,
  error: null,
  logs: [],
})

let runtime: RuntimeRecord = { child: null, snapshot: stoppedSnapshot() }

function appendLog(record: RuntimeRecord, value: string): void {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return
  record.snapshot = { ...record.snapshot, logs: [...record.snapshot.logs, ...lines].slice(-40) }
}

export function getHelloApplicationRuntime(): HelloApplicationRuntimeSnapshot {
  return runtime.snapshot
}

async function probe(url: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3_000)
  try {
    const response = await fetch(new URL("healthz", url), {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HELLO_APPLICATION_HEALTH_${response.status}`)
    const body = await response.json() as { name?: unknown; status?: unknown }
    if (body.name !== "Hello Application" || body.status !== "ready") {
      throw new Error("HELLO_APPLICATION_HEALTH_INVALID")
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function startHelloApplicationRuntime({
  workspaceRoot,
}: Readonly<{ workspaceRoot: string }>): Promise<HelloApplicationRuntimeSnapshot> {
  const canonicalRoot = await fs.realpath(path.resolve(workspaceRoot))
  const serverPath = await fs.realpath(path.join(canonicalRoot, "server.mjs"))
  if (path.dirname(serverPath) !== canonicalRoot) throw new Error("HELLO_APPLICATION_SERVER_INVALID")

  if (runtime.child && runtime.child.exitCode === null
    && runtime.snapshot.state === "running"
    && runtime.snapshot.workspaceRoot === canonicalRoot
    && runtime.snapshot.url) {
    await probe(runtime.snapshot.url)
    return runtime.snapshot
  }
  await stopHelloApplicationRuntime()

  const child = spawn(process.execPath, [serverPath], {
    cwd: canonicalRoot,
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", NO_COLOR: "1" },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const record: RuntimeRecord = {
    child,
    snapshot: {
      state: "starting",
      host: "127.0.0.1",
      port: null,
      url: null,
      pid: child.pid ?? null,
      workspaceRoot: canonicalRoot,
      startedAt: null,
      error: null,
      logs: [],
    },
  }
  runtime = record
  child.stderr.on("data", (chunk: Buffer) => appendLog(record, chunk.toString("utf8")))

  const ready = await new Promise<{ host: "127.0.0.1"; port: number; url: string }>((resolve, reject) => {
    let stdout = ""
    const timer = setTimeout(() => reject(new Error("HELLO_APPLICATION_START_TIMEOUT")), 10_000)
    const fail = (error: unknown) => {
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error("HELLO_APPLICATION_START_FAILED"))
    }
    child.once("error", fail)
    child.once("exit", (code) => fail(new Error(`HELLO_APPLICATION_EXITED:${code ?? "signal"}`)))
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
      if (stdout.length > 64_000) return fail(new Error("HELLO_APPLICATION_READINESS_TOO_LARGE"))
      let newline = stdout.indexOf("\n")
      while (newline >= 0) {
        const line = stdout.slice(0, newline).trim()
        stdout = stdout.slice(newline + 1)
        appendLog(record, line)
        try {
          const value = JSON.parse(line) as Record<string, unknown>
          if (value.event === "hello-application-ready" && value.host === "127.0.0.1"
            && Number.isSafeInteger(value.port) && Number(value.port) > 0 && Number(value.port) <= 65_535
          ) {
            clearTimeout(timer)
            resolve({ host: "127.0.0.1", port: Number(value.port), url: `http://127.0.0.1:${value.port}/` })
            return
          }
        } catch {
          // Logs preceding the single readiness record are retained but cannot establish readiness.
        }
        newline = stdout.indexOf("\n")
      }
    })
  }).catch(async (error) => {
    record.snapshot = {
      ...record.snapshot,
      state: "failed",
      error: error instanceof Error ? error.message : "HELLO_APPLICATION_START_FAILED",
    }
    if (child.exitCode === null) child.kill()
    throw error
  })

  await probe(ready.url)
  record.snapshot = {
    ...record.snapshot,
    state: "running",
    host: ready.host,
    port: ready.port,
    url: ready.url,
    startedAt: new Date().toISOString(),
    error: null,
  }
  child.once("close", (code) => {
    if (runtime !== record) return
    record.child = null
    record.snapshot = code === 0
      ? stoppedSnapshot()
      : { ...record.snapshot, state: "failed", pid: null, error: `HELLO_APPLICATION_EXITED:${code ?? "signal"}` }
  })
  return record.snapshot
}

export async function stopHelloApplicationRuntime(): Promise<HelloApplicationRuntimeSnapshot> {
  const record = runtime
  const child = record.child
  if (!child || child.exitCode !== null) {
    runtime = { child: null, snapshot: stoppedSnapshot() }
    return runtime.snapshot
  }

  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()))
  child.stdin.end()
  const graceful = await Promise.race([
    closed.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  if (!graceful && child.exitCode === null) {
    child.kill()
    await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 1_000))])
  }
  if (runtime === record) runtime = { child: null, snapshot: stoppedSnapshot() }
  return runtime.snapshot
}
