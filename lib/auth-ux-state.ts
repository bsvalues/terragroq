export type AuthUxIssue = {
  code: string
  severity: "error" | "warning"
  message: string
}

export type AuthUxReadiness = {
  ready: boolean
  issues: AuthUxIssue[]
  signup?: {
    mode: "open" | "bootstrap" | "closed"
    open: boolean
    reason?: string
  }
}

export type AuthUxMode = "sign-in" | "sign-up"

export type AuthUxState =
  | "setup-required"
  | "owner-provisioning"
  | "sign-in"
  | "provisioning-locked"
  | "provisioning-disabled"

export type AuthUxCopy = {
  state: AuthUxState
  label: string
  title: string
  description: string
  primaryAction: string
  secondaryAction?: {
    href: string
    label: string
  }
  tone: "ready" | "warning" | "blocked" | "neutral"
}

export function getAuthUxState(
  mode: AuthUxMode,
  readiness?: AuthUxReadiness,
): AuthUxCopy {
  const blockingIssues = (readiness?.issues ?? []).filter(
    (issue) => issue.severity === "error",
  )
  if (!readiness?.ready || blockingIssues.length > 0) {
    return {
      state: "setup-required",
      label: "Setup required",
      title: "Authentication setup is incomplete",
      description:
        "Finish database, secret, base URL, and trusted-origin setup before signing in.",
      primaryAction: "Authentication blocked",
      secondaryAction: { href: "/setup", label: "Open setup assistant" },
      tone: "blocked",
    }
  }

  const signup = readiness.signup
  if (mode === "sign-up") {
    if (signup?.mode === "bootstrap" && signup.open) {
      return {
        state: "owner-provisioning",
        label: "Owner provisioning",
        title: "Provision Primary Operator",
        description:
          "Controlled bootstrap is open because no Primary Operator exists yet. This is owner-authorized provisioning only.",
        primaryAction: "Provision Primary Operator",
        secondaryAction: { href: "/sign-in", label: "Already provisioned? Enter" },
        tone: "ready",
      }
    }

    if (signup?.mode === "bootstrap") {
      return {
        state: "provisioning-locked",
        label: "Provisioning locked",
        title: "Bootstrap is complete",
        description:
          signup.reason ??
          "A Primary Operator already exists, so owner provisioning is intentionally closed.",
        primaryAction: "Enter WilliamOS instead",
        secondaryAction: { href: "/sign-in", label: "Go to Primary Operator access" },
        tone: "neutral",
      }
    }

    return {
      state: "provisioning-disabled",
      label: "Provisioning disabled",
      title: "Owner provisioning is unavailable",
      description:
        signup?.reason ??
        "This private system does not offer self-service provisioning. Use authorized Primary access.",
      primaryAction: "Enter WilliamOS instead",
      secondaryAction: { href: "/sign-in", label: "Go to Primary Operator access" },
      tone: "warning",
    }
  }

  return {
    state: "sign-in",
    label: "Primary Operator access",
    title: "Enter WilliamOS",
    // GOAL-0018: speak to the owner, not about provisioning. Both closed-signup branches previously
    // narrated internal state ("provisioning is locked because a Primary Operator already exists")
    // at the one person who already knows they are the Primary Operator. Signup being closed is the
    // expected steady state here, not a status worth reporting on the sign-in page. Only the copy
    // changes: state, tone, label, and actions are untouched, so nothing that gates access moves.
    description:
      (signup?.mode === "bootstrap" && signup.open === false) || signup?.mode === "closed"
        ? "Welcome back."
        : "Auth is ready. Use your Primary Operator credentials to enter WilliamOS.",
    primaryAction: "Enter WilliamOS",
    secondaryAction: undefined,
    tone: "ready",
  }
}
