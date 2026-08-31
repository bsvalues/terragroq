import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
import path from "node:path"

const writeFileMock = vi.hoisted(() => vi.fn())
const readFileMock = vi.hoisted(() => vi.fn())

vi.mock("node:fs", () => ({
  promises: {
    writeFile: writeFileMock,
    readFile: readFileMock,
  },
}))

import { POST } from "@/app/api/setup/local-config/route"
import { normalizeProjectRootForEnv } from "@/lib/setup/project-root-env"

const nodeRequire = createRequire(import.meta.url)

function parseWithNextDotenv(input: string): Record<string, string> {
  const nextDirectory = path.dirname(nodeRequire.resolve("next/package.json"))
  const nextEnvPackage = nodeRequire.resolve("@next/env/package.json", { paths: [nextDirectory] })
  const dotenvEntry = nodeRequire.resolve("dotenv", { paths: [path.dirname(nextEnvPackage)] })
  return (nodeRequire(dotenvEntry) as { parse: (value: string) => Record<string, string> }).parse(input)
}

describe("POST /api/setup/local-config route contract", () => {
  const originalEnv = process.env
  const projectRoot = path.resolve("/repos/terrafusion_os_1.0")
  const normalizedProjectRoot = normalizeProjectRootForEnv(projectRoot)

  beforeEach(() => {
    vi.clearAllMocks()
    writeFileMock.mockResolvedValue(undefined)
    readFileMock.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" }))
    process.env = { ...originalEnv }
    process.env.NODE_ENV = "development"
    delete process.env.LOCAL_SETUP_ENABLED
    delete process.env.AUTH_SIGNUP_MODE
    delete process.env.GROQ_API_KEY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("rejects requests when local setup is disabled", async () => {
    process.env.LOCAL_SETUP_ENABLED = "false"

    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("disabled")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("rejects non-loopback requests", async () => {
    const req = new Request("http://example.com/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("loopback")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("rejects a loopback-looking request that was actually forwarded by the proxy", async () => {
    // Host is set by the caller, so it cannot establish locality on its own. A request that carries
    // forwarding headers reached this server through the proxy and is therefore not a local client,
    // whatever it claims its Host to be.
    const req = new Request("http://localhost/api/setup/local-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Host": "192.168.88.9:3443",
      },
      body: JSON.stringify({}),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("rejects writes when signup mode is closed", async () => {
    process.env.AUTH_SIGNUP_MODE = "closed"

    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("owner provisioning is closed")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid JSON payloads", async () => {
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.message).toBe("Invalid JSON payload.")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("validates required env values before writing", async () => {
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        databaseUrl: "",
        authSecret: "short",
        authUrl: "not-a-url",
      }),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.message).toBe("DATABASE_URL is required.")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it.each(["", "relative/terrafusion_os_1.0"])(
    "requires an absolute TerraFusion checkout path (%s)",
    async (invalidProjectRoot) => {
      const req = new Request("http://localhost:3000/api/setup/local-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          databaseUrl: "postgres://postgres:postgres@localhost:5432/terragroq",
          authSecret: "12345678901234567890123456789012",
          authUrl: "http://localhost:3000",
          projectRoot: invalidProjectRoot,
        }),
      })

      const response = await POST(req)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.message).toContain("WILLIAMOS_PROJECT_ROOT")
      expect(writeFileMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    "C:\\repos\\terrafusion_os_1.0",
    "C:\\new\\terrafusion_os_1.0",
    "\\\\omen\\workspace\\terrafusion_os_1.0",
  ])("round-trips a Windows checkout root through Next's dotenv parser (%s)", (windowsRoot) => {
    const normalized = normalizeProjectRootForEnv(windowsRoot, "win32")
    const parsed = parseWithNextDotenv(`WILLIAMOS_PROJECT_ROOT=${JSON.stringify(normalized)}\n`)

    expect(normalized).not.toContain("\\")
    expect(parsed.WILLIAMOS_PROJECT_ROOT).toBe(normalized)
  })

  it("preserves a literal backslash in a POSIX checkout root", () => {
    const posixRoot = "/srv/terrafusion\\repo"
    const normalized = normalizeProjectRootForEnv(posixRoot, "linux")

    expect(normalized).toBe(posixRoot)
  })

  it("writes .env.local with expected keys on valid setup payload", async () => {
    process.env.GROQ_API_KEY = "groq-key-value"
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        databaseUrl: "postgres://postgres:postgres@localhost:5432/terragroq",
        authSecret: "12345678901234567890123456789012",
        authUrl: "http://localhost:3000",
        projectRoot,
      }),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.restartRequired).toBe(true)
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    expect(writeFileMock.mock.calls[0][0]).toMatch(/\.env\.local$/)
    expect(writeFileMock.mock.calls[0][1]).toContain(
      'DATABASE_URL="postgres://postgres:postgres@localhost:5432/terragroq"',
    )
    expect(writeFileMock.mock.calls[0][1]).toContain(
      'BETTER_AUTH_SECRET="12345678901234567890123456789012"',
    )
    expect(writeFileMock.mock.calls[0][1]).toContain('BETTER_AUTH_URL="http://localhost:3000"')
    expect(writeFileMock.mock.calls[0][1]).toContain(`WILLIAMOS_PROJECT_ROOT=${JSON.stringify(normalizedProjectRoot)}`)
    expect(writeFileMock.mock.calls[0][1]).toContain('LOCAL_SETUP_ENABLED="true"')
    expect(writeFileMock.mock.calls[0][1]).toContain('GROQ_API_KEY="groq-key-value"')
  })

  it("preserves unrelated .env.local keys while updating managed keys", async () => {
    readFileMock.mockResolvedValue(
      [
        "CUSTOM_FLAG=true",
        'BETTER_AUTH_URL="http://localhost:1111"',
        'DATABASE_URL="postgres://old"',
        'WILLIAMOS_PROJECT_ROOT="/repos/old"',
        "",
      ].join("\n"),
    )
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        databaseUrl: "postgres://postgres:postgres@localhost:5432/terragroq",
        authSecret: "12345678901234567890123456789012",
        authUrl: "http://localhost:3000",
        projectRoot,
      }),
    })

    const response = await POST(req)
    const body = await response.json()
    const writtenEnv = writeFileMock.mock.calls[0][1]

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(writtenEnv).toContain("CUSTOM_FLAG=true")
    expect(writtenEnv).toContain(
      'DATABASE_URL="postgres://postgres:postgres@localhost:5432/terragroq"',
    )
    expect(writtenEnv).toContain('BETTER_AUTH_SECRET="12345678901234567890123456789012"')
    expect(writtenEnv).toContain('BETTER_AUTH_URL="http://localhost:3000"')
    expect(writtenEnv).toContain('LOCAL_SETUP_ENABLED="true"')
    expect(writtenEnv).toContain(`WILLIAMOS_PROJECT_ROOT=${JSON.stringify(normalizedProjectRoot)}`)
    expect(writtenEnv).not.toContain('WILLIAMOS_PROJECT_ROOT="/repos/old"')
    expect(writtenEnv).not.toContain('DATABASE_URL="postgres://old"')
  })

  it("surfaces write failures as 500 responses", async () => {
    writeFileMock.mockRejectedValueOnce(new Error("disk full"))

    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        databaseUrl: "postgres://postgres:postgres@localhost:5432/terragroq",
        authSecret: "12345678901234567890123456789012",
        authUrl: "http://localhost:3000",
        projectRoot,
      }),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("Failed to write .env.local")
    expect(body.message).toContain("disk full")
  })
})
