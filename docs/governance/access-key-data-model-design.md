# Access Key Data Model Design

Work order: `WO-AUTH-007B`

Mode: design-only

## 1. Purpose

This document designs the durable data model for scoped non-operator access
grants. It does not create tables, migrations, runtime token validation, email
delivery, or access routes.

The access-key model must preserve the boundary established by the auth doctrine:

```text
Access grants open one scoped surface.
Authority grants permit governed action.
Access grants are not authority grants.
Access grants never create user accounts.
```

## 2. Current Schema Context

Existing relevant tables:

- `user`, `session`, `account`, `verification`: Better Auth identity/session
  tables.
- `authority_grant`: durable execution-authority records for Work Orders and
  agents.
- `governance_event`: append-only governance event log.
- `evidence_record`: validation and completion evidence.
- `work_order`, `decision`, `memory_fact`, `truth_claim`: target surfaces that may
  later expose read-only packets.

Design conclusion:

- Do not reuse `authority_grant` for human scoped access links. Its purpose is
  execution authority.
- Do not create Better Auth users from access grants.
- Use a new `access_grant` record family when implementation is authorized.
- Use `governance_event` or a dedicated `access_grant_event` table for audit
  details, depending on query and retention needs.

## 3. Proposed Tables

### `access_grant`

Primary durable record for an access link.

Recommended fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | serial or uuid | Internal primary key. UUID is preferable if exposed indirectly. |
| `ref` | text | Human reference, for example `ACCESS-0001`. |
| `userId` | text | Primary Operator owner. |
| `publicTokenHash` | text | Hash of the raw token. Never store the raw token. |
| `tokenPrefix` | text | Short non-secret prefix for support/debug, for example first 8 chars after prefix. |
| `scope` | text | One approved access-grant scope. |
| `targetResourceType` | text | `evidence`, `work_order`, `decision_packet`, `project_brief`, etc. |
| `targetResourceId` | text | Target identifier. Text supports mixed target types. |
| `recipientEmailHash` | text | Optional canonical recipient email hash. |
| `recipientEmailEncrypted` | text | Optional encrypted display email, only if operationally needed. |
| `emailVerificationRequired` | boolean | Whether recipient must verify email before viewing target. |
| `createdByOperatorId` | text | Operator user id that created the grant. |
| `createdReason` | text | Operator-facing reason. |
| `status` | text | `active`, `expired`, `revoked`, `exhausted`. |
| `expiresAt` | timestamp | Required for production grants. |
| `maxUses` | integer | Defaults to 1 for one-time grants. |
| `useCount` | integer | Incremented only after successful consumption/session start. |
| `lastUsedAt` | timestamp | Last successful use. |
| `revokedAt` | timestamp | Null unless revoked. |
| `revokedBy` | text | Operator id or system actor. |
| `revokeReason` | text | Human-readable revoke reason. |
| `metadata` | jsonb | Minimal non-secret metadata. |
| `auditCorrelationId` | text | Correlates grant events across logs. |
| `createdAt` | timestamp | Creation time. |
| `updatedAt` | timestamp | Last mutation time. |

Constraints and indexes:

- Unique index on `publicTokenHash`.
- Index on `userId`, `status`, `expiresAt`.
- Index on `targetResourceType`, `targetResourceId`.
- Optional index on `recipientEmailHash`.
- Check constraint requiring `expiresAt` for production grants.
- Check constraint restricting `scope` to approved constants.

### `access_grant_session`

Optional session record created after a token validates. This avoids reusing the
raw token for every page request.

Recommended fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | serial or uuid | Internal primary key. |
| `grantId` | integer or uuid | FK to `access_grant`. |
| `sessionTokenHash` | text | Hash of short-lived access-session token. |
| `recipientEmailVerified` | boolean | Whether email verification completed. |
| `ipAddressHash` | text | Optional, privacy-preserving abuse signal. |
| `userAgentHash` | text | Optional, privacy-preserving abuse signal. |
| `expiresAt` | timestamp | Short-lived session expiry. |
| `createdAt` | timestamp | Session creation time. |
| `lastSeenAt` | timestamp | Last successful session use. |

This table should not reference Better Auth `session` unless a future owner
decision creates a separate non-operator identity model.

### `access_grant_event`

Dedicated event table if `governance_event` is too broad for access-link
analytics and abuse review.

Recommended fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | serial | Primary key. |
| `grantId` | integer or uuid | Optional for malformed/unknown-token events. |
| `correlationId` | text | Matches `auditCorrelationId`. |
| `eventType` | text | Lifecycle event name. |
| `actorType` | text | `operator`, `recipient`, `system`. |
| `outcome` | text | `allowed`, `denied`, `rate_limited`, `expired`, etc. |
| `targetResourceType` | text | Copied for easier reporting. |
| `targetResourceId` | text | Copied for easier reporting. |
| `ipAddressHash` | text | Optional, no raw IP by default. |
| `userAgentHash` | text | Optional, no raw user agent by default. |
| `metadata` | jsonb | Non-secret diagnostic fields. |
| `createdAt` | timestamp | Event time. |

If a dedicated table is not created, write equivalent events to
`governance_event` with `entityType = "access_grant"` and non-secret metadata.

## 4. Token Strategy

Raw token:

- Generated with at least 256 bits of randomness.
- Encoded as URL-safe base64 or base64url.
- Optional display prefix: `wag_` for WilliamOS access grant.
- Shown or delivered once.
- Never stored, logged, embedded in analytics, or written to evidence reports.

Stored hash:

- Store only a keyed HMAC-SHA-256 or equivalent server-side hash.
- Use a server-side pepper/secret separate from the database.
- Compare hashes using constant-time comparison.
- Rotate the hashing secret only through a separate migration/revocation plan.

Support/debug field:

- Store a short non-secret token prefix for operator support.
- The prefix must not be enough to validate or reconstruct the token.

## 5. Scope Constants

Recommended initial read-only scopes:

- `grant:evidence.read`
- `grant:work_order.read`
- `grant:decision_packet.read`
- `grant:readiness.read`
- `grant:brain_council_packet.read`
- `grant:hermes_packet.read`
- `grant:project_brief.read`
- `grant:builder_packet.read`

Deferred mutating scope:

- `grant:work_order.comment_limited`

Forbidden scopes must never be present in the access-grant enum:

- `operator_console`
- `authority_grant`
- `access_grant_admin`
- `auth_policy_write`
- `env_write`
- `secret_read`
- `secret_write`
- `db_write`
- `schema_write`
- `deploy`
- `release`
- `tag`
- `merge`
- `push`
- `hermes_runtime`
- `mcp_activation`
- `autonomy`
- `worker_dispatch`
- `brain_council_execute`

Implementation should keep scope constants in one shared module so validator,
UI, tests, and docs cannot drift.

## 6. Target Resource Model

Recommended `targetResourceType` values:

- `evidence_packet`
- `work_order_packet`
- `decision_packet`
- `readiness_report`
- `brain_council_packet`
- `hermes_packet`
- `project_brief`
- `builder_packet`

Rules:

- A grant targets exactly one resource.
- Cross-resource bundles should be represented as a packet resource, not a broad
  wildcard grant.
- No `*`, `all`, or global target values in the first implementation.

## 7. Email Data Handling

Recipient email is sensitive operational data.

Recommended default:

- Store `recipientEmailHash` using normalized lower-case email plus server-side
  pepper.
- Avoid plaintext email storage unless display/search is operationally required.
- If display email is required, use encrypted-at-rest storage where supported.
- Never include raw recipient email in access URL query strings.

Email verification should use a separate verification record or provider flow and
must not create a Better Auth user.

## 8. Lifecycle Rules

Creation:

- Operator chooses target, scope, expiry, max uses, and optional email binding.
- System generates token, stores hash, and records audit event.

Validation:

- Hash incoming token.
- Find active matching grant.
- Reject revoked, expired, exhausted, unknown, or scope-mismatched grants.
- If email verification is required and incomplete, route to verification state.
- If valid, create short-lived scoped access session.

Consumption:

- Increment `useCount` only after successful session creation or target open.
- Mark `exhausted` when `useCount >= maxUses`.
- Record lifecycle event.

Revocation:

- Operator can revoke immediately.
- Revocation invalidates future token/session use.
- Record revoke actor and reason.

Expiration:

- Expired grants should be treated as invalid even if status is still `active`.
- Optional background cleanup may mark stale rows `expired`, but access checks
  must not depend on cleanup running.

## 9. Audit And Evidence Strategy

Minimum audit events:

- Created.
- Link copied or delivered.
- Open attempted.
- Validation allowed.
- Validation denied with reason class.
- Email verification required.
- Email verification requested.
- Email verified.
- Session started.
- Target opened.
- Scope denied.
- Expired attempt.
- Revoked attempt.
- Grant consumed.
- Grant revoked.

Do not log:

- Raw access token.
- OTP code.
- Provider API key.
- Full email payload.
- Raw IP address unless a privacy/security decision explicitly authorizes it.

Evidence linkage:

- Work-order/evidence packet grants should link back to `evidence_record` or the
  underlying work order.
- Security-sensitive lifecycle transitions should also append to
  `governance_event`.

## 10. Rate Limiting Requirements

Access grant validation must have durable abuse controls before production use.

Required controls:

- Per-token validation attempt limit.
- Per-recipient email verification request limit.
- Per-IP or privacy-preserving client signal limit.
- Resend cooldown for email verification.
- Generic denial copy for unknown or unauthorized tokens.

Do not rely only on in-memory counters in production serverless environments.
Durable DB-backed or provider-backed rate limiting must be designed before
token-validation implementation.

## 11. Minimal Safe POC

Smallest recommended implementation after owner approval:

```text
Read-only evidence packet access
one target
one token
7 day expiry
maxUses = 1
no comments
no Better Auth user creation
no email sending in first runtime slice
hashed token only
audit event on create/open/deny/consume/revoke
```

This POC proves the access boundary without introducing comment mutation, public
signup, or non-operator accounts.

## 12. Migration Phases

### Phase 1 - Design Approval

- Approve table names and field set.
- Approve token hash strategy.
- Approve retention policy.
- Approve scope constants.
- Approve audit destination.

### Phase 2 - Schema Migration

- Add access-grant tables.
- Add indexes and constraints.
- Add static scope constants.
- Add tests for schema definitions.

### Phase 3 - Internal Creation API

- Operator-only creation function.
- Hash raw token.
- Return raw token once.
- Record audit event.
- No recipient route yet.

### Phase 4 - Recipient Placeholder Route

- `/access/[token]` state handling.
- Validate token in read-only mode.
- Show target metadata, not full resource if target renderer is not ready.

### Phase 5 - Read-Only Packet Rendering

- Render one approved target type.
- Add session-bound access.
- Add audit events.

### Phase 6 - Email-Bound Grants

- Only after email provider and durable rate-limit gates pass.

### Phase 7 - Comment-Capable Grants

- Separate work order because it introduces recipient mutation.

## 13. Open Decisions

Owner decisions required before implementation:

- Table names: `access_grant`, `access_grant_session`, `access_grant_event`.
- Primary key style: serial vs UUID.
- Token hash method and secret/pepper source.
- Whether `recipientEmailEncrypted` is needed or hashes are sufficient.
- Grant expiry defaults by target type.
- Audit destination: dedicated event table, `governance_event`, or both.
- Rate-limit storage strategy.
- Whether the first POC targets evidence packets or work-order packets.

## 14. Stop Gates

Stop before any implementation that requires:

- DB/schema migration.
- Runtime token validation.
- Access route activation.
- Email provider setup.
- Email sending.
- Env or Vercel config changes.
- Package/dependency changes.
- Public signup reopening.
- Better Auth user creation from access grants.
- Non-operator account model.
- Comment-capable recipient mutation.
- Hermes, MCP, autonomy, scheduler, worker dispatch, or production-write
  behavior.

## 15. Acceptance Criteria

The data model design is complete when:

- Access grants are clearly separate from authority grants.
- Raw tokens are never stored.
- Email binding is privacy-preserving.
- Expiry, use count, revocation, session, and audit needs are represented.
- Initial scopes and target resources are bounded.
- The smallest safe POC is identified.
- Owner stop gates are explicit before schema migration or runtime behavior.
