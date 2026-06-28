import type { AuthReadiness } from "@/lib/auth-readiness"

export type HealthTone = "ready" | "warn" | "blocked"

export type SignupStatus = {
  tone: HealthTone
  label: string
  title: string
}

function isBootstrapCheckFailure(reason?: string) {
  return reason?.toLowerCase().startsWith("bootstrap sign-up check failed")
}

export function getSignupStatus(readiness: AuthReadiness): SignupStatus {
  if (!readiness.databaseReady || !readiness.authReady) {
    return {
      tone: "blocked",
      label: `Signup: ${readiness.signup.mode}`,
      title: "Signup policy cannot be trusted until auth/database readiness is restored.",
    }
  }

  if (readiness.signup.mode === "bootstrap") {
    if (!readiness.signup.open && isBootstrapCheckFailure(readiness.signup.reason)) {
      return {
        tone: "blocked",
        label: "Signup: bootstrap check failed",
        title: readiness.signup.reason ?? "Bootstrap sign-up check failed.",
      }
    }

    return readiness.signup.open
      ? {
          tone: "warn",
          label: "Signup: bootstrap open",
          title: "Bootstrap signup is open until the first operator account is created.",
        }
      : {
          tone: "ready",
          label: "Signup: secured",
          title: "Bootstrap signup is locked because an operator account already exists.",
        }
  }

  if (readiness.signup.mode === "closed") {
    return {
      tone: "warn",
      label: "Signup: closed",
      title: readiness.signup.reason ?? "Operator signup is disabled by policy.",
    }
  }

  return {
    tone: "ready",
    label: "Signup: open",
    title: "Operator signup is open by policy.",
  }
}
