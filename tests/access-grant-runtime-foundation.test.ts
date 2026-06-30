import { describe, expect, it } from "vitest"
import { buildAccessGrantAuditEvent } from "@/lib/access-grants/audit"
import { evaluateAccessGrantLimiter } from "@/lib/access-grants/limiter"
import {
  acceptAccessGrantPreview,
  issueAccessGrantPreview,
} from "@/lib/access-grants/service"
import {
  generateAccessGrantToken,
  hashAccessGrantToken,
  parseAccessGrantToken,
  safeCompareAccessGrantTokenHash,
} from "@/lib/access-grants/token"

describe("access grant runtime foundation", () => {
  it("generates and parses access grant tokens without embedding metadata", () => {
    const token = generateAccessGrantToken()
    const parsed = parseAccessGrantToken(token)

    expect(token).toMatch(/^wag_[A-Za-z0-9_-]+$/)
    expect(parsed).toMatchObject({
      ok: true,
      tokenPrefix: token.slice(0, 12),
    })
    expect(token).not.toContain("user")
    expect(token).not.toContain("email")
    expect(token).not.toContain("scope")
  })

  it("classifies malformed tokens before any lookup", () => {
    expect(parseAccessGrantToken("")).toEqual({ ok: false, reason: "missing" })
    expect(parseAccessGrantToken("abc_123")).toEqual({
      ok: false,
      reason: "unsupported_prefix",
    })
    expect(parseAccessGrantToken(`wag_${"*".repeat(200)}`)).toEqual({
      ok: false,
      reason: "too_long",
    })
    expect(parseAccessGrantToken("wag_***")).toEqual({ ok: false, reason: "malformed" })
  })

  it("hashes tokens with caller-provided pepper and compares safely", () => {
    const token = "wag_testtoken"
    const hash = hashAccessGrantToken(token, "pepper-one")
    const same = hashAccessGrantToken(token, "pepper-one")
    const different = hashAccessGrantToken(token, "pepper-two")

    expect(hash).toHaveLength(64)
    expect(safeCompareAccessGrantTokenHash(hash, same)).toBe(true)
    expect(safeCompareAccessGrantTokenHash(hash, different)).toBe(false)
    expect(() => hashAccessGrantToken(token, "")).toThrow(/pepper is required/)
  })

  it("builds audit event drafts with forbidden metadata redacted", () => {
    const event = buildAccessGrantAuditEvent({
      correlationId: "corr_1",
      eventType: "access_grant_validation_denied",
      actorType: "recipient",
      outcome: "denied",
      reasonCode: "TOKEN_MALFORMED",
      metadata: {
        rawToken: "wag_secret",
        tokenPrefix: "wag_1234",
        nested: { otpCode: "123456", outcome: "denied" },
      },
    })

    expect(event.metadata).toEqual({
      tokenPrefix: "wag_1234",
      nested: { outcome: "denied" },
    })
  })

  it("evaluates limiter windows without persisting state", () => {
    const now = new Date("2026-06-30T00:00:10Z")
    const policy = { maxAttempts: 2, windowMs: 60_000, cooldownMs: 5_000 }

    expect(
      evaluateAccessGrantLimiter(
        { attempts: 1, windowStartedAt: new Date("2026-06-30T00:00:00Z") },
        now,
        policy,
      ),
    ).toMatchObject({ allowed: true, remaining: 0 })

    expect(
      evaluateAccessGrantLimiter(
        {
          attempts: 1,
          windowStartedAt: new Date("2026-06-30T00:00:00Z"),
          lastAttemptAt: new Date("2026-06-30T00:00:08Z"),
        },
        now,
        policy,
      ),
    ).toMatchObject({ allowed: false, reason: "cooldown" })

    expect(
      evaluateAccessGrantLimiter(
        { attempts: 2, windowStartedAt: new Date("2026-06-30T00:00:00Z") },
        now,
        policy,
      ),
    ).toMatchObject({ allowed: false, reason: "window_exhausted" })
  })

  it("keeps issuing and accepting disabled while returning redacted audit drafts", () => {
    const issue = issueAccessGrantPreview(
      { enabled: false },
      {
        scope: "grant:evidence.read",
        targetResourceType: "evidence_packet",
        targetResourceId: "EV-0001",
        createdByOperatorId: "operator-1",
        createdReason: "review",
      },
    )

    expect(issue).toMatchObject({
      ok: false,
      reason: "runtime_disabled",
      auditEvent: {
        outcome: "disabled",
        reasonCode: "RUNTIME_DISABLED",
      },
    })

    const accept = acceptAccessGrantPreview({ enabled: false }, "wag_secret")

    expect(accept).toMatchObject({
      ok: false,
      reason: "runtime_disabled",
      auditEvent: {
        outcome: "disabled",
        reasonCode: "RUNTIME_DISABLED",
      },
    })
    expect(JSON.stringify(accept)).not.toContain("wag_secret")
  })
})
