import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const boundaries = vi.hoisted(() => ({
  recordAuthorization: vi.fn(),
  verifyProvenance: vi.fn(),
}))

vi.mock("@/scripts/hermes-bridge/primary-authorization-provenance.mjs", () => ({
  verifyPrimaryAuthorizationProvenance: boundaries.verifyProvenance,
  isVerifiedPrimaryAuthorization: vi.fn(() => true),
}))

vi.mock("@/scripts/hermes-bridge/outcome-queue-source.mjs", () => ({
  recordVerifiedPrimaryAuthorization: boundaries.recordAuthorization,
}))

import { executePrimaryAuthorizationBridge } from "@/scripts/hermes-bridge/primary-authorization-bridge.mjs"

const QUERY = { connect: vi.fn() }
const AUTHORIZATION = Object.freeze({
  identityStatus: "VERIFIED_PRIMARY_CODEX_APP_SERVER",
  accountEmail: "bsvalues@gmail.com",
})

describe("Primary Authorization Bridge coordinator", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://controlled-test-value")
    boundaries.recordAuthorization.mockReset().mockResolvedValue({ status: "RECORDED" })
    boundaries.verifyProvenance.mockReset().mockResolvedValue(AUTHORIZATION)
  })

  afterEach(() => vi.unstubAllEnvs())

  it("passes only App Server-verified authorization to the atomic store", async () => {
    await expect(executePrimaryAuthorizationBridge({
      repositoryPath: "C:\\repo",
      query: QUERY,
    })).resolves.toEqual({ status: "RECORDED" })

    expect(boundaries.verifyProvenance).toHaveBeenCalledWith({
      repositoryPath: "C:\\repo",
    })
    expect(boundaries.recordAuthorization).toHaveBeenCalledWith({
      query: QUERY,
      databaseUrl: "postgresql://controlled-test-value",
      authorization: AUTHORIZATION,
    })
  })

  it("does not reach persistence when App Server provenance fails", async () => {
    boundaries.verifyProvenance.mockRejectedValueOnce(
      Object.assign(new Error("wall"), { code: "CODEX_ACCOUNT_WALL" }),
    )
    await expect(executePrimaryAuthorizationBridge())
      .rejects.toMatchObject({ code: "CODEX_ACCOUNT_WALL" })
    expect(boundaries.recordAuthorization).not.toHaveBeenCalled()
  })
})
