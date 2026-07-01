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
  readiness: {
    label: string
    value: string
    description: string
  }[]
  primaryAction: AccessGrantPlaceholderAction
  secondaryActions: AccessGrantPlaceholderAction[]
  notices: AccessGrantPlaceholderNotice[]
  blockedClaims: string[]
}

export function getAccessGrantPlaceholderSurface(): AccessGrantPlaceholderSurface {
  return {
    eyebrow: "WilliamOS Access Grants",
    title: "Access Grants are disabled",
    description:
      "Access Grants are a future controlled-access path for non-operator review packets. They are disabled, not configured, and require owner activation before any issue route, accept route, token validation, or production access behavior can run.",
    statusLabel: "Disabled",
    tokenPosture: "Token observed; no validation active",
    readiness: [
      {
        label: "Issue route",
        value: "disabled",
        description: "No access grant can be issued from this surface.",
      },
      {
        label: "Accept route",
        value: "disabled",
        description: "No token can be accepted or exchanged for access.",
      },
      {
        label: "Validation",
        value: "not active",
        description: "Tokens are not persisted, consumed, displayed, or validated here.",
      },
      {
        label: "Authority gate",
        value: "owner activation required",
        description: "Future controlled access requires a separate owner-approved activation gate.",
      },
    ],
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
        title: "No validation is active",
        body: "WilliamOS does not validate, persist, consume, display, or exchange this access token in the placeholder route.",
        tone: "disabled",
      },
      {
        title: "Authority remains separate",
        body: "Access Grants can never grant deploy, merge, production-write, Hermes, MCP, autonomy, or operator-console authority.",
        tone: "neutral",
      },
    ],
    blockedClaims: [
      "account created",
      "token validated",
      "issue route enabled",
      "accept route enabled",
      "validation active",
      "public signup",
      "operator authority",
      "live access",
      "Hermes activation",
      "MCP activation",
      "autonomy enabled",
    ],
  }
}
