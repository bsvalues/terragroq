# Access Grant Doctrine and UX Design

Work order: `WO-AUTH-007A`

Mode: design-only

## 1. Purpose

Access grants are the non-operator entry path for WilliamOS. They let a reviewer,
builder, or outside recipient open one bounded surface without creating a public
account and without entering the Primary Operator console.

Core rule:

```text
Operators authenticate.
Non-operators receive scoped access grants.
Access grants never create operator accounts.
Access grants never grant authority.
```

This document turns the existing Operator Auth and Access Grant Doctrine into a
recipient-facing UX model, scope model, and implementation sequence. It does not
change auth behavior, schema, email delivery, provider configuration, or runtime
policy.

## 2. Recipient Journey

The default journey should be:

1. The Primary Operator creates a scoped grant for one target surface.
2. WilliamOS creates a random access token and stores only a hash.
3. The Primary Operator sends the link through an approved channel.
4. The recipient opens `/access/[token]`.
5. WilliamOS validates token hash, expiry, revocation, use count, and scope.
6. If the grant is email-bound and identity matters, WilliamOS requests email
   verification before revealing the target.
7. The recipient lands directly on the granted surface.
8. WilliamOS records audit events for open, validation, verification, denial, and
   consumption.

The recipient should never see generic signup, workspace onboarding, team invite,
or operator-account language.

## 3. Grantable Surfaces

Initial access grants should be limited to read-only or narrowly reviewable
surfaces.

Recommended grantable targets:

- Work order packet preview.
- Evidence packet.
- Decision packet.
- Readiness report.
- Brain Council reasoning packet.
- Hermes readiness or boundary packet.
- Project brief or project evidence bundle.
- Limited builder handoff packet.

Not recommended for first implementation:

- Full project workspace access.
- Global search.
- Memory.
- Settings.
- Authority ledger.
- Operator Home.
- Any action that mutates records.

## 4. Grant Modes

Default mode:

```text
one target
time-limited
bounded use count
read-only unless explicitly scoped for comment
```

Supported design modes:

- One-time grant: expires after first successful consumption or session start.
- Limited reuse grant: allows a small configured use count.
- Session-bound grant: opens a short-lived access session after token validation.
- Email-bound grant: requires recipient email verification before target access.

The first implementation should prefer one-time or session-bound read-only grants
because they are easiest to reason about and revoke.

## 5. Expiry And Revocation

All access grants should expire.

Recommended defaults:

- Evidence or decision packet: 7 days.
- Work order packet review: 7 days.
- Limited builder handoff: 24 to 72 hours.
- Emergency diagnostic packet: 24 hours.

Revocation must take precedence over expiry and use count. A revoked grant should
show a clear policy message without revealing whether the target resource still
exists.

## 6. Email Binding And Verification

Email binding is recommended when identity matters, but should not be required
for every low-risk packet.

Email-bound grants should:

- Store a normalized recipient email hash where possible.
- Avoid logging raw recipient email in token validation paths.
- Use generic verification messages to avoid account enumeration.
- Require durable rate limits before production use.

Email verification should be required for:

- Comment-capable grants.
- Builder handoff packets.
- Project evidence with non-public context.
- Any grant that could expose sensitive operational information.

Email verification may be optional for:

- Low-sensitivity read-only evidence packets.
- Public-ish status summaries approved by the Primary Operator.

Email verification must not create a user account. It only proves possession of
the email address associated with the scoped grant.

## 7. Scope Model

Access grant scopes should describe exactly what the token permits.

Recommended initial scopes:

- `grant:evidence.read`
- `grant:work_order.read`
- `grant:decision_packet.read`
- `grant:readiness.read`
- `grant:brain_council_packet.read`
- `grant:hermes_packet.read`
- `grant:project_brief.read`
- `grant:builder_packet.read`
- `grant:work_order.comment_limited`

Comment-capable scopes should be treated as a later implementation phase because
they introduce mutation, moderation, and audit requirements.

Forbidden scopes:

- `operator_console`
- `authority_grant`
- `access_grant_admin`
- `auth_policy_write`
- `settings_write`
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

## 8. State Copy

### Valid Grant

Title:

```text
Access granted
```

Body:

```text
This link opens a limited WilliamOS review surface. It does not create an
operator account and does not grant authority.
```

Primary action:

```text
Open review packet
```

### Email Verification Required

Title:

```text
Verify recipient email
```

Body:

```text
This grant is bound to a recipient email. Verification confirms access to this
packet only; it does not create a WilliamOS account.
```

### Expired Grant

Title:

```text
Access link expired
```

Body:

```text
This scoped access link has expired. Ask the Primary Operator for a new grant if
review is still needed.
```

### Revoked Grant

Title:

```text
Access revoked
```

Body:

```text
The Primary Operator revoked this grant. This link no longer opens a WilliamOS
surface.
```

### Already Used

Title:

```text
Access link already used
```

Body:

```text
This one-time grant has already been consumed. Ask the Primary Operator for a new
scoped grant if access is still required.
```

### Scope Denied

Title:

```text
Access scope does not allow this
```

Body:

```text
This grant only permits the assigned review surface. It cannot open the Operator
Console or perform actions.
```

### Provider Unavailable

Title:

```text
Email verification is not configured
```

Body:

```text
This grant requires email verification, but the email provider is not configured
in this environment. Ask the Primary Operator for a different access path.
```

## 9. Audit Events

Access grants require durable audit records before production implementation.

Recommended events:

- `access_grant_created`
- `access_grant_link_copied`
- `access_grant_opened`
- `access_grant_validated`
- `access_grant_validation_failed`
- `access_grant_email_verification_required`
- `access_grant_email_verification_requested`
- `access_grant_email_verified`
- `access_grant_expired_attempt`
- `access_grant_revoked_attempt`
- `access_grant_exhausted_attempt`
- `access_grant_scope_denied`
- `access_grant_session_started`
- `access_grant_consumed`
- `access_grant_revoked`

Audit records must not include raw tokens, OTP codes, provider secrets, or full
email payloads.

## 10. Account Creation Rule

An access grant must never create a user account.

Allowed:

- Create a temporary scoped access session.
- Attach a verified email claim to that session.
- Record audit evidence.

Not allowed:

- Create an operator account.
- Create a regular application account.
- Upgrade a recipient into an operator.
- Convert a grant into login credentials.
- Reopen signup.

If future non-operator accounts are needed, that must be a separate owner
decision with its own data model, policy, and migration plan.

## 11. Access Grant Screen Placement

Recommended routes:

- `/access/[token]`: token entry and state resolution.
- `/access/expired`: optional static expired-state route.
- `/access/revoked`: optional static revoked-state route.
- `/access/help`: optional explanation surface.

The `/operator`, `/sign-in`, and `/sign-up` routes should link non-operators
toward scoped access, but should not validate tokens themselves.

## 12. Implementation Queue

Recommended next work orders:

1. `WO-AUTH-007B` - Access Key Data Model Design.
2. `WO-AUTH-007C` - Access Grant Placeholder Route.
3. `WO-AUTH-007D` - Access Grant Token Validation Design.
4. `WO-AUTH-007E` - Access Grant Audit Event Design.
5. `WO-AUTH-008A` - Recovery Safety Architecture.
6. `WO-AUTH-008B` - DB-Backed Auth Rate Limiter Design.
7. `WO-AUTH-010A` - Operator Access Management Design.

Implementation must not start until the data model, token hashing, audit, and
rate-limit decisions are approved.

## 13. Stop Gates

Stop before implementation if a work order requires:

- DB/schema/data mutation.
- Access-grant table creation.
- Token verification runtime behavior.
- Email sending.
- Env or Vercel config change.
- Provider setup.
- Package/dependency change.
- Public signup reopening.
- Auth policy change.
- Operator-account creation by access grant.
- Hermes, MCP, autonomy, scheduler, worker dispatch, or production-write
  behavior.

## 14. Acceptance Criteria

The access grant UX model is ready when:

- Non-operators clearly enter through scoped grants, not signup.
- Every grant state has operator-grade copy.
- Grantable and forbidden scopes are explicit.
- Email verification is separated from account creation.
- Access grants are separate from authority grants.
- Token, audit, expiry, and revocation needs are documented.
- The next work order is data-model design, not production implementation.
