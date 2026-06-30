# Access Grant Token Validation Design

Work order: `WO-AUTH-007D`

Mode: design-only

## 1. Purpose

This document defines how WilliamOS should validate future scoped access-grant
tokens without turning `/access/[token]` into a public signup path, operator
login path, or authority grant.

No runtime token validation is implemented by this work order.

Core rule:

```text
Token validation may open one scoped review surface.
Token validation must not create accounts, grant authority, or execute work.
```

## 2. Current Posture

Current production behavior:

- `/access/[token]` exists as a preview-only placeholder.
- The route explicitly states that scoped access is not active.
- The route does not validate, persist, consume, display, or hash tokens.
- The route does not create sessions, accounts, access grants, audit records, or
  authority.

Token validation remains blocked until the access-grant schema, hash strategy,
audit destination, and durable rate-limit gates are approved.

## 3. Validation Pipeline

Future validation should follow this sequence:

1. Receive token from `/access/[token]`.
2. Reject missing, malformed, or overlong tokens before hashing.
3. Normalize token encoding without logging the raw value.
4. Compute keyed token hash.
5. Look up exactly one active access grant by hash.
6. Reject unknown, revoked, expired, exhausted, or scope-mismatched grants.
7. Apply durable rate limits before email or session creation.
8. If email verification is required, route to verification state.
9. If valid and verification is satisfied, create a short-lived scoped access
   session.
10. Render only the target resource allowed by grant scope.
11. Record non-secret audit events for every allow/deny path.

Every branch must return generic recipient-safe copy. The UI should never reveal
whether a specific private target resource exists.

## 4. Token Shape

Recommended raw token shape:

```text
wag_<base64url random 256-bit payload>
```

Requirements:

- Minimum 256 bits of entropy.
- URL-safe.
- No embedded user id, resource id, email, or scope.
- Prefix is only for support and parser routing.
- Token length should be bounded to prevent abuse.

The raw token must not appear in logs, analytics, audit records, page copy, error
messages, or evidence reports.

## 5. Parser Rules

Parser should classify incoming token as:

- `missing`
- `malformed`
- `unsupported_prefix`
- `too_long`
- `parseable`

Parser must not:

- Contact the database.
- Decode any embedded authority.
- Treat token content as trusted metadata.
- Throw raw parsing errors to the UI.

Malformed tokens should route to the same generic invalid-link copy as unknown
tokens unless operator diagnostics are explicitly enabled in a safe internal
context.

## 6. Hash And Lookup

Recommended hash:

- HMAC-SHA-256 over the raw token.
- Secret/pepper stored outside the database.
- Constant-time comparison when comparing derived values.
- Unique index on stored token hash.

Lookup result classes:

- `not_found`
- `active`
- `expired`
- `revoked`
- `exhausted`
- `not_yet_valid` if future activation windows are supported.

No fallback lookup should use token prefix alone.

## 7. Grant State Checks

Validation must require all of:

- Grant status is `active`.
- `expiresAt` is in the future.
- `revokedAt` is null.
- `useCount < maxUses`.
- Requested target route matches `targetResourceType` and `targetResourceId`.
- Requested action is included in `scope`.
- Email verification requirement is satisfied, if required.
- Durable rate limits allow the attempt.

Failed checks should deny access without leaking internal state beyond safe
recipient copy.

## 8. Session Model

After validation, the token should be exchanged for a short-lived scoped access
session.

The session should:

- Reference the access grant id.
- Store only a session token hash.
- Expire quickly.
- Include the resolved scope and target resource.
- Avoid Better Auth `user` and `session` tables unless a future non-operator
  identity model is approved.
- Be invalidated when the underlying grant is revoked or exhausted.

The raw access token should not be used repeatedly after session creation.

## 9. Recipient Result States

Recommended result states:

- `preview_only`: current placeholder state.
- `invalid`: malformed or unknown token.
- `expired`: grant expired.
- `revoked`: grant revoked.
- `exhausted`: one-time or limited-use grant consumed.
- `verification_required`: recipient email must be verified.
- `provider_unavailable`: email verification required but provider disabled.
- `rate_limited`: request rate-limited.
- `scope_denied`: token valid but not for requested target/action.
- `ready`: scoped session may open the target.

## 10. Abuse Controls

Before production validation, WilliamOS needs durable limits for:

- Token parse failures per IP/client signal.
- Unknown-token hash lookups per IP/client signal.
- Known-token validation attempts per token hash.
- Email verification requests per grant and recipient.
- Session creation attempts per grant.

In-memory limits are insufficient for production serverless deployments.

## 11. Audit Requirements

Every validation path should write a non-secret audit event:

- `access_grant_token_missing`
- `access_grant_token_malformed`
- `access_grant_token_unknown`
- `access_grant_token_expired`
- `access_grant_token_revoked`
- `access_grant_token_exhausted`
- `access_grant_scope_denied`
- `access_grant_rate_limited`
- `access_grant_verification_required`
- `access_grant_session_created`

Events must include:

- Outcome class.
- Grant id only when known.
- Target resource only when known and safe.
- Correlation id.
- Privacy-preserving client signal.

Events must not include:

- Raw token.
- Full token hash if not needed.
- OTP code.
- Provider secrets.
- Raw email payload.

## 12. Minimal Implementation Sequence

Recommended implementation sequence after owner approval:

1. Add pure token parser tests.
2. Add token hash helper tests.
3. Add access-grant schema.
4. Add read-only grant lookup function.
5. Add validation result model without rendering target resources.
6. Add audit event writer.
7. Add durable rate limiter.
8. Turn `/access/[token]` from placeholder into validation state renderer.
9. Add one read-only evidence-packet target.

Do not combine schema, route activation, email verification, and target rendering
in one work order.

## 13. Stop Gates

Stop before implementation if the next slice requires:

- DB/schema migration.
- Secret/pepper configuration.
- Env or Vercel config changes.
- Token validation in production.
- Email provider setup.
- Email sending.
- Better Auth user creation.
- Non-operator account model.
- Comment-capable recipient mutation.
- Package/dependency changes.
- Hermes, MCP, autonomy, scheduler, worker dispatch, or production-write
  behavior.

## 14. Acceptance Criteria

The validation design is ready when:

- Parser, hash, lookup, grant checks, session exchange, result states, and audit
  events are specified.
- The route remains preview-only until schema and rate limits are approved.
- Access validation is clearly separated from login and authority.
- The first implementation slice can be limited to pure parser/hash tests.
