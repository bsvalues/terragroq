# Access Grant Implementation Authority Packet

Work order: `WO-AUTH-008A`

Mode: owner decision packet / design-only

## 1. Purpose

This packet is the explicit gate between preview/design access grants and real
durable access grants.

No implementation authority is granted by this document. It exists so the Primary
Operator can approve, reject, or defer each part of the access-grant runtime
before WilliamOS crosses from preview-only behavior into production access
behavior.

Current posture:

- `/access/[token]` is preview-only.
- Access grant UX, data model, token validation, and audit event designs are
  documented.
- No access-grant schema exists.
- No access token is issued.
- No token is validated against the database.
- No access-grant audit writer exists.
- No email verification or OTP sending is enabled for access grants.

## 2. Scope Of Decision

This packet covers only scoped non-operator access grants.

It does not authorize:

- Operator account creation.
- Public signup.
- Email OTP production sending.
- Social login.
- Hermes runtime.
- MCP activation.
- Autonomy.
- Production writes beyond the approved access-grant feature scope.
- Manual deploy, release, or tag.

## 3. Decision Checklist

| Decision | Default recommendation | Owner decision |
| --- | --- | --- |
| Approve schema migration? | Yes, only after review of exact migration SQL. | Pending |
| Approve `access_grant` table? | Yes, separate from `authority_grant`. | Pending |
| Approve `access_grant_session` table? | Yes, for short-lived scoped sessions. | Pending |
| Approve `access_grant_event` table? | Yes, with governance-event mirroring for significant events. | Pending |
| Approve token hash strategy? | Yes: HMAC-SHA-256 with server-side pepper. | Pending |
| Approve secret/pepper env? | Yes, but only through explicit env/Vercel secret gate. | Pending |
| Approve durable rate limiter? | Yes, DB-backed before validation goes live. | Pending |
| Approve audit writer? | Yes, append-only and redaction-enforced. | Pending |
| Approve runtime validation? | Not until schema, hash, audit, and limiter are merged. | Pending |
| Approve production access-link behavior? | Not until one read-only target POC is reviewed. | Pending |
| Approve email verification? | Defer until provider and rate-limit gates are complete. | Pending |
| Approve rollback strategy? | Yes, feature-flag off plus route fallback to preview-only. | Pending |

## 4. Recommended Approval Shape

If approved, approval should be phased rather than broad.

Recommended first approval:

```text
Approve schema/design implementation only:
- access_grant table
- access_grant_session table
- access_grant_event table
- constants and pure validation types
- redaction tests
- no production token validation
- no token issuance UI
- no email sending
```

Do not approve all runtime behavior in one decision.

## 5. Proposed Implementation Phases

### Phase 1 - Schema And Constants

Allowed if approved:

- Add access-grant schema tables.
- Add scope constants.
- Add target resource constants.
- Add migration tests or schema tests.
- Add redaction/forbidden-field tests.

Still blocked:

- Token issuance.
- Runtime route validation.
- Email verification.
- Target rendering.
- Production access sessions.

### Phase 2 - Token Utilities

Allowed if approved:

- Add pure parser.
- Add token generation helper.
- Add token hash helper.
- Add tests proving raw tokens are not stored or logged.

Still blocked:

- Production token issuance.
- Database lookup.
- Route activation.

### Phase 3 - Audit Writer

Allowed if approved:

- Add append-only audit writer.
- Reject forbidden fields.
- Mirror governance-significant events if approved.
- Add tests for redaction and event shape.

Still blocked:

- Runtime validation.
- Email sending.
- Target access.

### Phase 4 - Internal Grant Creation

Allowed if approved:

- Operator-only internal creation function.
- Store token hash only.
- Return raw token once.
- Record create event.

Still blocked:

- Public recipient access.
- Email delivery.
- Comment-capable grants.

### Phase 5 - Read-Only Validation POC

Allowed if approved:

- Validate one read-only evidence-packet grant.
- Create short-lived scoped access session.
- Render only that packet.
- Record validation and open events.

Still blocked:

- Comments.
- Builder workspace mutation.
- Broad project access.
- Email-bound grants.

### Phase 6 - Email-Bound Grants

Allowed only after a separate provider/rate-limit decision:

- Recipient email verification.
- Provider configuration.
- Resend or provider integration.
- Durable resend cooldowns.

## 6. Rollback Strategy

Rollback must be designed before runtime activation.

Required rollback controls:

- Feature flag or config switch that returns `/access/[token]` to preview-only.
- Ability to revoke all active grants.
- Ability to disable grant creation while preserving audit reads.
- Validation checks that deny access when config is missing.
- Migration rollback plan or forward-only disable plan.

Recommended fail-closed behavior:

```text
If schema is missing: preview-only / unavailable.
If token pepper is missing: deny validation.
If rate limiter is unavailable: deny validation.
If audit writer fails: deny runtime access for production grants.
If email provider is missing: do not send; show provider unavailable.
```

## 7. Required Tests Before Runtime Enablement

Minimum test coverage:

- Unknown token does not create user/session.
- Malformed token is denied generically.
- Expired grant is denied.
- Revoked grant is denied.
- Exhausted grant is denied.
- Scope mismatch is denied.
- Valid read-only grant opens only target packet.
- Raw token is never stored.
- Raw token is never included in audit events.
- Audit writer rejects forbidden fields.
- Missing token pepper fails closed.
- Missing rate limiter fails closed.
- Missing email provider fails closed.
- Access grant cannot reach operator console.
- Access grant cannot create authority grant.

## 8. Security Review Questions

Before approving runtime validation, answer:

1. Where is the token pepper stored?
2. How is token pepper rotation handled?
3. What is the maximum grant lifetime?
4. What is the default `maxUses`?
5. What is the allowed first target resource?
6. Which fields are visible to the recipient?
7. Which fields are visible to the operator?
8. What logs are produced on malformed/unknown tokens?
9. How are rate limits enforced in serverless production?
10. What breaks glass if a token leaks?

## 9. Remaining Blocked Items

Remain blocked until separately authorized:

- Schema migration.
- Access grant table creation.
- Real token issuance.
- Token hashing secret/pepper env setup.
- Durable rate-limit implementation.
- Audit writer implementation.
- Runtime validation against DB.
- Production access behavior.
- Email verification.
- OTP sending.
- Provider setup.
- Env/Vercel secret setup.
- Comment-capable access grants.
- Non-operator account model.
- Public signup.
- Hermes, MCP, autonomy, scheduler, worker dispatch.

## 10. Recommended Owner Decision

Recommended immediate decision:

```text
Approve Phase 1 only:
- schema/constants/redaction test implementation
- no runtime validation
- no token issuance
- no production access behavior
```

Reason:

The schema and constants are reviewable and reversible at the architecture level.
Runtime validation should wait until token, audit, limiter, and rollback behavior
are independently proven.

## 11. Decision Record Template

Owner can use this exact decision block:

```text
OWNER DECISION:
Access Grant Implementation Authority Packet reviewed.

Schema migration:
access_grant table:
access_grant_session table:
access_grant_event table:
Token hash strategy:
Secret/pepper env:
Durable rate limiter:
Audit writer:
Runtime validation:
Production access-link behavior:
Email verification:
Rollback strategy:

Approved phase:
Explicitly still blocked:
Required validation:
```

## 12. Next Work Orders

If Phase 1 is approved:

1. `WO-AUTH-008B` - Access Grant Schema Constants And Migration Plan.
2. `WO-AUTH-008C` - Access Grant Schema Implementation.
3. `WO-AUTH-008D` - Access Grant Redaction Test Harness.

If Phase 1 is not approved:

1. `WO-AUTH-008B` - Access Grant Threat Model Review.
2. `WO-AUTH-008C` - Access Grant Rollback Plan Deep Dive.

Runtime validation should not be scheduled until schema, token, audit, and rate
limit slices have each passed.
