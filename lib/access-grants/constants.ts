export const ACCESS_GRANT_STATUSES = ["active", "expired", "revoked", "exhausted"] as const

export type AccessGrantStatus = (typeof ACCESS_GRANT_STATUSES)[number]

export const ACCESS_GRANT_SCOPES = [
  "grant:evidence.read",
  "grant:work_order.read",
  "grant:decision_packet.read",
  "grant:readiness.read",
  "grant:brain_council_packet.read",
  "grant:hermes_packet.read",
  "grant:project_brief.read",
  "grant:builder_packet.read",
] as const

export type AccessGrantScope = (typeof ACCESS_GRANT_SCOPES)[number]

export const DEFERRED_ACCESS_GRANT_SCOPES = ["grant:work_order.comment_limited"] as const

export const ACCESS_GRANT_RESOURCE_TYPES = [
  "evidence_packet",
  "work_order_packet",
  "decision_packet",
  "readiness_report",
  "brain_council_packet",
  "hermes_packet",
  "project_brief",
  "builder_packet",
] as const

export type AccessGrantResourceType = (typeof ACCESS_GRANT_RESOURCE_TYPES)[number]

export const ACCESS_GRANT_EVENT_TYPES = [
  "access_grant_created",
  "access_grant_link_copied",
  "access_grant_opened",
  "access_grant_token_missing",
  "access_grant_token_malformed",
  "access_grant_token_unknown",
  "access_grant_validated",
  "access_grant_validation_denied",
  "access_grant_expired_attempt",
  "access_grant_revoked_attempt",
  "access_grant_exhausted_attempt",
  "access_grant_scope_denied",
  "access_grant_email_verification_required",
  "access_grant_email_verification_requested",
  "access_grant_email_verified",
  "access_grant_provider_unavailable",
  "access_grant_rate_limited",
  "access_grant_session_created",
  "access_grant_target_opened",
  "access_grant_consumed",
  "access_grant_revoked",
] as const

export type AccessGrantEventType = (typeof ACCESS_GRANT_EVENT_TYPES)[number]

export const ACCESS_GRANT_DENIED_SCOPES = [
  "operator_console",
  "authority_grant",
  "access_grant_admin",
  "auth_policy_write",
  "settings_write",
  "env_write",
  "secret_read",
  "secret_write",
  "db_write",
  "schema_write",
  "deploy",
  "release",
  "tag",
  "merge",
  "push",
  "hermes_runtime",
  "mcp_activation",
  "autonomy",
  "worker_dispatch",
  "brain_council_execute",
] as const

export const ACCESS_GRANT_FORBIDDEN_AUDIT_FIELDS = [
  "rawToken",
  "accessToken",
  "sessionToken",
  "token",
  "tokenHash",
  "publicTokenHash",
  "otp",
  "otpCode",
  "password",
  "apiKey",
  "secret",
  "pepper",
  "providerSecret",
  "emailBody",
] as const

export const ACCESS_GRANT_RUNTIME_DISABLED_REASON =
  "Access grant runtime remains disabled until owner activation approval."

export const ACCESS_GRANT_TOKEN_PREFIX = "wag_"

export const ACCESS_GRANT_TOKEN_RANDOM_BYTES = 32

export const ACCESS_GRANT_TOKEN_MIN_PAYLOAD_LENGTH = 32

export const ACCESS_GRANT_TOKEN_MAX_LENGTH = 128

export const ACCESS_GRANT_LIMITER_DEFAULTS = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  cooldownMs: 60 * 1000,
} as const
