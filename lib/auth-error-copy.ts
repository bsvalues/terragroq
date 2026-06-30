import type { AuthUxMode, AuthUxReadiness } from "@/lib/auth-ux-state"

export type AuthRecoveryCopy = {
  code:
    | "INVALID_CREDENTIALS"
    | "SIGNUP_LOCKED"
    | "SIGNUP_DISABLED"
    | "SETUP_REQUIRED"
    | "ORIGIN_NOT_TRUSTED"
    | "PROVIDER_UNAVAILABLE"
    | "UNEXPECTED_AUTH_FAILURE"
  title: string
  message: string
  recovery: string[]
  tone: "warning" | "blocked"
}

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value))
}

function hasBlockingSetupIssue(readiness?: AuthUxReadiness) {
  return (
    !readiness?.ready ||
    (readiness.issues ?? []).some((issue) => issue.severity === "error")
  )
}

function isBootstrapLocked(readiness?: AuthUxReadiness) {
  return readiness?.signup?.mode === "bootstrap" && readiness.signup.open === false
}

function isPolicyClosed(readiness?: AuthUxReadiness) {
  return readiness?.signup?.mode === "closed" && readiness.signup.open === false
}

export function getAuthRecoveryCopy({
  mode,
  rawMessage,
  readiness,
}: {
  mode: AuthUxMode
  rawMessage: string
  readiness?: AuthUxReadiness
}): AuthRecoveryCopy {
  const normalized = rawMessage.toLowerCase()

  if (
    matchesAny(normalized, [
      /\binvalid origin\b/,
      /\borigin .*not trusted\b/,
      /\bnot trusted\b/,
      /\bcors\b/,
    ])
  ) {
    return {
      code: "ORIGIN_NOT_TRUSTED",
      title: "This browser origin is not trusted",
      message:
        "The current URL is not allowed for auth callbacks or cookies in this environment.",
      recovery: [
        "Open the app from the canonical URL.",
        "For local setup, use localhost or add the current origin to BETTER_AUTH_TRUSTED_ORIGINS.",
        "Check GET /api/auth/origin-diagnostics for safe origin status.",
      ],
      tone: "blocked",
    }
  }

  if (
    matchesAny(normalized, [
      /\bprovider .*not configured\b/,
      /\boauth .*not configured\b/,
      /\bsocial .*not configured\b/,
      /\bprovider .*unavailable\b/,
    ])
  ) {
    return {
      code: "PROVIDER_UNAVAILABLE",
      title: "This sign-in provider is not configured",
      message:
        "Only email and password sign-in is available in this environment right now.",
      recovery: [
        "Use email and password.",
        "Google, GitHub, Microsoft, OTP, and magic-link sign-in require separate setup.",
      ],
      tone: "warning",
    }
  }

  if (
    mode === "sign-up" &&
    (normalized.includes("signup_disabled") ||
      normalized.includes("sign-up is disabled") ||
      normalized.includes("sign up is disabled") ||
      normalized.includes("sign-up is closed") ||
      normalized.includes("signup is closed") ||
      normalized.includes("operator sign-up"))
  ) {
    if (isBootstrapLocked(readiness)) {
      return {
        code: "SIGNUP_LOCKED",
        title: "Signup is intentionally locked",
        message:
          "Bootstrap has already completed because an operator account exists.",
        recovery: [
          "Use the sign-in screen with the existing operator account.",
          "If you need another account, use the future invite flow instead of public signup.",
        ],
        tone: "warning",
      }
    }

    if (isPolicyClosed(readiness)) {
      return {
        code: "SIGNUP_DISABLED",
        title: "Signup is disabled by policy",
        message:
          "This environment does not allow public account creation.",
        recovery: [
          "Use an existing operator account.",
          "Ask the platform owner for an invite or allowlist path when that lane is implemented.",
        ],
        tone: "warning",
      }
    }
  }

  if (
    matchesAny(normalized, [
      /\binvalid (email or password|credentials?)\b/,
      /\bincorrect password\b/,
      /\bwrong password\b/,
      /\bcredential(s)? (did not match|invalid)\b/,
      /\buser (not found|does not exist)\b/,
      /\bno user found\b/,
    ])
  ) {
    return {
      code: "INVALID_CREDENTIALS",
      title: "Email or password did not match",
      message:
        "The app could not verify those credentials for an existing operator account.",
      recovery: [
        "Check the email address and password.",
        "If this is the first operator account, use the create-account flow only while bootstrap is open.",
        "Password reset is not available yet; that is a separate recovery lane.",
      ],
      tone: "warning",
    }
  }

  if (hasBlockingSetupIssue(readiness)) {
    return {
      code: "SETUP_REQUIRED",
      title: "Authentication setup is incomplete",
      message:
        "The app cannot safely complete authentication until setup blockers are resolved.",
      recovery: [
        "Open the setup assistant.",
        "Verify database, auth secret, base URL, and trusted-origin settings.",
        "After changing local env values, restart the app process.",
      ],
      tone: "blocked",
    }
  }

  return {
    code: "UNEXPECTED_AUTH_FAILURE",
    title: "Authentication failed",
    message:
      "The sign-in attempt did not complete. Raw failure details are not shown here to avoid leaking sensitive configuration.",
    recovery: [
      "Try again once.",
      "If it repeats, check auth readiness and origin diagnostics.",
      "Do not change providers or environment settings without a narrow auth work order.",
    ],
    tone: "warning",
  }
}
