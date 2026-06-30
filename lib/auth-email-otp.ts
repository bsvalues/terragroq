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
  providerLabel: string
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

const emailOtpProvider = {
  id: "resend" as const,
  label: "Resend",
}

function getEmailOtpMessage(type: EmailOtpType, otp: string) {
  switch (type) {
    case "forget-password":
      return {
        subject: "Reset your TerraGroq password",
        text: `Use ${otp} to reset your TerraGroq password. It expires in 5 minutes.`,
      }
    case "email-verification":
      return {
        subject: "Verify your TerraGroq email",
        text: `Use ${otp} to verify your TerraGroq email address. It expires in 5 minutes.`,
      }
    case "change-email":
      return {
        subject: "Confirm your TerraGroq email change",
        text: `Use ${otp} to confirm your TerraGroq email change. It expires in 5 minutes.`,
      }
    case "sign-in":
    default:
      return {
        subject: "Your TerraGroq sign-in code",
        text: `Use ${otp} to sign in to TerraGroq. It expires in 5 minutes.`,
      }
  }
}

export function getEmailOtpReadiness(env: EmailOtpEnv = process.env): EmailOtpReadiness {
  const enabled = isExplicitlyEnabled(env.AUTH_EMAIL_OTP_ENABLED)
  const hasApiKey = Boolean(env.RESEND_API_KEY?.trim())
  const hasFrom = Boolean(env.AUTH_EMAIL_FROM?.trim())

  if (!enabled) {
    return {
      enabled: false,
      configured: false,
      provider: emailOtpProvider.id,
      providerLabel: emailOtpProvider.label,
      fromConfigured: hasFrom,
      replyToConfigured: Boolean(env.AUTH_EMAIL_REPLY_TO?.trim()),
      reason: "Email OTP is scaffolded but disabled until AUTH_EMAIL_OTP_ENABLED=true.",
    }
  }

  if (!hasApiKey || !hasFrom) {
    return {
      enabled: true,
      configured: false,
      provider: emailOtpProvider.id,
      providerLabel: emailOtpProvider.label,
      fromConfigured: hasFrom,
      replyToConfigured: Boolean(env.AUTH_EMAIL_REPLY_TO?.trim()),
      reason: "Email OTP requires RESEND_API_KEY and AUTH_EMAIL_FROM before sending.",
    }
  }

  return {
    enabled: true,
    configured: true,
    provider: emailOtpProvider.id,
    providerLabel: emailOtpProvider.label,
    fromConfigured: true,
    replyToConfigured: Boolean(env.AUTH_EMAIL_REPLY_TO?.trim()),
    reason: `Email OTP is configured for ${emailOtpProvider.label}.`,
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
    // Public OTP request endpoints must not reveal whether an email belongs to
    // an operator. Missing provider config therefore no-ops uniformly.
    return
  }

  const message = getEmailOtpMessage(type, otp)
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
      subject: message.subject,
      text: message.text,
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
