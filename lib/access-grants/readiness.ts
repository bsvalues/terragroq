import { ACCESS_GRANT_RUNTIME_DISABLED_REASON } from "./constants"

export type AccessGrantReadiness = {
  enabled: boolean
  configured: boolean
  runtimeMode: "disabled"
  issueRoute: "disabled"
  acceptRoute: "disabled"
  persistence: "scaffolded-disabled"
  auditWriter: "scaffolded-disabled"
  limiter: "scaffolded-disabled"
  reason: string
}

export function getAccessGrantReadiness(): AccessGrantReadiness {
  return {
    enabled: false,
    configured: false,
    runtimeMode: "disabled",
    issueRoute: "disabled",
    acceptRoute: "disabled",
    persistence: "scaffolded-disabled",
    auditWriter: "scaffolded-disabled",
    limiter: "scaffolded-disabled",
    reason: ACCESS_GRANT_RUNTIME_DISABLED_REASON,
  }
}
