# Operator Auth and Access Grant Doctrine

WilliamOS / TerraGroq is an operator-controlled AI build and governance
environment, not a public SaaS signup product.

Core rule:

```text
Operator signs in.
Everyone else enters through a scoped access grant.
Login never grants dangerous authority by itself.
Agents do not use human login.
```

This doctrine replaces generic signup/invite thinking with three separate trust
models: operator authentication, scoped human access grants, and delegated agent
authority packets.

## 1. Operator Auth

Operator auth is the control-plane door. It exists for the owner/operator who
manages the system, reviews evidence, grants access, and approves dangerous
authority.

The operator auth path should support:

- Email/password fallback.
- Future email-code recovery after provider and durable rate-limit gates pass.
- Future Google/GitHub convenience login only after provider strategy is approved.
- Bootstrap creation only while no operator exists.
- Locked production signup once an operator exists.

The operator auth path must not:

- Reopen public signup.
- Create accounts through OTP or social login by default.
- Grant deploy, DB, schema, auth-policy, Hermes, MCP, autonomy, or production-write
  authority merely because the user is logged in.
- Treat login as a work-order or release approval.

Current implementation posture:

- `WO-AUTH-003` made trusted origins inspectable and explicit.
- `WO-AUTH-004` split setup, bootstrap, sign-in, signup-locked, and signup-disabled states.
- `WO-AUTH-006C` scaffolded Email OTP with `disableSignUp: true`.
- `WO-AUTH-006D` selected Resend as the likely provider, but production OTP remains disabled.

## 2. Access Grants

Access grants are the non-operator door. A non-operator should not create a public
account or enter the full control plane. They receive a scoped link/key for a
specific purpose.

Example grant purposes:

- Review a Brain Council decision packet.
- View evidence for a work order.
- Comment on a work order.
- Inspect a demo or runtime evidence bundle.
- Review a limited builder workspace.

An access grant may allow:

- Viewing the exact target resource.
- Commenting only if the grant scope allows it.
- Optional email verification when recipient identity matters.
- Time-limited access.
- Revocation by the operator.

An access grant must never allow:

- Full operator console entry.
- Public account creation.
- Authority grants.
- Work order approval.
- Deploy, release, tag, merge, push, schema, DB, auth-policy, Hermes, MCP,
  autonomy, scheduler, worker dispatch, or production-write actions.
- Escalation from scoped reviewer/builder to operator without a separate operator
  decision.

## 3. Actor / Access Matrix

| Actor | Entry path | Can access | Cannot access |
| --- | --- | --- | --- |
| Operator | Operator auth | Full control plane, subject to authority gates | Dangerous actions without explicit grants |
| Reviewer | Scoped access grant | Target packet/evidence/review surface | Operator console, auth policy, grants, deploys |
| Builder collaborator | Scoped access grant | Assigned builder/review workspace | Global data, authority gates, production writes |
| Public visitor | None | Public landing/error states only | Signup, internal resources |
| AI agent | Work order + authority packet | Task-specific context and permitted actions | Human login, self-authorization, authority escalation |

## 4. Access Key Lifecycle

Access keys should be durable, auditable, and revocable.

Proposed lifecycle:

1. Operator creates a grant for a target resource and scope.
2. System stores only a token hash, never the raw token.
3. Operator copies or sends the access link through an approved channel.
4. Recipient opens `/access/[token]`.
5. System validates token hash, expiry, revocation, use count, and scope.
6. Optional email verification confirms recipient identity.
7. Recipient lands on the exact granted surface.
8. Each open/verify/comment action appends audit evidence.
9. Grant expires, reaches max use count, or is revoked.

Audit records should not live only inside the access-grant row. Future
implementation should write human-facing activity to `event_log` and
governance-critical grant lifecycle transitions to `governance_event`, while the
grant table stores current state and lookup fields.

Recommended grant states:

- `active`
- `expired`
- `revoked`
- `exhausted`
- `invalid`

Recommended grant scopes:

- `view_evidence`
- `review_decision_packet`
- `comment_work_order`
- `view_demo`
- `limited_builder_workspace`

These names are doctrine seeds, not a second implementation enum. `WO-AUTH-007B`
must reconcile them with the codebase's eventual access-grant scope constants so
the data model, validator, and UI share one source of truth.

Forbidden grant scopes:

- `operator_console`
- `authority_grant`
- `deploy`
- `release`
- `schema_write`
- `db_write`
- `auth_policy_write`
- `hermes_runtime`
- `mcp_activation`
- `autonomy`

## 5. Access Link UX Copy

Valid grant:

```text
You have been granted access.
This link opens a limited review surface. It does not create an operator account.
```

Expired grant:

```text
This access link has expired.
Ask the operator for a new scoped grant if access is still needed.
```

Revoked grant:

```text
This access has been revoked.
The operator removed this grant.
```

Malformed/unknown grant:

```text
This link is not valid.
Check the link or ask the operator for a new access grant.
```

Email verification required:

```text
Verify your email to continue.
Verification confirms the grant recipient. It does not create a public account.
```

## 6. Brain Council, Hermes, And Agents

Brain Council can reason, review, score, and propose. It does not authenticate as
a human and does not receive authority from operator login.

Hermes remains preview/research-only until a separate activation pathway is
approved. Access grants may expose Hermes readiness evidence, but never activate
Hermes.

Agents use delegated authority packets, not normal login. A packet must identify:

- Work order.
- Scope.
- Allowed actions.
- Blocked actions.
- Evidence requirements.
- Expiration.
- Required validators.
- Authority grant reference, when needed.

## 7. Security Risks

Primary risks:

- Public signup accidentally reopens.
- OTP creates unknown users.
- Access links become broad sessions.
- Access links leak raw tokens in logs.
- Login is mistaken for authority.
- Social login becomes implicit account provisioning.
- Reviewer/builder access gains production authority.
- Agent identity is confused with human identity.

Required mitigations:

- Keep `disableSignUp: true` for OTP.
- Store access tokens hashed only.
- Use generic success responses for recovery and verification requests.
- Use durable rate limits for recovery/access verification.
- Audit every grant open, failed open, verification, comment, expiration, and revocation.
- Keep authority grants separate from authentication and access grants.

## 8. Revised Auth Roadmap

1. `WO-AUTH-006F` - Operator Login Surface Design.
2. `WO-AUTH-006G` - Operator Login Surface Implementation.
3. `WO-AUTH-007A` - Access Grant Doctrine + UX Design.
4. `WO-AUTH-007B` - Access Key Data Model Design.
5. `WO-AUTH-008A` - Recovery Safety Architecture.
6. `WO-AUTH-008B` - DB-Backed Auth Rate Limiter Design.
7. `WO-AUTH-008C` - DB-Backed Auth Rate Limiter Implementation.
8. `WO-AUTH-008D` - Recovery Audit + Readiness Hardening.
9. `WO-AUTH-009A` - Resend Domain + Sender Checklist.
10. `WO-AUTH-009B` - Resend Env Readiness Verification.
11. `WO-AUTH-009C` - Enable Operator Recovery Email Code.
12. `WO-AUTH-010A` - Operator Access Management Design.
13. `WO-AUTH-010B` - Access Grant Management UI Implementation.
14. `WO-AUTH-011A` - Google/GitHub/Microsoft Provider Strategy.
15. `WO-AUTH-012A` - Agent Authority Doctrine.

## 9. Implementation Guardrails

Before any implementation after this doctrine:

- No public signup.
- No OTP production sending without provider and durable limiter gates.
- No access grant production flow without data-model approval.
- No social login without provider strategy and callback/origin proof.
- No DB/schema mutation without explicit schema work order.
- No Hermes/MCP/autonomy/runtime activation through auth or access.
- No authority from login alone.
