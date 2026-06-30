# Operator Login Surface Design

Work order: `WO-AUTH-006F`

Mode: design-only

## 1. Purpose

The operator login surface is the privileged control-plane entry point for
WilliamOS. It must make a clear distinction between:

- Operator authentication.
- First-owner bootstrap.
- Account recovery.
- Signup-locked policy states.
- Scoped non-operator access grants.

The surface must not imply that ordinary visitors can self-register for the
operator console. Non-operators enter through scoped access grants, not through
operator onboarding.

## 2. Reusable Naming Style Guide

TerraGroq is legacy repo/product naming from an earlier Groq-era build. The
current system must not describe itself as Groq-powered or xAI-powered unless
that is true for a specific configured runtime.

Preferred user-facing language:

- `WilliamOS`: operator-controlled build and governance environment.
- `Operator Console`: privileged authenticated control-plane UI.
- `Brain Council`: reasoning and governance layer.
- `Agent Forge`: controlled build/work-order execution model.

Acceptable limited usage:

- `TerraGroq`: legacy repository, deployment, or historical product name.

Reference rule:

- Future auth, UX, governance, and onboarding work orders should reference this
  section instead of redefining product naming from scratch. If a broader
  repository style guide is created later, move this guidance there and link
  back from this document.

Avoid on auth surfaces:

- "Groq-powered"
- "xAI-powered"
- "TerraGroq account" when the intended identity is the WilliamOS operator.
- Any copy implying that login grants deploy, merge, production-write, MCP,
  Hermes, or autonomous-agent authority.

## 3. Route Model

### `/operator`

Primary operator entry point.

Responsibilities:

- Explain that this is the WilliamOS Operator Console.
- Show the current auth state.
- Route to sign-in, bootstrap, recovery, or setup diagnostics.
- Route non-operators toward access grants.

`/operator` should become the preferred human-facing entry point. It may render
the same auth form as `/sign-in`, but the copy should be operator-specific.

### `/sign-in`

Compatibility route for existing auth links and redirects.

Responsibilities:

- Preserve existing session redirects.
- Prefer "Sign in to WilliamOS" language.
- Link to `/operator` if the operator-specific route exists.

### `/sign-up`

Bootstrap-only route.

Responsibilities:

- Create the first operator only when bootstrap policy is open.
- Explain when bootstrap is already complete.
- Never present itself as public registration.

### `/access/[token]`

Future scoped access-grant route.

Responsibilities:

- Let invited reviewers/builders open only the specific packet or workspace they
  were granted.
- Never expose the full operator console.
- Never grant authority gates, deploys, merges, auth policy, production writes,
  MCP, Hermes, or autonomous execution.

## 4. Screen State Copy

### Operator entry

Title:

```text
WilliamOS Operator Console
```

Body:

```text
Sign in with an operator account to review governance state, Brain Council
evidence, work orders, and release decisions.
```

Primary action:

```text
Sign in as operator
```

Secondary action:

```text
Have an access link? Open scoped access
```

Safety note:

```text
Signing in authenticates you. Dangerous actions still require separate
authorization gates.
```

### First-owner bootstrap

Title:

```text
Create the first operator
```

Body:

```text
No operator account exists yet. Create the first operator to finish bootstrap
and lock public signup.
```

Primary action:

```text
Create first operator
```

Warning:

```text
This is not public registration. After the first operator is created, signup
closes.
```

### Normal sign-in

Title:

```text
Sign in to WilliamOS
```

Body:

```text
Use the operator account created during bootstrap. If you are not an operator,
use the scoped access link provided to you.
```

Primary action:

```text
Continue
```

Recovery link:

```text
Need help signing in?
```

### Signup locked

Title:

```text
Operator signup is locked
```

Body:

```text
Bootstrap is complete and an operator already exists. New operator access must
be granted by policy, not by public signup.
```

Primary action:

```text
Go to operator sign-in
```

Secondary action:

```text
Open scoped access link
```

### Signup disabled by policy

Title:

```text
Signup is disabled by policy
```

Body:

```text
This environment does not allow account creation from the public auth screen.
Ask the operator for the correct access path.
```

Primary action:

```text
Go to sign-in
```

### Origin not trusted

Title:

```text
This origin is not trusted for auth
```

Body:

```text
WilliamOS blocked this auth request because the current origin is not listed as
trusted.
```

Diagnostic fields:

- Current origin.
- Trusted origins.
- Recovery action.

Recovery copy:

```text
Use the canonical WilliamOS URL or ask the operator to update trusted origins.
```

Implementation note:

- Trusted-origin diagnostics should read from the same policy source used by
  auth runtime checks. Today that means `BETTER_AUTH_URL`, deployment URL
  fallbacks, and `BETTER_AUTH_TRUSTED_ORIGINS` as parsed by the repo-owned auth
  origin helper. Do not create a second trusted-origin list for UI copy.

### Recovery unavailable

Title:

```text
Recovery is not configured yet
```

Body:

```text
Email recovery is scaffolded but disabled until the operator configures the
email provider, sender identity, and rate limits.
```

Primary action:

```text
Return to sign-in
```

### Provider unavailable

Title:

```text
This sign-in method is not configured
```

Body:

```text
Only the configured operator sign-in methods are available in this environment.
Google, GitHub, Microsoft, OTP, or magic-link sign-in require separate setup.
```

## 5. Button Hierarchy

Operator auth screens should use this hierarchy:

1. Primary: continue the valid operator path.
2. Secondary: route to scoped access or setup diagnostics.
3. Tertiary: recovery/help copy.

Do not make "Create account" visually equivalent to operator sign-in unless
bootstrap is actually open.

When signup is closed, hide or demote public signup actions and show the policy
state instead.

## 6. What Must Never Appear

Operator login must never say or imply:

- Public signup is available when bootstrap is closed.
- Login itself grants merge, deploy, production-write, auth-policy, MCP, Hermes,
  or autonomous-agent authority.
- Scoped access grants are equivalent to operator accounts.
- Brain Council or Hermes can authenticate as a human.
- The system is powered by Groq or xAI unless that runtime is specifically
  configured and verified.
- OTP, magic link, Google, GitHub, or Microsoft sign-in is available before it is
  configured.

## 7. Implementation Plan

### `WO-AUTH-006G` Operator Route Shell

Add `/operator` as the preferred auth entry route. It should reuse existing auth
readiness and auth form logic, but use operator-specific copy and route links.

Constraints:

- No auth policy change.
- No provider setup.
- No DB/schema change.
- No env/Vercel change.

### `WO-AUTH-006H` Auth Naming Cleanup

Replace user-facing legacy TerraGroq auth copy with WilliamOS/Operator Console
language where appropriate.

Known candidate:

- Email OTP subject/body currently mentions TerraGroq.

Constraints:

- Copy-only.
- No sender behavior change.
- No OTP enablement.

### `WO-AUTH-006I` Access Grant Placeholder Route Design

Design or add a safe `/access/[token]` placeholder that explains scoped access
without validating tokens yet.

Constraints:

- No access-grant data model.
- No token verification.
- No production access path.

### `WO-AUTH-006J` Recovery UX Copy Integration

Integrate recovery-unavailable and provider-unavailable copy into the operator
route and sign-in form.

Constraints:

- No OTP sending.
- No password reset implementation.
- No email provider setup.

## 8. Stop Gates

Stop before implementation if any slice requires:

- DB/schema/data mutation.
- Env or Vercel config change.
- Package/dependency change.
- Provider account setup.
- OTP or social login enablement.
- Public signup reopening.
- Auth policy change.
- Hermes, MCP, autonomy, scheduler, worker dispatch, or production-write
  behavior.

## 9. Acceptance Criteria For Future Implementation

The login surface is ready when:

- The operator path is obvious.
- Signup-locked state is clearly policy, not outage.
- Non-operators are directed to scoped access, not signup.
- Recovery paths are honest about configured/unconfigured state.
- Legacy TerraGroq naming does not confuse runtime or provider ownership.
- Login is clearly separated from dangerous authority gates.
