import {
  ACCESS_GRANT_RUNTIME_DISABLED_REASON,
  type AccessGrantResourceType,
  type AccessGrantScope,
} from "./constants"
import { buildAccessGrantAuditEvent, type AccessGrantAuditEventDraft } from "./audit"
import { parseAccessGrantToken } from "./token"

export type AccessGrantRuntimeConfig = {
  enabled: boolean
}

export type AccessGrantIssueRequest = {
  scope: AccessGrantScope
  targetResourceType: AccessGrantResourceType
  targetResourceId: string
  createdByOperatorId: string
  createdReason?: string
}

export type AccessGrantIssueResult =
  | { ok: true; grantId: never }
  | { ok: false; reason: "runtime_disabled"; auditEvent: AccessGrantAuditEventDraft }

export type AccessGrantAcceptResult =
  | { ok: true; sessionId: never }
  | {
      ok: false
      reason: "runtime_disabled" | "token_missing" | "token_malformed"
      auditEvent: AccessGrantAuditEventDraft
    }

export function issueAccessGrantPreview(
  config: AccessGrantRuntimeConfig,
  request: AccessGrantIssueRequest,
): AccessGrantIssueResult {
  if (!config.enabled) {
    return {
      ok: false,
      reason: "runtime_disabled",
      auditEvent: buildAccessGrantAuditEvent({
        correlationId: "preview-disabled",
        eventType: "access_grant_validation_denied",
        actorType: "system",
        outcome: "disabled",
        scope: request.scope,
        targetResourceType: request.targetResourceType,
        targetResourceId: request.targetResourceId,
        reasonCode: "RUNTIME_DISABLED",
        metadata: {
          createdByOperatorId: request.createdByOperatorId,
          createdReason: request.createdReason,
          runtimeDisabledReason: ACCESS_GRANT_RUNTIME_DISABLED_REASON,
        },
      }),
    }
  }

  throw new Error("Access grant runtime activation is not implemented.")
}

export function acceptAccessGrantPreview(
  config: AccessGrantRuntimeConfig,
  token: unknown,
): AccessGrantAcceptResult {
  const parsed = parseAccessGrantToken(token)

  if (!config.enabled) {
    return {
      ok: false,
      reason: "runtime_disabled",
      auditEvent: buildAccessGrantAuditEvent({
        correlationId: "preview-disabled",
        eventType: "access_grant_validation_denied",
        actorType: "system",
        outcome: "disabled",
        tokenPrefix: parsed.ok ? parsed.tokenPrefix : undefined,
        reasonCode: "RUNTIME_DISABLED",
        metadata: {
          parseState: parsed.ok ? "parseable" : parsed.reason,
          runtimeDisabledReason: ACCESS_GRANT_RUNTIME_DISABLED_REASON,
          rawToken: typeof token === "string" ? token : undefined,
        },
      }),
    }
  }

  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason === "missing" ? "token_missing" : "token_malformed",
      auditEvent: buildAccessGrantAuditEvent({
        correlationId: "runtime-parse-denied",
        eventType: parsed.reason === "missing" ? "access_grant_token_missing" : "access_grant_token_malformed",
        actorType: "recipient",
        outcome: "denied",
        reasonCode: parsed.reason.toUpperCase(),
      }),
    }
  }

  throw new Error("Access grant runtime validation is not implemented.")
}
