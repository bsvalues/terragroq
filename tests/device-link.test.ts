import crypto from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  createDeviceLinkCode,
  deviceLinkEntryUrl,
  deviceLinkExpiry,
  formatDeviceLinkCode,
  hashDeviceLinkCode,
  inspectDeviceLink,
  normalizeDeviceLinkCode,
} from "../lib/device-link"

describe("device link codes", () => {
  it("mints an unambiguous code and stores only its digest", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = createDeviceLinkCode()
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
      // the confusable letters must never be minted
      expect(code).not.toMatch(/[ILOU]/)
    }
    const code = createDeviceLinkCode()
    expect(hashDeviceLinkCode(code)).toBe(crypto.createHash("sha256").update(code).digest("hex"))
  })

  it("forgives how a human actually types it", () => {
    const code = createDeviceLinkCode()
    const typed = `${code.slice(0, 4).toLowerCase()} - ${code.slice(4).toLowerCase()}`
    expect(normalizeDeviceLinkCode(typed)).toBe(code)
    // the classic misreadings map onto the character that was actually minted
    expect(normalizeDeviceLinkCode("I2345678")).toBe("12345678")
    expect(normalizeDeviceLinkCode("l2345678")).toBe("12345678")
    expect(normalizeDeviceLinkCode("O2345678")).toBe("02345678")
    expect(normalizeDeviceLinkCode("U2345678")).toBe("V2345678")
  })

  it("rejects anything that is not a code", () => {
    for (const bad of ["", "short", "../../etc/passwd", "123456789", null, undefined, 42]) {
      expect(normalizeDeviceLinkCode(bad)).toBeNull()
    }
    expect(() => hashDeviceLinkCode("nope")).toThrow("DEVICE_LINK_CODE_INVALID")
  })

  it("groups the code for reading off a screen", () => {
    expect(formatDeviceLinkCode("ABCD2345")).toBe("ABCD-2345")
  })

  it("treats an unused code inside its window as usable", () => {
    const now = new Date("2026-08-17T00:00:00.000Z")
    expect(inspectDeviceLink({ expiresAt: new Date(now.getTime() + 1000), consumedAt: null }, now)).toEqual({ usable: true })
  })

  it("fails closed on an expired or already-redeemed code", () => {
    const now = new Date("2026-08-17T00:00:00.000Z")
    expect(inspectDeviceLink({ expiresAt: new Date(now.getTime() - 1), consumedAt: null }, now))
      .toEqual({ usable: false, reason: "EXPIRED" })
    expect(inspectDeviceLink({ expiresAt: new Date(now.getTime() + 60_000), consumedAt: now }, now))
      .toEqual({ usable: false, reason: "ALREADY_USED" })
    expect(inspectDeviceLink({ expiresAt: now, consumedAt: null }, now)).toEqual({ usable: false, reason: "EXPIRED" })
    expect(inspectDeviceLink({ expiresAt: "not a date", consumedAt: null }, now)).toEqual({ usable: false, reason: "EXPIRED" })
  })

  it("expires two minutes out by default and points at the entry page", () => {
    const now = new Date("2026-08-17T00:00:00.000Z")
    expect(deviceLinkExpiry(now).toISOString()).toBe("2026-08-17T00:02:00.000Z")
    expect(deviceLinkEntryUrl("https://hermes.local:3443/")).toBe("https://hermes.local:3443/link")
  })
})
