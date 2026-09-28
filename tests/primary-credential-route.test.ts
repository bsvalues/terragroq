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

  it("refuses before touching the database when both capabilities are off", async () => {
    // The production default: setup closed, recovery unarmed. Nothing this route can do is allowed,
    // so it must not check out a pooled connection -- nor disclose, via a 409, whether auth records
    // happen to exist.
    process.env.NODE_ENV = "production"
    process.env.LOCAL_SETUP_ENABLED = "false"
    delete process.env.WILLIAMOS_PRIMARY_RECOVERY

    const response = await POST(credentialRequest())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("both disabled")
    expect(queryMock).not.toHaveBeenCalled()
    expect(connectMock).not.toHaveBeenCalled()
    expect(hashPasswordMock).not.toHaveBeenCalled()
  })

  it("refuses the disabled state before the body is parsed", async () => {
    // A request that can only return 403 must not buffer and parse an unbounded JSON body first, so
    // the check has to precede req.json(). A body that is not even valid JSON proves the ordering:
    // if parsing ran first this would be a 400.
    process.env.NODE_ENV = "production"
    process.env.LOCAL_SETUP_ENABLED = "false"
    delete process.env.WILLIAMOS_PRIMARY_RECOVERY

    const req = new Request("http://localhost:3000/api/setup/primary-credential", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: "{ this is not json",
    })

    const response = await POST(req)

    expect(response.status).toBe(403)
    expect(queryMock).not.toHaveBeenCalled()
    expect(hashPasswordMock).not.toHaveBeenCalled()
  })

  it("bounds the request body when a capability is enabled", async () => {
    // The post-bootstrap state as it actually is in a deployed runtime: LOCAL_SETUP_ENABLED was
    // persisted by the setup flow and exported by the launcher, and recovery is NOT armed. All three
    // refusals above are therefore behind us, so what is left to prove is that the body is bounded.
    process.env.NODE_ENV = "production"
    process.env.LOCAL_SETUP_ENABLED = "true"
    delete process.env.WILLIAMOS_PRIMARY_RECOVERY

    const oversized = JSON.stringify({ ...primaryPayload(), pad: "x".repeat(20_000) })
    const req = new Request("http://localhost:3000/api/setup/primary-credential", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: oversized,
    })

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.message).toContain("too large")
    expect(hashPasswordMock).not.toHaveBeenCalled()
  })

  it("refuses first-owner provisioning when the signup policy says closed", async () => {
    // The route creates the first owner account, so it is a signup and must obey the same policy as
    // the rest of the product. Gating on LOCAL_SETUP_ENABLED alone let a deployment that is
    // explicitly closed for signups accept a brand-new Primary credential over loopback.
    process.env.NODE_ENV = "production"
    process.env.LOCAL_SETUP_ENABLED = "true"
    process.env.AUTH_SIGNUP_MODE = "closed"
    delete process.env.WILLIAMOS_PRIMARY_RECOVERY
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [], rowCount: 0 }
      if (sql.includes("count(*)::int as auth_record_count")) {
        return { rows: [{ auth_record_count: 0, declared_primary_count: 0 }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    })

    const response = await POST(credentialRequest())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.operation).toBe("provisioning")
    expect(body.message).toContain("AUTH_SIGNUP_MODE=closed")
    expect(hashPasswordMock).not.toHaveBeenCalled()
    expect(connectMock).not.toHaveBeenCalled()
  })

  it("spends the recovery capability, so a reset cannot be replayed in the same process", async () => {
    // Arming is bounded by the launcher's window; USE must be bounded here. Without this, an armed
    // process serves resets for its whole lifetime, including after the owner has finished.
    process.env.NODE_ENV = "production"
    process.env.LOCAL_SETUP_ENABLED = "true"
    process.env.WILLIAMOS_PRIMARY_RECOVERY = "true"
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [], rowCount: 0 }
      if (sql.includes("count(*)::int as auth_record_count")) {
        return { rows: [{ auth_record_count: 1, declared_primary_count: 1 }], rowCount: 1 }
      }
      if (/select id from "user" where lower\(email\)/i.test(sql)) {
        return { rows: [{ id: "primary-user-id" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    })

    const first = await POST(credentialRequest())
    const firstBody = await first.json()
    expect(first.status).toBe(200)
    expect(firstBody.operation).toBe("recovery")
    expect(process.env.WILLIAMOS_PRIMARY_RECOVERY).toBeUndefined()

    const second = await POST(credentialRequest())
    expect(second.status).toBe(403)
  })

  it("still allows FIRST-OWNER provisioning through the ordinary setup gate", async () => {
    // The other half of the boundary: gating this route on the recovery opt-in before the operation
    // is known would 403 the visible "Save Primary credential" action on a fresh installation, since
    // the standard setup flow writes LOCAL_SETUP_ENABLED and nothing ever arms recovery. A
    // provisioning run must therefore succeed with the persisted flag alone and recovery unarmed.
    delete process.env.WILLIAMOS_PRIMARY_RECOVERY
    process.env.LOCAL_SETUP_ENABLED = "true"
    // Bootstrap mode without a DSN cannot be evaluated, and the policy refuses rather than guessing;
    // supply one so this test exercises "bootstrap, no users yet -> open".
    process.env.DATABASE_URL = "postgres://test@localhost:5432/williamos"
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
