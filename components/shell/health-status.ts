import type { AuthReadiness } from "@/lib/auth-readiness"

export type HealthTone = "ready" | "warn" | "blocked"

export type SignupStatus = {
  tone: HealthTone
  label: string
  title: string
}

export function getSignupStatus(readiness: AuthReadiness): SignupStatus {
  if (!readiness.databaseReady || !readiness.authReady) {
    return {
      tone: "blocked",
      label: `Signup: ${readiness.signup.mode}`,
      title: "Signup policy cannot be trusted until auth readiness is restored.",
    }
  }

  if (readiness.signup.mode === "bootstrap") {
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
