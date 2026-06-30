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
  | "create-first-operator"
  | "sign-in"
  | "signup-locked"
  | "signup-disabled"

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
    if (!signup || signup.open) {
      return {
        state: "create-first-operator",
        label: signup?.mode === "bootstrap" ? "Primary Operator" : "Access open",
        title: "Create the Primary Operator",
        description:
          signup?.mode === "bootstrap"
            ? "Bootstrap is open because no operator exists yet."
            : "Account creation is currently open by policy.",
        primaryAction: "Create Primary Operator",
        secondaryAction: { href: "/sign-in", label: "Already provisioned? Enter" },
        tone: "ready",
      }
    }

    if (signup?.mode === "bootstrap") {
      return {
        state: "signup-locked",
        label: "Signup locked",
        title: "Bootstrap is complete",
        description:
          signup.reason ??
          "An operator already exists, so public account creation is intentionally closed.",
        primaryAction: "Enter WilliamOS instead",
        secondaryAction: { href: "/sign-in", label: "Go to Primary Operator access" },
        tone: "neutral",
      }
    }

    return {
      state: "signup-disabled",
      label: "Signup disabled",
      title: "Account creation requires an invite",
      description:
        signup?.reason ??
        "Public account creation is disabled. Use an existing operator account.",
      primaryAction: "Enter WilliamOS instead",
      secondaryAction: { href: "/sign-in", label: "Go to Primary Operator access" },
      tone: "warning",
    }
  }

  return {
    state: "sign-in",
    label: "Primary Operator access",
    title: "Enter WilliamOS",
    description:
      signup?.mode === "bootstrap" && signup.open === false
        ? "Auth is ready. Signup may be locked because an operator already exists."
        : signup?.mode === "closed"
          ? "Auth is ready. New account creation is disabled by policy."
        : "Auth is ready. Use your Primary Operator credentials to enter WilliamOS.",
    primaryAction: "Enter WilliamOS",
    secondaryAction: signup?.open
      ? {
          href: "/sign-up",
          label: signup.mode === "bootstrap" ? "Create Primary Operator" : "Request access",
        }
      : undefined,
    tone: "ready",
  }
}
