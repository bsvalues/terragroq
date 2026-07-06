import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const writeFileMock = vi.hoisted(() => vi.fn())
const readFileMock = vi.hoisted(() => vi.fn())

vi.mock("node:fs", () => ({
  promises: {
    writeFile: writeFileMock,
    readFile: readFileMock,
  },
}))

import { POST } from "@/app/api/setup/local-config/route"

describe("POST /api/setup/local-config route contract", () => {
  const originalEnv = process.env

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

  it("writes .env.local with expected keys on valid setup payload", async () => {
    process.env.GROQ_API_KEY = "groq-key-value"
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        databaseUrl: "postgres://postgres:postgres@localhost:5432/terragroq",
        authSecret: "12345678901234567890123456789012",
        authUrl: "http://localhost:3000",
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
    expect(writeFileMock.mock.calls[0][1]).toContain('LOCAL_SETUP_ENABLED="true"')
    expect(writeFileMock.mock.calls[0][1]).toContain('GROQ_API_KEY="groq-key-value"')
  })

  it("preserves unrelated .env.local keys while updating managed keys", async () => {
    readFileMock.mockResolvedValue(
      [
        "CUSTOM_FLAG=true",
        'BETTER_AUTH_URL="http://localhost:1111"',
        'DATABASE_URL="postgres://old"',
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
