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
    title: "Enter your private command environment",
    description:
      "Primary Operator access is for the owner governing work orders, Brain Council evidence, release decisions, and safety gates.",
    primaryAction: {
      label: "Enter as Primary Operator",
      href: "/sign-in",
      variant: "primary",
    },
    secondaryActions: [
      {
        label: "Open scoped access preview",
        href: "/access/preview",
        variant: "muted",
      },
    ],
    notices: [
      {
        title: "Authentication is not authority",
        body: "Access opens the Operator Console. Deploys, merges, production writes, MCP, Hermes, and autonomous actions still require separate gates.",
        tone: "neutral",
      },
      {
        title: "Recovery is scaffolded, not enabled",
        body: "Email OTP recovery remains disabled until provider configuration, sender identity, and durable rate limits are approved.",
        tone: "disabled",
      },
      {
        title: "Non-operators do not enter here",
        body: "Reviewers and builders use scoped access links under /access/[token], not owner provisioning.",
        tone: "locked",
      },
    ],
    prohibitedClaims: [
      "Groq-powered",
      "xAI-powered",
      "self-service provisioning",
      "operator authority from access",
      "Hermes activation",
      "MCP activation",
    ],
  }
}

export function getVisibleOperatorSecondaryActions(
  surface: OperatorLoginSurface,
  readiness?: OperatorLoginReadiness,
): OperatorLoginAction[] {
  void readiness
  return surface.secondaryActions.filter((action) => action.href !== "/sign-up")
}
