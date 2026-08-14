import { generateKeyPairSync, sign } from "node:crypto"
import { describe, expect, it } from "vitest"

import {
  DEVICE_AUTH_HEADER,
  buildDeviceProof,
  deviceSessionCookieOptions,
  hashOpaqueValue,
  validateDeviceMutationOrigin,
  verifyDeviceProof,
} from "@/lib/device-auth/contract"

describe("device authentication contract", () => {
  it("builds a bounded, domain-separated proof and verifies Ed25519", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    const proof = buildDeviceProof({
      purpose: "authenticate",
      challengeId: "3d75bc60-22da-4f75-bc1b-f88a145ce8de",
      challenge: "a".repeat(43),
      origin: "https://hermes.example.com",
      expiresAt: "2026-08-13T20:00:00.000Z",
    })
    const signature = sign(null, Buffer.from(proof), privateKey).toString("base64url")
    const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64url")

    expect(proof).toContain("williamos-device-auth-v1\npurpose=authenticate\n")
    expect(verifyDeviceProof({ proof, signature, publicKeySpki: spki })).toBe(true)
    expect(verifyDeviceProof({ proof: `${proof}x`, signature, publicKeySpki: spki })).toBe(false)
  })

  it("requires an exact trusted Origin and non-simple device header", () => {
    const trusted = ["https://hermes.example.com"]
    const valid = new Request("https://hermes.example.com/api/device/challenge", {
      method: "POST",
      headers: { origin: trusted[0], [DEVICE_AUTH_HEADER]: "1" },
    })
    expect(validateDeviceMutationOrigin(valid, trusted)).toBe(trusted[0])

    for (const headers of [
      new Headers({ origin: "https://evil.example.com", [DEVICE_AUTH_HEADER]: "1" }),
      new Headers({ origin: trusted[0] }),
      new Headers({ [DEVICE_AUTH_HEADER]: "1" }),
    ]) {
      expect(() => validateDeviceMutationOrigin(new Request(valid.url, { method: "POST", headers }), trusted))
        .toThrow("DEVICE_ORIGIN_REJECTED")
    }
  })

  it("hashes opaque values and never returns the input", () => {
    const value = "opaque-secret-value"
    const digest = hashOpaqueValue(value)
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).not.toContain(value)
    expect(hashOpaqueValue(value)).toBe(digest)
  })

  it("uses a host-only HttpOnly bounded cookie with production TLS", () => {
    expect(deviceSessionCookieOptions(true)).toEqual(expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 43_200,
    }))
    expect(deviceSessionCookieOptions(false).secure).toBe(false)
  })
})
