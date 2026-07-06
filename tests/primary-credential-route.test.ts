import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const connectMock = vi.hoisted(() => vi.fn())
const queryMock = vi.hoisted(() => vi.fn())
const releaseMock = vi.hoisted(() => vi.fn())
const hashPasswordMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  pool: {
    connect: connectMock,
  },
}))

vi.mock("better-auth/crypto", () => ({
  hashPassword: hashPasswordMock,
}))

import { POST } from "@/app/api/setup/primary-credential/route"

describe("POST /api/setup/primary-credential route contract", () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.NODE_ENV = "development"
    delete process.env.LOCAL_SETUP_ENABLED

    hashPasswordMock.mockResolvedValue("hashed-primary-password")
    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    })
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rows: [], rowCount: 0 }
      }
      if (sql.includes("count(*)::int as auth_record_count")) {
        return {
          rows: [{ auth_record_count: 1, declared_primary_count: 0 }],
          rowCount: 1,
        }
      }
      return { rows: [], rowCount: 0 }
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  function primaryPayload() {
    const testOnlyPassword = "p".repeat(20)
    return {
      email: "bsvalues@gmail.com",
      name: "Primary Operator",
      password: testOnlyPassword,
      confirmPassword: testOnlyPassword,
    }
  }

  it("rejects loopback cross-origin credential setup requests", async () => {
    const req = new Request("http://localhost:3000/api/setup/primary-credential", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Origin: "http://localhost:4444",
      },
      body: JSON.stringify(primaryPayload()),
    })

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("same-origin loopback")
    expect(connectMock).not.toHaveBeenCalled()
    expect(hashPasswordMock).not.toHaveBeenCalled()
  })

  it("requires an Origin or Referer header for local credential setup", async () => {
    const req = new Request("http://localhost:3000/api/setup/primary-credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(primaryPayload()),
    })

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("same-origin loopback")
    expect(connectMock).not.toHaveBeenCalled()
    expect(hashPasswordMock).not.toHaveBeenCalled()
  })

  it("blocks credential recovery when auth records exist without the declared Primary identity", async () => {
    const req = new Request("http://localhost:3000/api/setup/primary-credential", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(primaryPayload()),
    })

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.ok).toBe(false)
    expect(body.operation).toBe("blocked_identity_missing")
    expect(body.message).toContain("Primary identity is not declared")
    expect(queryMock).toHaveBeenCalledWith("begin")
    expect(queryMock).toHaveBeenCalledWith("commit")
    expect(releaseMock).toHaveBeenCalledTimes(1)
  })
})
