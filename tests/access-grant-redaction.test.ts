import { describe, expect, it } from "vitest"
import {
  isForbiddenAccessGrantAuditField,
  redactAccessGrantAuditMetadata,
} from "@/lib/access-grants/redaction"

describe("access grant audit redaction", () => {
  it("recognizes forbidden audit fields case-insensitively", () => {
    expect(isForbiddenAccessGrantAuditField("rawToken")).toBe(true)
    expect(isForbiddenAccessGrantAuditField("RAWTOKEN")).toBe(true)
    expect(isForbiddenAccessGrantAuditField("tokenPrefix")).toBe(false)
    expect(isForbiddenAccessGrantAuditField("correlationId")).toBe(false)
  })

  it("removes raw tokens, hashes, OTPs, secrets, and email bodies", () => {
    const redacted = redactAccessGrantAuditMetadata({
      rawToken: "wag_secret",
      publicTokenHash: "hash",
      otpCode: "123456",
      providerSecret: "provider-secret",
      emailBody: "hello",
      tokenPrefix: "wag_abcd",
      correlationId: "corr_1",
    })

    expect(redacted).toEqual({
      tokenPrefix: "wag_abcd",
      correlationId: "corr_1",
    })
  })

  it("redacts nested objects and arrays without removing safe diagnostics", () => {
    const redacted = redactAccessGrantAuditMetadata({
      reasonCode: "TOKEN_MALFORMED",
      nested: {
        token: "raw",
        targetResourceType: "evidence_packet",
      },
      attempts: [
        { sessionToken: "session", outcome: "denied" },
        { tokenPrefix: "wag_1234", outcome: "allowed" },
      ],
    })

    expect(redacted).toEqual({
      reasonCode: "TOKEN_MALFORMED",
      nested: {
        targetResourceType: "evidence_packet",
      },
      attempts: [{ outcome: "denied" }, { tokenPrefix: "wag_1234", outcome: "allowed" }],
    })
  })
})
