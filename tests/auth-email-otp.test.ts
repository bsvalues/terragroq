import { describe, expect, it, vi } from "vitest"
import {
  createEmailOtpOptions,
  getEmailOtpReadiness,
  sendEmailOtp,
} from "@/lib/auth-email-otp"

describe("auth email OTP scaffolding", () => {
  it("is disabled until explicitly enabled", () => {
    const readiness = getEmailOtpReadiness({})

    expect(readiness.enabled).toBe(false)
    expect(readiness.configured).toBe(false)
    expect(readiness.providerLabel).toBe("Resend")
    expect(readiness.reason).toContain("AUTH_EMAIL_OTP_ENABLED=true")
  })

  it("no-ops uniformly when provider config is missing", async () => {
    const fetchImpl = vi.fn()

    await sendEmailOtp({
      email: "operator@example.com",
      otp: "123456",
      type: "sign-in",
      env: { AUTH_EMAIL_OTP_ENABLED: "true" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("can use direct Resend fetch when explicitly configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    await sendEmailOtp({
      email: "operator@example.com",
      otp: "123456",
      type: "forget-password",
      env: {
        AUTH_EMAIL_OTP_ENABLED: "true",
        RESEND_API_KEY: "test-key",
        AUTH_EMAIL_FROM: "TerraGroq <auth@example.com>",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
        }),
      }),
    )
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(body.subject).toBe("Reset your TerraGroq password")
    expect(body.text).toContain("reset your TerraGroq password")
  })

  it("hard-gates OTP sign-in against implicit user creation", () => {
    const options = createEmailOtpOptions()

    expect(options.disableSignUp).toBe(true)
    expect(options.rateLimit).toEqual({ window: 60, max: 3 })
    expect(options.storeOTP).toBe("hashed")
  })
})
