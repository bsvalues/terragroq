import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import path from "node:path"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"

const projectRoot = path.resolve("examples/hello-application")
const serverPath = path.join(projectRoot, "server.mjs")

type RunningHelloApplication = {
  baseUrl: string
  child: ChildProcessWithoutNullStreams
}

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 5_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function startHelloApplication(): Promise<RunningHelloApplication> {
  const child = spawn(process.execPath, [serverPath], {
    cwd: projectRoot,
    env: { ...process.env, PORT: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")

  let stdout = ""
  let stderr = ""
  child.stderr.on("data", (chunk: string) => { stderr += chunk })

  const ready = new Promise<{ host: string; port: number }>((resolve, reject) => {
    const onExit = (code: number | null) => reject(new Error(`Hello Application exited before readiness (${code}): ${stderr.trim()}`))
    child.once("exit", onExit)
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      const lines = stdout.split(/\r?\n/)
      stdout = lines.pop() ?? ""
      for (const line of lines) {
        try {
          const value = JSON.parse(line) as { event?: string; host?: string; port?: number }
          if (value.event === "hello-application-ready" && value.host === "127.0.0.1" && Number.isInteger(value.port)) {
            child.off("exit", onExit)
            resolve({ host: value.host, port: value.port! })
            return
          }
        } catch {
          // Ignore non-readiness output; early exit still reports it.
        }
      }
    })
  })

  const address = await withTimeout(ready, "Hello Application did not report readiness")
  return { baseUrl: `http://${address.host}:${address.port}`, child }
}

async function stopHelloApplication(app: RunningHelloApplication): Promise<number | null> {
  if (app.child.exitCode !== null) return app.child.exitCode
  const exited = once(app.child, "exit") as Promise<[number | null, NodeJS.Signals | null]>
  app.child.stdin.end()
  const [code] = await withTimeout(exited, "Hello Application did not stop after supervisor input closed")
  return code
}

describe("Hello Application source", () => {
  it("boots on loopback, reports health, and stops when the supervisor pipe closes", async () => {
    const app = await startHelloApplication()

    const response = await fetch(`${app.baseUrl}/healthz`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(await response.json()).toEqual({ name: "Hello Application", status: "ready" })

    expect(await stopHelloApplication(app)).toBe(0)
  })

  it("serves a self-contained interface whose Send pulse control reports the received pulse", async () => {
    const app = await startHelloApplication()
    try {
      const response = await fetch(app.baseUrl)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/html")

      const dom = new JSDOM(await response.text(), {
        runScripts: "dangerously",
        url: `${app.baseUrl}/`,
      })
      const document = dom.window.document

      expect(document.title).toBe("Hello Application")
      expect(document.querySelector("h1")?.textContent).toBe("Hello Application")
      expect(document.querySelectorAll('script[src], link[rel="stylesheet"]')).toHaveLength(0)
      expect(document.querySelector('[data-hermes-state="placeholder"]')?.textContent).toContain("Awaiting WilliamOS connection")

      const button = document.querySelector<HTMLButtonElement>("#send-pulse")
      expect(button?.textContent?.trim()).toBe("Send pulse")
      expect(document.querySelector("#pulse-count")?.textContent).toBe("000")

      button?.click()

      expect(document.querySelector("#pulse-count")?.textContent).toBe("001")
      expect(document.querySelector("#pulse-status")?.textContent).toBe("Pulse 001 received.")
      expect(document.querySelector("#signal-track")?.getAttribute("data-state")).toBe("sent")
      dom.window.close()
    } finally {
      await stopHelloApplication(app)
    }
  })

  it("returns a plain 404 without exposing a filesystem path", async () => {
    const app = await startHelloApplication()
    try {
      const response = await fetch(`${app.baseUrl}/missing`)
      expect(response.status).toBe(404)
      expect(response.headers.get("content-type")).toContain("text/plain")
      expect(await response.text()).toBe("Not found\n")
    } finally {
      await stopHelloApplication(app)
    }
  })
})
