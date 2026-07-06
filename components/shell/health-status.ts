import type { AuthReadiness } from "@/lib/auth-readiness"

export type HealthTone = "ready" | "warn" | "blocked"

export type SignupStatus = {
  tone: HealthTone
  label: string
  title: string
}

function isBootstrapCheckFailure(reason?: string) {
  const lower = reason?.toLowerCase()
  return (
    lower?.startsWith("bootstrap sign-up check failed") ||
    lower?.startsWith("bootstrap owner provisioning check failed")
  )
}

export function getSignupStatus(readiness: AuthReadiness): SignupStatus {
  if (!readiness.databaseReady || !readiness.authReady) {
    return {
      tone: "blocked",
      label: `Provisioning: ${readiness.signup.mode}`,
      title: "Owner provisioning policy cannot be trusted until auth/database readiness is restored.",
    }
  }

  if (readiness.signup.mode === "bootstrap") {
    if (!readiness.signup.open && isBootstrapCheckFailure(readiness.signup.reason)) {
      return {
        tone: "blocked",
        label: "Provisioning: bootstrap check failed",
        title: readiness.signup.reason ?? "Bootstrap owner provisioning check failed.",
      }
    }

    return readiness.signup.open
      ? {
          tone: "warn",
          label: "Provisioning: bootstrap open",
          title: "Controlled owner provisioning is open until the Primary Operator exists.",
        }
      : {
          tone: "ready",
          label: "Provisioning: secured",
          title: "Owner provisioning is locked because a Primary Operator already exists.",
        }
  }

  if (readiness.signup.mode === "closed") {
    return {
      tone: "warn",
      label: "Provisioning: closed",
      title: readiness.signup.reason ?? "Owner provisioning is disabled by policy.",
    }
  }

  return {
    tone: "ready",
    label: "Provisioning: controlled",
    title: "Owner provisioning is controlled by policy.",
  }
}
