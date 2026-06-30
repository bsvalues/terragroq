import { ACCESS_GRANT_LIMITER_DEFAULTS } from "./constants"

export type AccessGrantLimiterSnapshot = {
  attempts: number
  windowStartedAt: Date
  lastAttemptAt?: Date
}

export type AccessGrantLimiterPolicy = {
  maxAttempts: number
  windowMs: number
  cooldownMs: number
}

export type AccessGrantLimiterDecision =
  | { allowed: true; remaining: number; resetAt: Date }
  | { allowed: false; reason: "window_exhausted" | "cooldown"; retryAt: Date; resetAt: Date }

export function evaluateAccessGrantLimiter(
  snapshot: AccessGrantLimiterSnapshot,
  now: Date = new Date(),
  policy: AccessGrantLimiterPolicy = ACCESS_GRANT_LIMITER_DEFAULTS,
): AccessGrantLimiterDecision {
  const windowResetAt = new Date(snapshot.windowStartedAt.getTime() + policy.windowMs)
  if (now >= windowResetAt) {
    return {
      allowed: true,
      remaining: policy.maxAttempts - 1,
      resetAt: new Date(now.getTime() + policy.windowMs),
    }
  }

  if (snapshot.lastAttemptAt) {
    const cooldownUntil = new Date(snapshot.lastAttemptAt.getTime() + policy.cooldownMs)
    if (now < cooldownUntil) {
      return {
        allowed: false,
        reason: "cooldown",
        retryAt: cooldownUntil,
        resetAt: windowResetAt,
      }
    }
  }

  if (snapshot.attempts >= policy.maxAttempts) {
    return {
      allowed: false,
      reason: "window_exhausted",
      retryAt: windowResetAt,
      resetAt: windowResetAt,
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, policy.maxAttempts - snapshot.attempts - 1),
    resetAt: windowResetAt,
  }
}
