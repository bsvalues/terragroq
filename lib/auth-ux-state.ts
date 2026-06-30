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
      primaryAction: "Open setup assistant",
      secondaryAction: { href: "/setup", label: "Open setup assistant" },
      tone: "blocked",
    }
  }

  const signup = readiness.signup
  if (mode === "sign-up") {
    if (signup?.open) {
      return {
        state: "create-first-operator",
        label: signup.mode === "bootstrap" ? "First operator" : "Signup open",
        title: "Create the operator account",
        description:
          signup.mode === "bootstrap"
            ? "Bootstrap is open because no operator exists yet."
            : "Signup is currently open by policy.",
        primaryAction: "Provision operator",
        secondaryAction: { href: "/sign-in", label: "Already provisioned? Sign in" },
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
        primaryAction: "Sign in instead",
        secondaryAction: { href: "/sign-in", label: "Go to sign in" },
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
      primaryAction: "Sign in instead",
      secondaryAction: { href: "/sign-in", label: "Go to sign in" },
      tone: "warning",
    }
  }

  return {
    state: "sign-in",
    label: "Operator sign in",
    title: "Sign in to WilliamOS",
    description:
      signup?.open === false
        ? "Auth is ready. Signup may be locked because an operator already exists."
        : "Auth is ready. Use your operator credentials to enter the shell.",
    primaryAction: "Enter the shell",
    secondaryAction: signup?.open
      ? { href: "/sign-up", label: "Create first operator" }
      : undefined,
    tone: "ready",
  }
}
