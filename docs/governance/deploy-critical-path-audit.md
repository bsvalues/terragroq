# GOAL-DEPLOY-001 Deploy Critical Path Audit

## Result

PASS - read-only audit complete.

WilliamOS is currently coupled to Vercel through external GitHub status checks
and production hosting, not through repo-owned CI configuration or branch
protection.

## Current State

- Repository: `bsvalues/terragroq`
- Default branch: `main`
- Current production URL: `https://terragroq.vercel.app`
- Current repo-owned workflows: none committed under `.github/`
- Current committed Vercel config: none
- Current branch protection: `main` is not protected
- Current GitHub rulesets: none

## Vercel Coupling Points

1. The Vercel GitHub App posts commit statuses named `Vercel`.
2. GitHub deployment records are created by `vercel[bot]`.
3. The canonical production URL is hosted on Vercel.
4. The current work-order playbook treats green PR checks as a merge condition.
5. Because Vercel posts a failing status during rate limiting, the governed
   merge rule treats the PR as blocked even when repo-owned validation passes.

## PR #154 Exception Record

PR #154 was merged under an explicit one-time owner exception.

Reason:

- The only failing check was Vercel deployment rate limiting.
- GitHub branch protection did not require Vercel.
- The PR was docs-only and mergeable.
- Repo-owned validation passed:
  - `git diff --check`
  - full test suite
  - production route verification
  - access grant disabled checks
  - security header checks

This exception did not authorize:

- manual deploy
- Vercel promote
- Vercel setting changes
- env changes
- branch protection changes
- release or tag
- production-write behavior outside the normal merge

## Replacement Merge Rule

Required for normal PR merge:

- repo-owned test validation passes
- repo-owned build validation passes
- `git diff --check` passes when files are changed
- scope matches the active Work Order
- no secrets are introduced
- no blocked mutation is introduced
- safety posture is explicitly reported

Conditionally required:

- route smoke checks when the affected route can be verified safely
- production health/readiness after merge when production deployment occurs

Non-blocking by default:

- Vercel preview/deploy status

Exception:

Vercel becomes blocking only when the Work Order explicitly targets Vercel,
production aliasing, Vercel deployment behavior, Vercel settings, or Vercel
environment behavior.

## Target Production Direction

WilliamOS should move toward an owned production path where deployment
provenance is observable and not rate-limited by an external preview platform.

Candidate targets to evaluate in a separate owner decision packet:

- owned VPS/VM
- Azure App Service or Container Apps
- local/private server with reverse proxy
- hybrid: Vercel preview-only, owned production

## Safe Migration Sequence

1. Define the target production platform.
2. Add repo-owned CI checks for tests, build, formatting/diff hygiene, and
   optional route smoke.
3. Define a production provenance rule: the deployed commit must be observable.
4. Move Vercel to preview-only or non-blocking status.
5. Add deploy evidence records independent of Vercel.
6. Prove the replacement production path with health/readiness checks.
7. Remove Vercel from merge-critical decisions.

## Owner Decisions Required

- What is the target production platform?
- Should Vercel remain preview-only or be disconnected entirely?
- What repo-owned checks become mandatory?
- What production provenance signal is authoritative?
- What route smoke is safe before and after merge?
- Who may trigger production deploys?
- What rollback mechanism is required before migration?

## Current Recommendation

Keep Vercel available as non-blocking preview/staging while WilliamOS defines an
owned production path. Do not let Vercel rate limits block docs-only or
repo-validated Work Orders unless the Work Order is explicitly about Vercel.

Next recommended Work Order:

`WO-DEPLOY-002 - Owned Production Target Decision Packet`
