import { describe, expect, it } from "vitest"

import { buildAppleTrustProfile, certificateBodies, onboardingSteps } from "../lib/device-onboarding"

const BODY = "MIIBValidLookingBase64Body+/=="
const PEM = `-----BEGIN CERTIFICATE-----\n${BODY}\n-----END CERTIFICATE-----\n`

const input = {
  certificatePem: PEM,
  displayName: "WilliamOS",
  identifier: "lan.williamos.trust",
  profileUuid: "11111111-2222-4333-8444-555555555555",
  payloadUuid: "66666666-7777-4888-8999-aaaaaaaaaaaa",
  origin: "https://williamos.lan:3443",
}

describe("device onboarding trust profile (issue #803)", () => {
  it("extracts the base64 DER body from a PEM certificate", () => {
    expect(certificateBodies(PEM)).toEqual([BODY])
    expect(certificateBodies("not a pem")).toEqual([])
    expect(certificateBodies(undefined as unknown as string)).toEqual([])
  })

  it("carries every certificate in a bundle", () => {
    const bundle = PEM + `-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n`
    expect(certificateBodies(bundle)).toEqual([BODY, "QUJD"])
    const profile = buildAppleTrustProfile({ ...input, certificatePem: bundle })
    expect(profile.match(/com\.apple\.security\.root/g)).toHaveLength(2)
  })

  it("builds a root-certificate configuration profile for the origin", () => {
    const profile = buildAppleTrustProfile(input)
    expect(profile.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(profile).toContain("<key>PayloadType</key><string>com.apple.security.root</string>")
    expect(profile).toContain(input.identifier)
    expect(profile).toContain(input.profileUuid)
    expect(profile).toContain("https://williamos.lan:3443")
    // the certificate body survives, wrapped
    expect(profile.replace(/\s+/g, "")).toContain(BODY.replace(/\s+/g, ""))
  })

  it("refuses to emit a profile that would install cleanly and trust nothing", () => {
    expect(() => buildAppleTrustProfile({ ...input, certificatePem: "" })).toThrow("TRUST_PROFILE_NO_CERTIFICATE")
    expect(() => buildAppleTrustProfile({ ...input, certificatePem: "-----BEGIN CERTIFICATE-----\n\n-----END CERTIFICATE-----" }))
      .toThrow("TRUST_PROFILE_NO_CERTIFICATE")
  })

  it("escapes values so a hostile display name cannot break the plist", () => {
    const profile = buildAppleTrustProfile({ ...input, displayName: 'Will<&>"OS' })
    expect(profile).toContain("Will&lt;&amp;&gt;&quot;OS")
    expect(profile).not.toContain('Will<&>"OS')
  })

  it("states the taps Apple actually requires, ending back at the cockpit", () => {
    const steps = onboardingSteps("apple", input.origin)
    expect(steps).toHaveLength(4)
    expect(steps[2]).toContain("Certificate Trust Settings")
    expect(steps.at(-1)).toContain(input.origin)
    expect(onboardingSteps("other", input.origin).at(-1)).toContain("Add this device")
  })
})
