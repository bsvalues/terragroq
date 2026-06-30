export type OperatorLoginAction = {
  label: string
  href: string
  variant: "primary" | "secondary" | "muted"
}

export type OperatorLoginNotice = {
  title: string
  body: string
  tone: "neutral" | "locked" | "disabled"
}

export type OperatorLoginSurface = {
  eyebrow: string
  title: string
  description: string
  primaryAction: OperatorLoginAction
  secondaryActions: OperatorLoginAction[]
  notices: OperatorLoginNotice[]
  prohibitedClaims: string[]
}

export type OperatorLoginReadiness = {
  signup?: {
    open: boolean
  }
}

export function getOperatorLoginSurface(): OperatorLoginSurface {
  return {
    eyebrow: "WilliamOS Operator Console",
    title: "Sign in to control your build environment",
    description:
      "Operator access is for the person governing work orders, Brain Council evidence, release decisions, and safety gates.",
    primaryAction: {
      label: "Sign in as operator",
      href: "/sign-in",
      variant: "primary",
    },
    secondaryActions: [
      {
        label: "Create first operator",
        href: "/sign-up",
        variant: "secondary",
      },
      {
        label: "Scoped access links are coming later",
        href: "#scoped-access",
        variant: "muted",
      },
    ],
    notices: [
      {
        title: "Authentication is not authority",
        body: "Signing in opens the Operator Console. Deploys, merges, production writes, MCP, Hermes, and autonomous actions still require separate gates.",
        tone: "neutral",
      },
      {
        title: "Recovery is scaffolded, not enabled",
        body: "Email OTP recovery remains disabled until provider configuration, sender identity, and durable rate limits are approved.",
        tone: "disabled",
      },
      {
        title: "Non-operators do not sign up here",
        body: "Reviewers and collaborators will use scoped access links under /access/[token], not public account creation.",
        tone: "locked",
      },
    ],
    prohibitedClaims: [
      "Groq-powered",
      "xAI-powered",
      "public signup",
      "operator authority from login",
      "Hermes activation",
      "MCP activation",
    ],
  }
}

export function getVisibleOperatorSecondaryActions(
  surface: OperatorLoginSurface,
  readiness?: OperatorLoginReadiness,
): OperatorLoginAction[] {
  return surface.secondaryActions.filter((action) => {
    if (action.href !== "/sign-up") return true
    return readiness?.signup?.open ?? true
  })
}
