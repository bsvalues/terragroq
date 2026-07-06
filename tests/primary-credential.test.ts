import { describe, expect, it } from "vitest"
import {
  classifyPrimaryCredentialOperation,
  validatePrimaryCredentialPayload,
} from "@/lib/primary-credential"
import {
  DECLARED_PRIMARY_EMAIL,
  classifyLocalAuthIdentity,
  getPrimaryIdentityCandidates,
  getQuarantinedLocalAuthIdentities,
  isDeclaredPrimaryEmail,
} from "@/lib/primary-identity"

describe("Primary credential setup helpers", () => {
  it("classifies empty auth state as provisioning", () => {
    expect(classifyPrimaryCredentialOperation(false)).toBe("provisioning")
  })

  it("classifies existing auth state as recovery", () => {
    expect(classifyPrimaryCredentialOperation(true)).toBe("recovery")
  })

  it("validates and normalizes credential input without exposing secret values", () => {
    const input = validatePrimaryCredentialPayload({
      email: "  Primary@Example.COM ",
      name: " Primary Operator ",
      password: "owner-password",
      confirmPassword: "owner-password",
    })

    expect(input.email).toBe("primary@example.com")
    expect(input.name).toBe("Primary Operator")
    expect(input.password).toBe("owner-password")
  })

  it("rejects mismatched password confirmation", () => {
    expect(() =>
      validatePrimaryCredentialPayload({
        email: "primary@example.com",
        password: "owner-password",
        confirmPassword: "different-password",
      }),
    ).toThrow("confirmation did not match")
  })

  it("declares the owner-approved Primary email", () => {
    expect(DECLARED_PRIMARY_EMAIL).toBe("bsvalues@gmail.com")
    expect(isDeclaredPrimaryEmail(" BSVALUES@gmail.com ")).toBe(true)
  })

  it("quarantines known seed, test, and diagnostic auth records", () => {
    expect(classifyLocalAuthIdentity("operator@command.io")).toBe("seed/demo/test record")
    expect(classifyLocalAuthIdentity("test+wo@example.com")).toBe("test/work-order record")
    expect(classifyLocalAuthIdentity("diag+1782790395@example.com")).toBe(
      "diagnostic/generated record",
    )
  })

  it("offers only the declared Primary as an owner identity candidate", () => {
    const candidates = [
      { email: "operator@command.io", name: "Ops Lead" },
      { email: "test+wo@example.com", name: "Test Operator" },
      { email: "bsvalues@gmail.com", name: "bill" },
      { email: "diag+1782790395@example.com", name: "Diag User" },
    ]

    expect(getPrimaryIdentityCandidates(candidates)).toEqual([
      { email: "bsvalues@gmail.com", name: "bill" },
    ])
    expect(getQuarantinedLocalAuthIdentities(candidates)).toHaveLength(3)
  })
})
