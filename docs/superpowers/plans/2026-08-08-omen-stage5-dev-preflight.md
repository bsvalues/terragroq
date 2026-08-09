# OMEN Stage 5 Development Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed OMEN preflight that proves current TerraFusion and WilliamOS source identity plus advertised Hermes/Atlas capabilities before any disposable cross-node application configuration is attempted.

**Architecture:** A secret-free topology manifest declares repository identities, node aliases, expected container/port metadata, and the WilliamOS database-isolation policy. A PowerShell CLI validates isolated clean source worktrees, binds them to the live remote `main` heads, and collects only bounded Docker/Compose metadata over noninteractive SSH. It never reads databases, service payloads, Forge contents, container environments, credentials, or application data.

**Tech Stack:** PowerShell 7 on OMEN, Git CLI, Windows OpenSSH, JSON, TypeScript/Vitest contract tests.

## Global Constraints

- Start from post-PR-529 `origin/main` commit `e146e2ba7759019b41a474ece7d7b3dc63c13b9c` in branch `codex/omen-stage5-dev-preflight`.
- TerraFusion product source authority is `bsvalues/terrafusion_os_1.0`; reject historical Hermes clones and differently named repositories.
- WilliamOS/control-plane source authority is `bsvalues/terragroq`.
- Require linked, clean worktrees that contain the current remote `main` head; reject normal shared checkouts, dirty worktrees, stale heads, and detached historical sources.
- Hermes probes may inspect Docker container name/image/running/health/published-port metadata only.
- Atlas probes may inspect Docker container metadata and `docker compose ... config --services` for `/home/bs/terrafusion/terrafusion-data.yml` only.
- Do not query Postgres, Redis, Mongo, Ollama HTTP APIs, container environments, application data, credentials, or any Forge path.
- Preserve WilliamOS database isolation: Atlas `tf-postgres` is not WilliamOS `DATABASE_URL`; Mongo is advertised Atlas capacity, not an inferred TerraFusion requirement.
- Do not modify `scripts/lab-control/**`, frozen Stage 1 reports, TerraFusion product source, Hermes, Atlas, or Forge.
- Output contains no absolute local repository paths, secrets, connection strings, environment values, or raw remote stderr.
- Exit `0` only for the exact six-state success contract; all unavailable, stale, dirty, mismatched, malformed, or incomplete evidence exits `2` with a typed reason.

---

### Task 1: Topology contract and fail-closed preflight CLI

**Files:**
- Create: `config/lab-dev-topology.json`
- Create: `scripts/lab-dev/lab-dev-preflight.ps1`
- Create: `scripts/lab-dev/README.md`
- Create: `tests/lab-dev-preflight.test.ts`

**Interfaces:**
- Consumes environment overrides `LAB_DEV_GIT_EXECUTABLE`, `LAB_DEV_SSH_EXECUTABLE`, `LAB_DEV_NOW_UTC`, `TERRAFUSION_REPO_PATH`, and `WILLIAMOS_REPO_PATH` only for executable injection, deterministic tests, and local path selection.
- Produces stable `KEY=VALUE` lines and sets process exit `0` or `2`.
- Produces exactly these green lines:

```text
TERRAFUSION_SOURCE=READY
WILLIAMOS_SOURCE=READY
HERMES_COMPUTE=AVAILABLE
ATLAS_STATE_ENDPOINTS=ADVERTISED
WILLIAMOS_DB_ISOLATION=PRESERVED
PRODUCT_FLOW=READY_FOR_DISPOSABLE_CONFIGURATION_PROOF
```

- [ ] **Step 1: Write failing contract tests**

Create deterministic fake Git and SSH executables and assert:

```ts
expect(runPreflight("healthy")).toMatchObject({
  status: 0,
  stdout: expect.stringContaining("PRODUCT_FLOW=READY_FOR_DISPOSABLE_CONFIGURATION_PROOF"),
})

for (const mode of [
  "wrong-repository",
  "shared-checkout",
  "dirty-source",
  "stale-source",
  "hermes-unreachable",
  "hermes-ollama-missing",
  "atlas-unreachable",
  "atlas-compose-mismatch",
  "database-isolation-missing",
]) {
  expect(runPreflight(mode).status).toBe(2)
}
```

Also decode both remote payloads and assert they contain only Docker/Compose metadata operations and do not contain `psql`, `pg_isready`, `redis-cli`, `mongosh`, `curl`, `Invoke-WebRequest`, `docker exec`, `docker inspect ... Env`, `/forge`, redirection writes, or mutation verbs.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/lab-dev-preflight.test.ts
```

Expected: nonzero because the topology manifest and CLI do not exist.

- [ ] **Step 3: Add the static topology manifest**

Create schema version `1` with these exact authorities:

```json
{
  "schemaVersion": 1,
  "workOrderId": "WO-OMEN-STAGE5-DEV-PREFLIGHT-001",
  "sources": {
    "terrafusion": { "repository": "bsvalues/terrafusion_os_1.0", "branch": "main", "canonicalMarker": "PATH_CANON_REGISTER.md" },
    "williamos": { "repository": "bsvalues/terragroq", "branch": "main", "databaseAuthority": "NEON_SEPARATE" }
  },
  "nodes": {
    "hermes": { "sshAlias": "hermes", "requiredContainers": { "ollama": 11434 }, "advertisedContainers": { "open-webui": 3000, "portainer": 9000 } },
    "atlas-node": { "sshAlias": "atlas", "composeFile": "/home/bs/terrafusion/terrafusion-data.yml", "composeServices": ["mongo", "postgres", "redis"], "advertisedContainers": { "tf-postgres": 5432, "tf-redis": 6379, "tf-mongo": 27017, "portainer_agent": 9001 } }
  },
  "policies": { "williamosUsesAtlasDatabase": false, "databaseQueriesAllowed": false, "forgeInspectionAllowed": false }
}
```

- [ ] **Step 4: Implement minimal source validation**

For each repository, invoke Git with argument arrays and require:

```text
remote identity == configured owner/repository
git-dir != git-common-dir
status --porcelain == empty
branch is named
live refs/heads/main SHA is an ancestor of HEAD
canonical marker exists for TerraFusion
```

Normalize only GitHub SSH and HTTPS remote forms. Never print the local path or raw remote URL.

- [ ] **Step 5: Implement bounded node metadata probes**

Use `BatchMode=yes`, `ConnectTimeout=5`, and `ConnectionAttempts=1`. Encode the Hermes PowerShell and Atlas POSIX payloads. Emit allowlisted `name|image|running|health|publishedPorts` records only. Atlas may additionally emit the sorted Compose service names. Parse locally and compare exact configured names and numeric published ports.

- [ ] **Step 6: Implement isolation and final classification**

Require the WilliamOS README to retain the Neon contract and the local operator runbook to retain the explicit prohibition against pointing WilliamOS `DATABASE_URL` at TerraFusion Postgres. Emit typed per-domain failure values plus one sanitized `BLOCKER=<reason>` line and exit `2` unless every green state is proven.

- [ ] **Step 7: Run focused GREEN and full validation**

Run:

```powershell
pnpm exec vitest run tests/lab-dev-preflight.test.ts
pnpm exec vitest run
git diff --check
```

Expected: focused and full suites pass and the worktree contains only the four reserved Task 1 files plus this plan.

- [ ] **Step 8: Commit Task 1**

```powershell
git add -- config/lab-dev-topology.json scripts/lab-dev/lab-dev-preflight.ps1 scripts/lab-dev/README.md tests/lab-dev-preflight.test.ts
git commit -m "feat(lab): add Stage 5 development preflight"
```

---

### Task 2: Live proof and operator evidence

**Files:**
- Create: `docs/runbooks/omen-stage5-dev-flow.md`
- Create: `docs/reports/WO-OMEN-STAGE5-DEV-PREFLIGHT-001.md`

**Interfaces:**
- Consumes Task 1 CLI and exact live proof.
- Produces a separate Stage 5 evidence record; it does not append to or modify PR #529 or frozen Stage 1 files.

- [ ] **Step 1: Prepare isolated current-source worktrees**

Create or select clean linked worktrees for `bsvalues/terrafusion_os_1.0` and `bsvalues/terragroq` that contain each live `origin/main`. Do not edit TerraFusion source. Stop if either remote identity or worktree cleanliness check fails.

- [ ] **Step 2: Run the live preflight**

Run the CLI with the isolated source paths. Capture only the six stable state lines, exit code, repository commit IDs, and sanitized blocker detail. Do not capture raw SSH output or environment values.

- [ ] **Step 3: Write the runbook and report**

Document the canonical source repositories, `atlas-node` versus `atlas-suite` naming boundary, advertised endpoints, WilliamOS database isolation, forbidden evidence reads, disposable-proof next step, exact commits, validation counts, and live output. The report must not claim TerraFusion/WilliamOS is already configured against Hermes or Atlas.

- [ ] **Step 4: Validate and commit Task 2**

```powershell
pnpm exec vitest run tests/lab-dev-preflight.test.ts
git diff --check
git add -- docs/runbooks/omen-stage5-dev-flow.md docs/reports/WO-OMEN-STAGE5-DEV-PREFLIGHT-001.md docs/superpowers/plans/2026-08-08-omen-stage5-dev-preflight.md
git commit -m "docs(lab): record Stage 5 development preflight"
```

---

### Task 3: Independent review and GitHub lifecycle

**Files:**
- Review only: all Task 1-2 paths

- [ ] **Step 1: Independent assurance**

Require a non-builder to review repository identity binding, worktree isolation, secret redaction, exact SSH payloads, prohibited-query absence, WilliamOS database isolation, failure coverage, and live output. Return every actionable finding to the original builder.

- [ ] **Step 2: Push and open a separate PR**

After review is clean, push `codex/omen-stage5-dev-preflight`, open a new PR against `main`, attach exact validation/live evidence, and keep the worktree for review remediation. Do not merge without current-head checks and resolved review threads.
