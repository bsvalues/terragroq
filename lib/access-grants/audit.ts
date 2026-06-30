import type {
  AccessGrantEventType,
  AccessGrantResourceType,
  AccessGrantScope,
} from "./constants"
import { redactAccessGrantAuditMetadata } from "./redaction"

export type AccessGrantAuditActor = "operator" | "recipient" | "system"

export type AccessGrantAuditOutcome =
  | "allowed"
  | "denied"
  | "rate_limited"
  | "expired"
  | "revoked"
  | "exhausted"
  | "pending_verification"
  | "disabled"

export type BuildAccessGrantAuditEventInput = {
  grantId?: number
  correlationId: string
  eventType: AccessGrantEventType
  actorType: AccessGrantAuditActor
  outcome: AccessGrantAuditOutcome
  scope?: AccessGrantScope
  targetResourceType?: AccessGrantResourceType
  targetResourceId?: string
  reasonCode?: string
  ipAddressHash?: string
  userAgentHash?: string
  tokenPrefix?: string
  metadata?: Record<string, unknown>
}

export type AccessGrantAuditEventDraft = BuildAccessGrantAuditEventInput & {
  metadata: Record<string, unknown>
}

export function buildAccessGrantAuditEvent(
  input: BuildAccessGrantAuditEventInput,
): AccessGrantAuditEventDraft {
  return {
    ...input,
    metadata: input.metadata ? redactAccessGrantAuditMetadata(input.metadata) : {},
  }
}
