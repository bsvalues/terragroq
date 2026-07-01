# WO-DEPLOY-003 Owned VPS/VM Production Runbook Design

## Result

RUNBOOK READY FOR OWNER REVIEW.

This document designs the first owned VPS/VM production proof for WilliamOS.
It does not authorize or perform deployment, server access, DNS changes, Vercel
changes, env changes, GitHub rules changes, package changes, runtime behavior
changes, or production writes.

## Purpose

Move WilliamOS toward an owned production path with observable deployed-commit
provenance while keeping Vercel available as non-blocking preview/staging until
the replacement is proven.

## Target Architecture

Recommended first proof:

- one owned VPS/VM
- Linux LTS distribution
- Node.js runtime pinned by repo/tooling decision
- reverse proxy in front of the Next.js server
- TLS termination at the reverse proxy
- process manager for restart and log capture
- environment file managed outside the repository
- deploy provenance artifact written at deploy time
- health/readiness/security-header checks after every deploy

Vercel remains:

- optional preview/staging
- non-blocking by default
- blocking only for Work Orders that explicitly target Vercel/deployment
  behavior

## Server Requirements

Minimum proof host:

- 2 vCPU
- 4 GB RAM
- 30 GB disk
- Linux LTS
- SSH access restricted to owner-approved keys
- firewall allowing only SSH, HTTP, and HTTPS
- outbound network access for package install and app provider calls

Production candidate host:

- 2-4 vCPU
- 8 GB RAM
- 60+ GB disk
- automated security updates or documented patch rhythm
- monitoring and log retention
- backup path for config, deploy metadata, and recovery notes

## Install Prerequisites

The runbook should define, but not execute, installation for:

- Git
- Node.js
- package manager used by the repo
- build tools required by dependencies
- reverse proxy
- TLS certificate automation
- process manager
- log rotation
- firewall tooling

No dependency or package changes are authorized by this runbook.

## Environment Inventory Template

Secrets must never be committed. The production environment inventory should
list names, purpose, owner, and rotation posture only.

| Variable | Purpose | Required | Secret | Rotation |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Postgres connection | yes | yes | owner-defined |
| `BETTER_AUTH_SECRET` | Auth signing secret | yes | yes | owner-defined |
| `BETTER_AUTH_URL` | Canonical auth base URL | yes | no | when domain changes |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Allowed origins | yes | no | when domains change |
| `OPENAI_API_KEY` or gateway equivalent | Model access if used | depends | yes | provider-defined |
| `AUTH_EMAIL_OTP_ENABLED` | Email OTP activation flag | no | no | owner-approved only |
| `RESEND_API_KEY` | Email sender | no | yes | provider-defined |
| `AUTH_EMAIL_FROM` | Email sender identity | no | no | when sender changes |

Access grants, OTP sending, and other disabled capabilities must remain disabled
unless a separate owner activation Work Order authorizes them.

## Process Manager Design

The process manager should:

- run the production server as a non-root user
- restart on crash
- start on boot
- capture stdout and stderr logs
- expose process status for operator verification
- keep deploy rollback simple

Recommended initial shape:

- build artifact or checked-out release directory
- current release symlink
- process named `williamos`
- rollback by repointing the current release symlink to last-known-good

## Reverse Proxy Design

The reverse proxy should:

- terminate TLS
- proxy HTTP traffic to the local Next.js server
- set or preserve security headers defined by the app
- pass host and forwarded headers correctly
- support a future canonical domain
- deny direct exposure of internal ports

Required verification:

- `/api/health`
- `/api/auth/readiness`
- `/goal-console`
- security headers
- `x-powered-by` absent

## TLS and DNS Plan

No DNS changes are authorized by this runbook.

Before DNS cutover:

- choose canonical domain
- confirm rollback DNS target
- confirm TTL strategy
- verify TLS certificate issuance on staging or temporary hostname
- verify auth trusted origins for the future domain

DNS cutover requires a separate owner-approved Work Order.

## Deployment Provenance Model

Every deploy must produce an observable provenance record:

- deployed commit SHA
- deploy timestamp
- deploy actor or process
- target host
- release directory
- build command result
- test/build evidence used before deploy
- health result
- auth readiness result
- security-header result
- rollback target

The provenance record may be a local file, endpoint, or evidence packet. The
first implementation should choose the smallest observable mechanism.

## Health and Readiness Verification

Post-deploy checks:

1. deployed commit matches approved main commit
2. `/api/health` returns `200` and `status: ok`
3. `/api/auth/readiness` returns `200` and `ready: true`
4. `/goal-console` returns `200`
5. `x-content-type-options` is present
6. `referrer-policy` is present
7. `x-frame-options` is present
8. `permissions-policy` is present
9. `x-powered-by` is absent
10. access grant issue/accept routes remain disabled until activation
11. Hermes/MCP/autonomy remain disabled until activation

## Rollback Plan

Rollback requires owner authority.

Rollback should define:

- last-known-good commit
- last-known-good release directory
- command to repoint current release
- process restart command
- health/readiness verification after rollback
- DNS rollback if DNS has been changed
- env rollback if env has changed
- database posture, even when no schema migration occurred

No rollback automation is authorized by this runbook.

## Backup and Logging Plan

Backups should include:

- production env inventory without secret values
- reverse proxy config
- process manager config
- release provenance records
- rollback notes
- operational logs

Logs should be:

- readable by the owner
- rotated
- excluded from git
- reviewed for secret leakage
- captured in evidence when relevant

## CI and Check Replacement Model

Repo-owned required checks should replace Vercel as the merge-critical source:

- `git diff --check`
- full test suite
- production build
- route smoke where safe
- security-header smoke
- auth readiness smoke
- access-grant disabled smoke while grants remain inactive
- provenance check after deploy

Vercel preview/deploy status remains non-blocking unless the Work Order is
explicitly about Vercel or deployment behavior.

## Owner Decision Checklist

Before implementation, owner must decide:

- VPS/VM provider
- domain strategy
- SSH/key management policy
- production env source
- process manager choice
- reverse proxy choice
- TLS approach
- logging retention
- backup location
- provenance mechanism
- rollback authority model
- whether Vercel remains preview-only during proof

## Explicitly Not Authorized

- deploy
- server login
- DNS change
- Vercel change
- env secret creation
- GitHub ruleset or branch protection change
- package or dependency change
- code/runtime behavior change
- DB/schema change
- auth/access behavior change
- Hermes/MCP/autonomy activation
- release or tag
- production-write behavior

## Next Recommended Work Order

`WO-DEPLOY-004 - Owned VPS/VM Owner Decision Packet`

Mode: owner decision only.

Purpose: choose provider/domain/process-manager/reverse-proxy/provenance
mechanism before any infrastructure access or migration work begins.
