# WO-DEPLOY-002 Owned Production Target Decision Packet

## Result

READY FOR OWNER DECISION.

This packet evaluates WilliamOS production hosting options and defines the
decision required before any deployment migration, DNS change, Vercel setting
change, environment change, or production target change.

## Context

GOAL-DEPLOY-001 found that Vercel is not branch-protection enforced. Vercel is
currently coupled through:

- external GitHub commit statuses
- GitHub deployment records from `vercel[bot]`
- canonical production hosting at `https://terragroq.vercel.app`
- legacy merge-rule expectations that treated all checks as blocking

The corrected governance posture is:

- Vercel is non-blocking by default.
- Vercel is blocking only when a Work Order explicitly targets Vercel or
  deployment behavior.
- WilliamOS should move toward an owned production path with observable
  deployed-commit provenance.

## Decision Required

Choose the intended production path:

1. Owned VPS/VM
2. Azure
3. Hybrid
4. Keep Vercel temporarily as production while preparing replacement
5. Vercel preview/staging only after replacement is proven

## Option Matrix

| Option | Strengths | Risks | Fit |
| --- | --- | --- | --- |
| Owned VPS/VM | Maximum control, simple provenance, no preview-platform rate limit, direct access to logs and process manager | Requires OS hardening, backups, patching, monitoring, rollback discipline | Strong fit for private Primary-operated WilliamOS if ops burden is accepted |
| Azure App Service / Container Apps | Managed runtime, strong identity/networking options, scalable path, enterprise-grade observability | More cloud complexity, cost and configuration surface, vendor coupling remains | Strong fit if managed infra and future enterprise posture matter |
| Hybrid | Keeps Vercel preview convenience while moving production to owned target | Requires clear source-of-truth rules to avoid split-brain releases | Best near-term bridge |
| Keep Vercel temporarily | Lowest immediate change, current production remains healthy | Rate limits and external status coupling remain; deployed-main provenance remains weaker | Acceptable short-term only |
| Vercel preview/staging only | Preserves PR previews while removing production dependence | Requires replacement production target first | Desired end state after migration |

## Recommended Target

Recommended path: Hybrid first, then Vercel preview/staging only.

Rationale:

- WilliamOS can keep Vercel previews useful during transition.
- Production can move to an owned target with explicit deployed-commit
  provenance.
- The migration can be proven before DNS or production traffic changes.
- Vercel can be downgraded from production host to optional preview surface
  instead of removed abruptly.

Recommended production target for first proof: owned VPS/VM.

Rationale:

- Smallest understandable production surface.
- Direct control over runtime, logs, reverse proxy, process manager, and
  deployed commit.
- Good fit for a private Primary-operated environment.
- Easier to reason about than a larger cloud platform during the first
  replacement proof.

Azure remains a later candidate if WilliamOS needs managed identity, enterprise
networking, regional availability, or formal cloud governance.

## Required Replacement Checks

Before Vercel can leave the critical path, WilliamOS needs repo-owned checks:

- `git diff --check`
- full test suite
- production build
- route smoke where safe
- security-header check
- access grant disabled check while grants remain inactive
- auth readiness check
- health check
- deploy provenance check after production deploy

These checks should be recorded independently of Vercel.

## Production Provenance Rule

Every production claim must include:

- deployed commit SHA
- deploy timestamp
- deploy actor or process
- target host
- health result
- auth readiness result
- security-header result
- rollback target

Production is not considered current unless the deployed commit is observable
and matches the approved main commit or an explicitly approved production
artifact.

## Migration Sequence

1. Decide target: hybrid with owned VPS/VM proof recommended.
2. Define host baseline: OS, Node runtime, process manager, reverse proxy,
   TLS, logging, backups, and firewall posture.
3. Define secret strategy without changing current env yet.
4. Add repo-owned CI validation independent of Vercel.
5. Build a read-only deployment runbook.
6. Prove the app can build and run on the target using non-production traffic.
7. Add deployed-commit provenance endpoint or artifact.
8. Run health/readiness/security-header smoke against the target.
9. Decide DNS cutover or parallel-run strategy.
10. Move Vercel to preview/staging only after replacement production is proven.

## Rollback Requirements

Before production cutover, WilliamOS must have:

- last-known-good commit
- rollback command or procedure
- database rollback posture, even if no migration is involved
- DNS rollback plan
- env/secret rollback plan
- health check confirming restored service
- owner authority gate for rollback execution

## Owner Decision Table

| Decision | Recommended Answer | Owner Answer |
| --- | --- | --- |
| Target path | Hybrid first | Pending |
| First production replacement target | Owned VPS/VM proof | Pending |
| Keep Vercel during transition | Yes, preview/staging only after proof | Pending |
| Add repo-owned CI checks | Yes | Pending |
| Require deployed-commit provenance | Yes | Pending |
| Allow DNS cutover now | No | Pending |
| Allow Vercel setting changes now | No | Pending |
| Allow env changes now | No | Pending |
| Allow deployment migration now | No | Pending |
| Next implementation phase | Design/runbook only | Pending |

## Explicitly Not Authorized By This Packet

- deployment
- migration
- DNS changes
- Vercel setting changes
- env changes
- GitHub branch protection or ruleset changes
- package or dependency changes
- DB/schema changes
- auth/access behavior changes
- Hermes/MCP/autonomy activation
- release or tag
- production-write behavior

## Next Recommended Work Order

`WO-DEPLOY-003 - Owned VPS/VM Production Runbook Design`

Mode: design-only first.

Goal: define the target host baseline, deploy provenance mechanism, rollback
procedure, and validation checklist without changing infrastructure.
