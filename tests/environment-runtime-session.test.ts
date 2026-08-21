import { beforeEach, describe, expect, it, vi } from "vitest"

const boundary = vi.hoisted(() => ({
  browserSession: vi.fn(),
  resolveDeviceSession: vi.fn(),
  headers: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: boundary.browserSession } } }))
vi.mock("@/lib/device-auth/service", () => ({ resolveDeviceSession: boundary.resolveDeviceSession }))
vi.mock("next/headers", () => ({ headers: boundary.headers }))

import { getRuntimeDevicePrincipal, getSession } from "@/lib/session"

describe("Environment runtime session isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    boundary.browserSession.mockResolvedValue(null)
    boundary.headers.mockResolvedValue(new Headers({ cookie: "__Host-williamos-device=wds_runtime" }))
  })

  it("does not let a runtime credential become an owner application session", async () => {
    boundary.resolveDeviceSession.mockResolvedValue({
      sessionId: "runtime-session",
      userId: "owner",
      credentialId: "runtime-credential",
      credentialKind: "runtime",
      expiresAt: new Date("2027-08-20T00:00:00.000Z"),
      name: "Runtime",
      email: "runtime@example.test",
      image: null,
    })

    await expect(getSession()).resolves.toBeNull()
    await expect(getRuntimeDevicePrincipal()).resolves.toEqual({
      userId: "owner", credentialId: "runtime-credential", sessionId: "runtime-session",
    })
  })

  it("keeps an owner device session out of runtime ingress", async () => {
    boundary.resolveDeviceSession.mockResolvedValue({
      sessionId: "owner-session",
      userId: "owner",
      credentialId: "owner-credential",
      credentialKind: "owner",
      expiresAt: new Date("2027-08-20T00:00:00.000Z"),
      name: "Owner",
      email: "owner@example.test",
      image: null,
    })

    expect((await getSession())?.user.id).toBe("owner")
    await expect(getRuntimeDevicePrincipal()).resolves.toBeNull()
  })
})
