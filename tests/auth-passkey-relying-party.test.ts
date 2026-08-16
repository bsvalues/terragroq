import { describe, expect, it } from "vitest"

import { passkeyUnavailableCopy, resolvePasskeyRelyingParty } from "../lib/auth-passkey"

describe("passkey relying-party resolution (issue #803)", () => {
  it("binds the relying party to the hostname of the canonical auth origin", () => {
    expect(resolvePasskeyRelyingParty("https://williamos.lan:3443")).toEqual({
      available: true,
      relyingParty: { rpID: "williamos.lan", rpName: "WilliamOS", origin: "https://williamos.lan:3443" },
    })
  })

  it("refuses an IP-address origin, which WebAuthn cannot bind a credential to", () => {
    const resolution = resolvePasskeyRelyingParty("https://192.168.88.9:3443")
    expect(resolution.available).toBe(false)
    expect(resolution).toMatchObject({ reason: "IP_ADDRESS_ORIGIN" })
    expect(passkeyUnavailableCopy(resolution)).toContain("williamos.lan")
  })

  it("refuses an IPv6 literal origin", () => {
    expect(resolvePasskeyRelyingParty("https://[2001:db8::1]:3443")).toMatchObject({
      available: false,
      reason: "IP_ADDRESS_ORIGIN",
    })
  })

  it("refuses a plain-http origin that is not localhost", () => {
    expect(resolvePasskeyRelyingParty("http://williamos.lan:3443")).toMatchObject({
      available: false,
      reason: "INSECURE_ORIGIN",
    })
  })

  it("allows http on localhost, which browsers treat as a secure context", () => {
    expect(resolvePasskeyRelyingParty("http://localhost:3000")).toEqual({
      available: true,
      relyingParty: { rpID: "localhost", rpName: "WilliamOS", origin: "http://localhost:3000" },
    })
  })

  it("fails closed when the auth base URL is absent or unparseable", () => {
    expect(resolvePasskeyRelyingParty(undefined)).toMatchObject({ available: false, reason: "NO_AUTH_BASE_URL" })
    expect(resolvePasskeyRelyingParty("")).toMatchObject({ available: false, reason: "NO_AUTH_BASE_URL" })
    expect(resolvePasskeyRelyingParty("not a url")).toMatchObject({ available: false, reason: "AUTH_BASE_URL_INVALID" })
  })

  it("reports no copy when passkeys are available", () => {
    expect(passkeyUnavailableCopy(resolvePasskeyRelyingParty("https://williamos.lan:3443"))).toBeNull()
  })
})
