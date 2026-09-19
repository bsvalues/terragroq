import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  getHelloApplicationRuntime,
  startHelloApplicationRuntime,
  stopHelloApplicationRuntime,
} from "@/lib/hello-application/runtime-supervisor"

afterEach(async () => {
  await stopHelloApplicationRuntime()
})

describe("Hello Application runtime supervisor", () => {
  it("starts the real loopback runtime, reports health, and stops cleanly", async () => {
    const workspaceRoot = path.join(process.cwd(), "examples", "hello-application")
    const running = await startHelloApplicationRuntime({ workspaceRoot })

    expect(running).toMatchObject({ state: "running", host: "127.0.0.1" })
    expect(running.port).toBeGreaterThan(0)
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)

    const health = await fetch(new URL("healthz", running.url))
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toEqual({ name: "Hello Application", status: "ready" })

    const page = await fetch(running.url)
    expect(page.headers.get("content-type")).toMatch(/^text\/html/)
    await expect(page.text()).resolves.toContain("Hello Application")

    await stopHelloApplicationRuntime()
    expect(getHelloApplicationRuntime()).toMatchObject({ state: "stopped", pid: null, url: null })
  })

  it("reuses one healthy supervised process instead of spawning duplicates", async () => {
    const workspaceRoot = path.join(process.cwd(), "examples", "hello-application")
    const first = await startHelloApplicationRuntime({ workspaceRoot })
    const second = await startHelloApplicationRuntime({ workspaceRoot })

    expect(second.pid).toBe(first.pid)
    expect(second.url).toBe(first.url)
  })
})
