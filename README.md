# WilliamOS

A governed operating console for AI-assisted software work. WilliamOS treats every
operator command as a **goal that must be classified before it can act** — not a
prompt that is immediately executed. It enforces an explicit authority model
(A0–A9), a deterministic risk classifier, doctrine guardrails, a work-order
lifecycle, and a tamper-evident audit trail so that *what an agent is allowed to do*
is always separate from *what it claims it will do*.

> **One sentence:** a goal is not execution authority. WilliamOS makes that
> separation the center of the product.

---

## Why this exists

Most AI tooling collapses intent into action: you ask, it does. That is fine until
the action is destructive, irreversible, or outside the scope you actually agreed
to. WilliamOS inserts a governed layer between intent and action:

1. **Classify** every goal deterministically (lane, mode, risk, required authority).
2. **Refuse or gate** anything that trips a blocking mistake pattern or doctrine rule.
3. **Require an explicit authority grant** — approval alone never grants power.
4. **Run loops that plan and verify but never silently mutate** the repo.
5. **Record everything** in append-only, hash-chained governance events.

These are not suggestions enforced by prompt text — they are enforced in code and
covered by tests.

---

## Tech stack

| Concern        | Choice                                              |
| -------------- | --------------------------------------------------- |
| Framework      | Next.js 15 (App Router, RSC, Server Actions)        |
| UI             | React 19, Tailwind CSS v4, Radix UI, lucide-react   |
| Auth           | Better Auth (email + password)                      |
| Database       | Neon Postgres via Drizzle ORM (`pg` driver)         |
| Vector / RAG   | `pgvector` (1536-dim embeddings)                    |
| AI             | AI SDK 6 (`ai`, `@ai-sdk/react`) over Vercel AI Gateway |
| Client state   | SWR                                                  |
| Tests          | Vitest                                              |

---

## Getting started

### Prerequisites

- Node.js 20+
- A Neon Postgres database (provided via the v0 Neon integration)
- The following environment variables (injected by the integration / project settings):
  - `DATABASE_URL` — Neon connection string. Prefer `sslmode=verify-full`; the app normalizes ambiguous `sslmode=require` / `prefer` / `verify-ca` values before passing the URL to `pg`.
  - `BETTER_AUTH_SECRET` — session signing secret (`openssl rand -base64 32`)
  - `BETTER_AUTH_URL` — base URL of the app (optional in dev)
  - `AUTH_SIGNUP_MODE` — `bootstrap` (default), `open`, or `closed`

### Install & run

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

The app is auth-gated. Visit `/sign-in` to create an account (email + password),
then you are redirected into the console shell.

If auth prerequisites are missing, use `/setup` to configure local onboarding from
the UI (writes `.env.local`), then restart the app process.

Enterprise sign-up policy defaults to bootstrap-only: first operator can register,
then sign-up closes automatically unless `AUTH_SIGNUP_MODE=open`.

### Scripts

| Script           | Purpose                                  |
| ---------------- | ---------------------------------------- |
| `pnpm dev`       | Dev server (Turbopack)                   |
| `pnpm build`     | Production build (lint + type-check gate)|
| `pnpm start`     | Run the production build                 |
| `pnpm test`      | Run the Vitest suite                     |
| `pnpm test:watch`| Watch mode                              |

The database schema lives in [`lib/db/schema.ts`](lib/db/schema.ts) and is applied
to Neon through the integration. There is no separate migrate step in this repo.

---

## What's inside (the console)

All application routes live under the authenticated shell at `app/(shell)/`:

| Route            | What it is                                                        |
| ---------------- | ---------------------------------------------------------------- |
| `/`              | Dashboard — register counts and recent activity                  |
| `/goal-console`  | **The core surface.** Classify a goal, run a read/verify loop, convert to a work order, or get a refusal |
| `/work-orders`   | The governed work-order lifecycle (draft → … → closed)           |
| `/governance`    | Authority grants, truth claims, agent claims, conflicts, locks   |
| `/decisions`     | Decision register (ADR-style)                                    |
| `/doctrine`      | Machine-readable operating rules                                 |
| `/memory`        | Durable memory facts with an authority lifecycle                 |
| `/corpus`        | RAG document corpus (embedded chunks)                            |
| `/audit`         | The append-only event + governance-event log                    |
| `/runtime`       | Runtime / system status                                          |
| `/chat`          | AI chat surface                                                  |

Operational probe endpoint:
- `GET /api/health` — machine-readable health for database, auth configuration, and model runtime metadata (`200 ok` / `503 degraded`).
- `GET /api/auth/readiness` — focused auth preflight (`200 ready` / `503 not ready`) used by sign-in/sign-up UX to block misconfigured authentication.
- `POST /api/setup/local-config` — local-only setup writer used by `/setup` to save auth prerequisites for onboarding.
- `GET /api/setup/local-status` — local-only post-restart status check used by `/setup` to confirm readiness handoff.

---

## Core concepts at a glance

- **Lanes (8)** — *what kind* of work a goal is: docs, ui, read_model, write_model, schema, auth, integration, release.
- **Modes (7)** — *how* it proceeds: inspect, plan, draft, implement, verify, review, operate.
- **Authority A0–A9** — *what the actor may do*, from read-only (A0) to release (A9).
- **Verdict** — `allow` · `requires_approval` · `refuse`, derived deterministically.
- **Mistake patterns (MP-001…MP-010)** — recurring failure modes matched *before* work starts.
- **Loop types (6)** — read, verify, plan, evidence, watch, execute. Only `execute` is mutating, and even it is non-mutating in V1 (`EXECUTE_LOOP_V1`).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full model and data flow.

---

## Documentation

| Doc | Purpose |
| --- | ------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System overview, layers, data flow, register map, invariants |
| [`docs/reference/goals.md`](docs/reference/goals.md) | The Goal Console + deterministic classifier |
| [`docs/reference/work-orders.md`](docs/reference/work-orders.md) | The work-order lifecycle and approval gates |
| [`docs/reference/authority.md`](docs/reference/authority.md) | The A0–A9 model and the Authority Grant Registry |
| [`docs/reference/doctrine.md`](docs/reference/doctrine.md) | Doctrine rules and constitutional checks |
| [`docs/reference/audit.md`](docs/reference/audit.md) | Event log, governance events, and the evidence ledger |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | How to develop, test, and ship slices with discipline |
| [`docs/PLAN-RECONCILIATION.md`](docs/PLAN-RECONCILIATION.md) | What shipped vs. the original build plan |

---

## Non-negotiable invariants

These hold across the codebase and are protected by tests in [`tests/`](tests):

1. **Approval is not authority.** A mutating loop or an A2+ transition requires an
   active, unexpired, unrevoked `authority_grant` record — not just an approval flag.
2. **The execute loop never shells out, writes files, or commits.** `EXECUTE_LOOP_V1`
   records planned actions only; any real mutation returns `ESCALATION_NEEDED`.
3. **Classification is deterministic.** The same command always yields the same
   lane / mode / risk / authority / verdict, so every decision is auditable.
4. **Auth fails closed.** Every shell route requires a session; unauthenticated
   requests redirect to `/sign-in`.
5. **Every state change is per-user scoped and logged.** Registers filter by the
   session user id; governance events are append-only with before/after hashes.
