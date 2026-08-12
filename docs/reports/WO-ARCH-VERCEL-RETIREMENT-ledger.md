# WO-ARCH-VERCEL-RETIREMENT — Vercel dependency ledger (#638)

Live-call-path ledger of every Vercel dependency on `main`, classified, with the remediation
owner for each. Establishes the before-state for the retirement. No behavior changed by this
document.

## How Vercel is still attached (summary)

Removing the code footprint (`@vercel/otel`, `public/vercel.svg` in #639) did **not** stop
Vercel, because the live dependency is not primarily code:

1. **Git integration (the deploy + PR check).** The Vercel project `terragroq`
   (`prj_t6fZUvSKM1pR95YqXAOKmncPaMhP`, team `terrafusion`) is connected to
   `bsvalues/terragroq` via the Vercel GitHub App. Vercel auto-builds **every** push —
   `main` → production, every branch/PR → preview — and posts the "Vercel" / "Vercel Preview
   Comments" checks. Evidence: the last 20 deployments are all `githubDeployment: "1"` with
   `githubPrId`/`githubCommitRef` set; project holds `terragroq.vercel.app` +
   `terragroq-git-main-terrafusion.vercel.app` domains. **This is a dashboard/admin setting,
   not repo code.**
2. **AI runtime routes through the Vercel AI Gateway to external OpenAI** (`lib/ai/config.ts`).
3. **Governance tooling requires the Vercel checks** (`ci-review-ingestion.mjs`) and
   post-merge verification hits `https://terragroq.vercel.app/...`.
4. **Auth origin logic falls back to `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL`**
   (`lib/auth-origins.ts`).

## Ledger

| # | Location | Call path | Classification | Owner |
|---|---|---|---|---|
| 1 | Vercel project ↔ repo Git integration | GitHub App → auto-deploy every push + PR "Vercel"/"Vercel Preview Comments" checks | ACTIVE_DEPLOYMENT + preview/check | **OWNER (dashboard)** |
| 2 | `lib/ai/config.ts` | `CHAT_MODEL=openai/gpt-5-mini`, `EMBEDDING_MODEL=openai/text-embedding-3-small`, `gateway:"vercel-ai-gateway"` → consumed by `lib/ai/runtime.ts`, `app/api/chat/route.ts`, `components/shell/app-shell.tsx` | ACTIVE_AI_PROVIDER_PATH | Repo (Claude/Codex) |
| 3 | `scripts/multi-agent-operator/ci-review-ingestion.mjs` | `checkContexts` marks `Vercel` + `Vercel Preview Comments` `required:true`; `validateChecks` walls unless the set `{CodeRabbit, Vercel, Vercel Preview Comments}` is present | CI_CHECK_ONLY | Repo |
| 4 | `post-merge-verification-cleanup.mjs`, `merge-verify-clean-fanin-release.mjs` | Health checks hardcode `https://terragroq.vercel.app/api/health`, `/operator`, `/goal-console`, `/api/auth/readiness` | ACTIVE_DEPLOYMENT reference | Repo |
| 5 | `lib/auth-origins.ts` | `resolveAuthBaseUrl()` fallback chain: `BETTER_AUTH_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → `V0_RUNTIME_URL`; same as trusted-origin sources | ACTIVE env/origin (fallback only) | Repo |
| 6 | `docs/devkit/evidence/*`, `docs/academy/*` | "Canonical production URL: `https://terragroq.vercel.app`"; "Vercel setting changes require authority" | DOC_ONLY | Repo (docs) |
| 7 | `runtime-operator/policy.mjs`, `prompt.mjs`, `hermes-bridge/cli.mjs` | Guard regexes forbidding "Vercel setting" / `vercel.json` mutation | KEEP (protective guard, not a dependency) | — |

Note: `next.config.ts` is already `output: "standalone"` (self-host), and there is no
`vercel.json` / `.vercel` / `.vercelignore` in the repo. Hosting config is not the blocker;
the Git integration (row 1) is.

## Supabase audit (#638 item 9)

- Repository code/config/package manifests: **0** matches for `supabase`/`SUPABASE`.
- Environment variable names: no `SUPABASE_*` referenced anywhere.
- Deployment/infra docs: none.
- Runtime: DB is Postgres via `pg`/Drizzle; auth is `better-auth`. No Supabase client/SDK.

**Verdict: `SUPABASE_NOT_PRESENT`.** (Repo/config/env/docs evidence. A private external
Supabase account cannot be disproven from the repo, but there is zero code or runtime evidence
of one.)

## Remediation sequence

Repo-side (reviewable PRs on AEGIS; preserves the AEGIS offload):

- **R1 — AI provider path (row 2):** replace the Vercel-AI-Gateway + external-OpenAI defaults
  with the approved local-first path (Hermes/Ollama/local provider contract), no silent
  external fallback; verify embeddings do not require `openai/text-embedding-3-small`
  (re-index under a separate bounded data step if needed).
- **R2 — CI required checks (row 3):** drop `Vercel` + `Vercel Preview Comments` from the
  required set so routine PRs no longer wait on / report Vercel (update associated tests).
- **R3 — Post-merge verification URLs (row 4):** point health checks at the intended host or
  mark explicitly local-only; no invented cloud dependency.
- **R4 — Auth origin (row 5):** drop `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` from the
  active path (retain only behind an explicit legacy/test boundary if needed); auth base is
  `BETTER_AUTH_URL`.
- **R5 — Docs (row 6):** correct the "canonical production URL" references.

Owner-only:

- **R0 — Disconnect the Vercel Git integration (row 1).** This is the actual kill switch for
  the PR deploys/checks and cannot be done from code or the available Vercel API tools.
  Vercel → project **terragroq** → **Settings → Git → Disconnect**, or GitHub → repo
  **Settings → GitHub Apps → Vercel → Configure → remove `bsvalues/terragroq`**. Best done
  after R1–R2 so nothing depends on it.

## Acceptance mapping (#638)

`SUPABASE_NOT_PRESENT` recorded here; remaining acceptance items are delivered by R0–R5 with
before/after call-path evidence per PR.
