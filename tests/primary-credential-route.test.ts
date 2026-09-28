import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const connectMock = vi.hoisted(() => vi.fn())
const queryMock = vi.hoisted(() => vi.fn())
const releaseMock = vi.hoisted(() => vi.fn())
const hashPasswordMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  pool: {
    connect: connectMock,
    query: queryMock,
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
    // Recovery is a separate, process-only opt-in. These contract tests exercise a deliberate
    // recovery run, so the flag is armed here; the case where it is NOT armed is asserted below.
    process.env.WILLIAMOS_PRIMARY_RECOVERY = "true"

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

  function credentialRequest() {
    return new Request("http://localhost:3000/api/setup/primary-credential", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(primaryPayload()),
    })
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
    // Refused from the preflight classification, so the expensive work is not reached.
    expect(hashPasswordMock).not.toHaveBeenCalled()
    expect(connectMock).not.toHaveBeenCalled()
  })

  it("refuses to RESET an existing Primary credential on the persisted setup flag alone", async () => {
    // The regression this separation exists for: `local-config` writes LOCAL_SETUP_ENABLED="true"
    // into .env.local during full setup and the live launcher carries that file into production, so
    // a deployment is routinely running with that flag set. It must not arm a credential reset.
    delete process.env.WILLIAMOS_PRIMARY_RECOVERY
    process.env.LOCAL_SETUP_ENABLED = "true"
    // A declared Primary already exists -> classifyPrimaryCredentialOperation() -> "recovery".
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [], rowCount: 0 }
      if (sql.includes("count(*)::int as auth_record_count")) {
        return { rows: [{ auth_record_count: 1, declared_primary_count: 1 }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    })

    const response = await POST(credentialRequest())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.operation).toBe("recovery")
    expect(body.message).toContain("WILLIAMOS_PRIMARY_RECOVERY")
    // The refusal must be cheap: no password is hashed and no pooled connection is borrowed for a
    // request the surface is going to refuse.
    expect(hashPasswordMock).not.toHaveBeenCalled()
    expect(connectMock).not.toHaveBeenCalled()
  })

  it("refuses to RESET when nothing is armed at all", async () => {
    delete process.env.WILLIAMOS_PRIMARY_RECOVERY
    delete process.env.LOCAL_SETUP_ENABLED
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [], rowCount: 0 }
      if (sql.includes("count(*)::int as auth_record_count")) {
        return { rows: [{ auth_record_count: 1, declared_primary_count: 1 }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    })

    const response = await POST(credentialRequest())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.operation).toBe("recovery")
    expect(hashPasswordMock).not.toHaveBeenCalled()
    expect(connectMock).not.toHaveBeenCalled()
  })

  it("still allows FIRST-OWNER provisioning through the ordinary setup gate", async () => {
    // The other half of the boundary: gating this route on the recovery opt-in before the operation
    // is known would 403 the visible "Save Primary credential" action on a fresh installation, since
    // the standard setup flow writes LOCAL_SETUP_ENABLED and nothing ever arms recovery. A
    // provisioning run must therefore succeed with the persisted flag alone and recovery unarmed.
    delete process.env.WILLIAMOS_PRIMARY_RECOVERY
    process.env.LOCAL_SETUP_ENABLED = "true"
    let provisioned = false
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [], rowCount: 0 }
      if (sql.includes("count(*)::int as auth_record_count")) {
        return { rows: [{ auth_record_count: 0, declared_primary_count: 0 }], rowCount: 1 }
      }
      if (/insert into "user"/i.test(sql)) provisioned = true
      return { rows: [], rowCount: 0 }
    })

    const response = await POST(credentialRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.operation).toBe("provisioning")
    expect(provisioned).toBe(true)
  })
})
