import type { EmailOTPOptions } from "better-auth/plugins/email-otp"

export type EmailOtpType =
  | "sign-in"
  | "email-verification"
  | "forget-password"
  | "change-email"

export type EmailOtpReadiness = {
  enabled: boolean
  configured: boolean
  provider: "resend"
  fromConfigured: boolean
  replyToConfigured: boolean
  reason: string
}

export type EmailOtpEnv = Record<string, string | undefined> & {
  AUTH_EMAIL_OTP_ENABLED?: string
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
  AUTH_EMAIL_REPLY_TO?: string
}

function isExplicitlyEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true"
}

export function getEmailOtpReadiness(env: EmailOtpEnv = process.env): EmailOtpReadiness {
  const enabled = isExplicitlyEnabled(env.AUTH_EMAIL_OTP_ENABLED)
  const hasApiKey = Boolean(env.RESEND_API_KEY?.trim())
  const hasFrom = Boolean(env.AUTH_EMAIL_FROM?.trim())

  if (!enabled) {
    return {
      enabled: false,
      configured: false,
      provider: "resend",
      fromConfigured: hasFrom,
      replyToConfigured: Boolean(env.AUTH_EMAIL_REPLY_TO?.trim()),
      reason: "Email OTP is scaffolded but disabled until AUTH_EMAIL_OTP_ENABLED=true.",
    }
  }

  if (!hasApiKey || !hasFrom) {
    return {
      enabled: true,
      configured: false,
      provider: "resend",
      fromConfigured: hasFrom,
      replyToConfigured: Boolean(env.AUTH_EMAIL_REPLY_TO?.trim()),
      reason: "Email OTP requires RESEND_API_KEY and AUTH_EMAIL_FROM before sending.",
    }
  }

  return {
    enabled: true,
    configured: true,
    provider: "resend",
    fromConfigured: true,
    replyToConfigured: Boolean(env.AUTH_EMAIL_REPLY_TO?.trim()),
    reason: "Email OTP is configured for Resend.",
  }
}

export async function sendEmailOtp({
  email,
  otp,
  type,
  env = process.env,
  fetchImpl = fetch,
}: {
  email: string
  otp: string
  type: EmailOtpType
  env?: EmailOtpEnv
  fetchImpl?: typeof fetch
}) {
  const readiness = getEmailOtpReadiness(env)
  if (!readiness.configured) {
    throw new Error("EMAIL_OTP_PROVIDER_UNAVAILABLE")
  }

  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM,
      to: email,
      reply_to: env.AUTH_EMAIL_REPLY_TO?.trim() || undefined,
      subject: type === "forget-password" ? "Reset your TerraGroq password" : "Your TerraGroq sign-in code",
      text: `Your TerraGroq code is ${otp}. It expires in 5 minutes.`,
    }),
  })

  if (!res.ok) {
    throw new Error(`EMAIL_OTP_SEND_FAILED:${res.status}`)
  }
}

export function createEmailOtpOptions(): EmailOTPOptions {
  return {
    disableSignUp: true,
    expiresIn: 300,
    allowedAttempts: 3,
    storeOTP: "hashed",
    rateLimit: {
      window: 60,
      max: 3,
    },
    sendVerificationOTP: async ({ email, otp, type }) => {
      await sendEmailOtp({ email, otp, type })
    },
  }
}
