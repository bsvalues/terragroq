import { ACCESS_GRANT_RUNTIME_DISABLED_REASON } from "./constants"
import { buildAccessGrantAuditEvent, type AccessGrantAuditEventDraft } from "./audit"

export type AccessGrantPersistenceConfig = {
  enabled: boolean
}

export type AccessGrantPersistenceResult =
  | { ok: true; id: never }
  | { ok: false; reason: "runtime_disabled"; auditEvent: AccessGrantAuditEventDraft }

export type PersistAccessGrantAuditEventInput = {
  correlationId: string
  metadata?: Record<string, unknown>
}

export function persistAccessGrantAuditEventPreview(
  config: AccessGrantPersistenceConfig,
  input: PersistAccessGrantAuditEventInput,
): AccessGrantPersistenceResult {
  if (!config.enabled) {
    return {
      ok: false,
      reason: "runtime_disabled",
      auditEvent: buildAccessGrantAuditEvent({
        correlationId: input.correlationId,
        eventType: "access_grant_validation_denied",
        actorType: "system",
        outcome: "disabled",
        reasonCode: "PERSISTENCE_DISABLED",
        metadata: {
          ...input.metadata,
          runtimeDisabledReason: ACCESS_GRANT_RUNTIME_DISABLED_REASON,
        },
      }),
    }
  }

  throw new Error("Access grant audit persistence activation is not implemented.")
}
