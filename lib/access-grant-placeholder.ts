export type AccessGrantPlaceholderAction = {
  label: string
  href: string
  variant: "primary" | "secondary" | "muted"
}

export type AccessGrantPlaceholderNotice = {
  title: string
  body: string
  tone: "neutral" | "locked" | "disabled"
}

export type AccessGrantPlaceholderSurface = {
  eyebrow: string
  title: string
  description: string
  statusLabel: string
  tokenPosture: string
  primaryAction: AccessGrantPlaceholderAction
  secondaryActions: AccessGrantPlaceholderAction[]
  notices: AccessGrantPlaceholderNotice[]
  blockedClaims: string[]
}

export function getAccessGrantPlaceholderSurface(): AccessGrantPlaceholderSurface {
  return {
    eyebrow: "WilliamOS Scoped Access",
    title: "Scoped access is not active yet",
    description:
      "Access links will open limited review packets for non-operators after the access-grant data model, token validation, audit, and rate-limit gates are approved.",
    statusLabel: "Preview only",
    tokenPosture: "Token observed, not validated",
    primaryAction: {
      label: "Return to operator entry",
      href: "/operator",
      variant: "primary",
    },
    secondaryActions: [
      {
        label: "Read access grant doctrine",
        href: "/operator#scoped-access",
        variant: "secondary",
      },
    ],
    notices: [
      {
        title: "No account is created",
        body: "Opening this route does not create a user, operator account, session, or access grant.",
        tone: "locked",
      },
      {
        title: "No token validation is running",
        body: "WilliamOS does not validate, persist, consume, or display this access token in the placeholder route.",
        tone: "disabled",
      },
      {
        title: "Authority remains separate",
        body: "Scoped access can never grant deploy, merge, production-write, Hermes, MCP, autonomy, or operator-console authority.",
        tone: "neutral",
      },
    ],
    blockedClaims: [
      "account created",
      "token validated",
      "public signup",
      "operator authority",
      "Hermes activation",
      "MCP activation",
      "autonomy enabled",
    ],
  }
}
