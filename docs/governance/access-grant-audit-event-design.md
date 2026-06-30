# Access Grant Audit Event Design

Work order: `WO-AUTH-007E`

Mode: design-only

## 1. Purpose

This document defines the audit trail WilliamOS needs before scoped access grants
can move from preview-only to runtime validation.

No event writer, schema migration, token validation, or access activation is
implemented by this work order.

Core rule:

```text
Every access-grant transition must be explainable later.
Audit evidence must never leak the access token.
```

## 2. Audit Goals

Access-grant audit must answer:

- Who created the grant?
- What target and scope were granted?
- When was the link opened?
- Was validation allowed or denied?
- Why was access denied?
- Was email verification required?
- Was the grant consumed, expired, exhausted, or revoked?
- Which evidence or work-order packet was exposed?
- Did the grant ever attempt to exceed its scope?

Audit must not become a second authority system. It records facts; it does not
grant permission.

## 3. Event Destinations

Recommended design:

1. Write lifecycle events to a dedicated `access_grant_event` table for query,
   abuse review, and recipient-flow diagnostics.
2. Mirror governance-significant transitions into `governance_event` with
   `entityType = "access_grant"`.

Events that should be mirrored to `governance_event`:

- Grant created.
- Grant revoked.
- Grant exhausted.
- Scope denied.
- Target opened.
- Email verification completed.
- Suspicious validation pattern detected.

Routine malformed-token attempts may remain only in `access_grant_event` if they
do not reference a known grant.

## 4. Event Taxonomy

Recommended event names:

- `access_grant_created`
- `access_grant_link_copied`
- `access_grant_opened`
- `access_grant_token_missing`
- `access_grant_token_malformed`
- `access_grant_token_unknown`
- `access_grant_validated`
- `access_grant_validation_denied`
- `access_grant_expired_attempt`
- `access_grant_revoked_attempt`
- `access_grant_exhausted_attempt`
- `access_grant_scope_denied`
- `access_grant_email_verification_required`
- `access_grant_email_verification_requested`
- `access_grant_email_verified`
- `access_grant_provider_unavailable`
- `access_grant_rate_limited`
- `access_grant_session_created`
- `access_grant_target_opened`
- `access_grant_consumed`
- `access_grant_revoked`

Event names should be stable constants in implementation.

## 5. Required Event Fields

Recommended common fields:

- `id`
- `grantId`, nullable for unknown/malformed token attempts.
- `correlationId`
- `eventType`
- `actorType`: `operator`, `recipient`, or `system`.
- `outcome`: `allowed`, `denied`, `rate_limited`, `expired`, `revoked`,
  `exhausted`, `pending_verification`.
- `scope`, when known.
- `targetResourceType`, when known.
- `targetResourceId`, when known and safe.
- `reasonCode`.
- `createdAt`.
- `metadata`, restricted to non-secret diagnostics.

Optional privacy-preserving abuse fields:

- `ipAddressHash`
- `userAgentHash`
- `tokenPrefix`

Raw IP and raw user agent should require a separate privacy/security decision.

## 6. Forbidden Event Fields

Audit events must never store:

- Raw access token.
- Full token hash unless necessary and separately approved.
- OTP code.
- Provider API key.
- Full email body.
- Session token.
- Secret pepper.
- Raw password.
- Better Auth session cookie.

Recipient email handling:

- Prefer `recipientEmailHash`.
- Store plaintext email only if encrypted-at-rest and explicitly approved.
- Do not write raw email into `metadata`.

## 7. Reason Codes

Recommended denial reason codes:

- `TOKEN_MISSING`
- `TOKEN_MALFORMED`
- `TOKEN_UNKNOWN`
- `GRANT_EXPIRED`
- `GRANT_REVOKED`
- `GRANT_EXHAUSTED`
- `SCOPE_DENIED`
- `TARGET_MISMATCH`
- `EMAIL_VERIFICATION_REQUIRED`
- `EMAIL_PROVIDER_UNAVAILABLE`
- `RATE_LIMITED`
- `SESSION_EXPIRED`
- `INTERNAL_ERROR`

UI copy should remain recipient-safe and generic even when audit stores a more
specific reason code.

## 8. Correlation Model

Each access grant should have an `auditCorrelationId`.

Use it to connect:

- Grant creation.
- Link delivery/copy.
- Token open attempts.
- Email verification requests.
- Session creation.
- Target opening.
- Denials.
- Revocation.

Correlation id is non-secret and may appear in operator-facing audit surfaces.
It must not be usable to validate access.

## 9. Retention Policy

Recommended retention:

- Grant lifecycle events: retain with the grant record.
- Denied known-grant attempts: retain with the grant record.
- Malformed or unknown token attempts: aggregate or retain for a shorter window.
- Governance-significant mirrored events: retain according to governance event
  policy.

Open decision:

- Define exact retention windows before production implementation.

## 10. Evidence Surface Integration

Future Evidence surface should show:

- Grant created.
- Grant target opened.
- Grant revoked.
- Grant expired/exhausted.
- Scope denied.
- Suspicious rate-limit event.

Evidence should show outcome, target, scope, and correlation id. It should not
show raw token or recipient secrets.

## 11. Minimal Safe Implementation

First audit implementation after owner approval:

1. Add event constants.
2. Add pure event redaction tests.
3. Add schema for access-grant events.
4. Add append-only writer that rejects forbidden fields.
5. Add tests proving raw token, OTP, and secrets are stripped/refused.
6. Wire only placeholder-safe events if a runtime slice is approved later.

Do not implement audit writer and token validation in the same work order unless
the schema and rate-limit gates have already passed.

## 12. Stop Gates

Stop before implementation if the next slice requires:

- DB/schema migration.
- Event writer touching production data.
- Runtime token validation.
- Email sending.
- Env or Vercel config changes.
- Package/dependency changes.
- Raw token logging.
- Raw email logging.
- Better Auth user creation.
- Comment-capable grant mutation.
- Hermes, MCP, autonomy, scheduler, worker dispatch, or production-write
  behavior.

## 13. Acceptance Criteria

The audit design is ready when:

- Event taxonomy is explicit.
- Required and forbidden fields are explicit.
- Governance-event mirroring rules are explicit.
- Redaction and recipient privacy requirements are explicit.
- Retention questions are captured.
- First implementation can start with constants and redaction tests, not runtime
  validation.
