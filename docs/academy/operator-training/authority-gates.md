# Authority Gates

Authority gates define what requires Primary approval before work may proceed.

## Merge

Merging a PR is allowed only when the packet authorizes it and checks are green. UI-driven GitHub write actions remain blocked unless explicitly authorized.

## Deploy and Promote

Production deploys, cutovers, tags, releases, and promotion actions require explicit authority.

## Auth

Auth behavior, access grants, permission models, and policy enforcement changes require explicit authority.

## DB and Schema

DB/schema migration, production DB touch, data mutation, dump read, and backup restore require explicit authority and rollback evidence.

## Env and Package

Environment variables, package/dependency changes, runtime configuration, and Vercel/Azure settings require explicit authority.

## Vercel Settings

Vercel configuration changes are cloud-setting changes. Read-only production checks are not Vercel setting changes.

## Autonomy and Workers

Hermes, MCP, workers, background jobs, autonomous loops, runtime Council, and tool calls remain blocked until separate activation gates.

## Production Writes

Production-write behavior requires explicit owner authority and evidence. It is blocked by default.
