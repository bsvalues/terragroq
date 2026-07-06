# WO-AUTH-006I - Remove SaaS Signup Model From WilliamOS Owner Access

RESULT: PASS

Reclassified the auth defect as a product-model violation rather than an auth naming issue.

The normal operator entry path no longer exposes `/sign-up` or self-service account creation. `/operator` now routes to Primary Access and scoped-access preview only. `/sign-in` no longer adds a secondary `/sign-up` action even when the policy reports provisioning open.

Direct `/sign-up` is now treated as controlled bootstrap owner provisioning only. If bootstrap provisioning is not both mode `bootstrap` and open, the route redirects to `/sign-in`.

FORBIDDEN_AUTH_LANGUAGE_BEFORE: visible auth/setup/status copy included Create Primary Operator, Request access, Signup labels, sign-up status labels, public account creation copy, create-account recovery copy, and workspace/local onboarding setup copy.

FORBIDDEN_AUTH_LANGUAGE_AFTER: focused auth-entry scan shows no forbidden operator-facing matches for create account, create primary, request access, sign up, public account creation, user onboarding, workspace, team, or organization. Remaining `signup` references are internal policy/API/provider identifiers or tests.

SIGNUP_ROUTE_EXPOSED_BEFORE: `/operator` exposed `/sign-up` when signup was open; `/sign-in` exposed `/sign-up` when signup was open; `/setup` linked to `/sign-up` after setup.

SIGNUP_ROUTE_EXPOSED_AFTER: `/operator` and `/sign-in` do not expose `/sign-up`. `/setup` may link to controlled owner provisioning after local setup succeeds. Direct `/sign-up` redirects unless controlled bootstrap provisioning is open.

BOOTSTRAP_ROUTE_STATUS: retained as controlled owner provisioning because the current auth provider still requires an initial owner credential path. It is no longer normal product UX.

AUTH_BEHAVIOR_CHANGED: yes, normal entry no longer exposes self-service provisioning and direct `/sign-up` is bootstrap-only.

AUTH_POLICY_CHANGED: no provider rewrite, DB/schema change, env change, package change, or auth policy mechanism change.

SAFETY: No auth provider rewrite, broad security rewrite, DB/schema change, env change, dependency change, Vercel setting change, production-write behavior, Hermes/MCP activation, or autonomy was added.
