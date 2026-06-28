---
type: validation-gates
version_target: v1.3.0
generated: 2026-06-24
tags:
  - devkit
  - validation
  - gates
---

# WilliamOS Validation Gates — v1.3.0

This document defines every gate that must pass before a release or significant
change is accepted. Gates are ordered from fastest to most comprehensive.

All commands run from the repo root unless noted.

---

## Gate 1 — Frontend Build

**What it checks:** React frontend compiles cleanly.
**Required for:** Any change to frontend source, any release candidate.

```bash
cd control-center/frontend && npm run build
```

**Pass condition:** Build exits with code 0 and `dist/` is populated.
**Fail action:** Fix TypeScript/build errors before proceeding.

---

## Gate 2 — Backend Tests

**What it checks:** All Python unit and integration tests pass.
**Required for:** Any change to backend Python, any release candidate.

```bash
python -m pytest control-center/backend/tests -q
```

**Pass condition:** All tests pass. Current baseline: **206/206**.
**Fail action:** Do not proceed. Fix failing tests before any other gate.

For verbose output:
```bash
python -m pytest control-center/backend/tests -v
```

For a specific test file:
```bash
python -m pytest control-center/backend/tests/test_tools.py -v
python -m pytest control-center/backend/tests/test_loop.py -v
```

---

## Gate 3 — Control-Center Smoke

**What it checks:** All defined smoke test scenarios pass against the running Control Center.
**Required for:** Any backend or frontend change, any release candidate.

```bash
python scripts/william.py control-center-smoke
```

**Pass condition:** 22/22 PASS.
**Note:** The Control Center must be running before this gate runs.
**Fail action:** Check which scenarios fail. Look for backend errors in the server terminal.

---

## Gate 4 — Runtime Smoke

**What it checks:** All 28 WilliamOS runtime checks pass with zero critical failures.
**Required for:** Any system-level change, any release candidate.

```bash
python scripts/william.py runtime-smoke
```

**Pass condition:** 0 critical failures. Non-critical warnings are allowed.
**Current baseline:** 28/28 checks, 0 critical.
**Fail action:** Critical failures must be resolved. Warnings may be deferred with documented justification.

---

## Gate 5 — Production Readiness

**What it checks:** All 10 production readiness criteria pass.
**Required for:** Release acceptance, any commit claiming production status.

```bash
python scripts/william.py production-readiness
```

**Pass condition:** 10/10 PASS.

The 10 checks are:

| Check | Description |
|-------|-------------|
| global-governance | `william.py check` passes |
| runtime-smoke | Runtime smoke, 0 critical |
| control-center-smoke | Control Center smoke 22/22 including DevOps playbook endpoints |
| restore-proof | Restore drill proof exists and is HIGH confidence |
| schema-check | All schemas valid, all templates present |
| command-registry | CLI commands match registry (92/92) |
| backup-archive | At least 1 backup archive present |
| git-safety | No remote, local-only |
| required-docs | Required governance docs present |
| no-forbidden-files | No forbidden file patterns |

**Fail action:** Any FAIL is a hard blocker. Do not tag or release.

**Ollama/model note:** The `global-governance` check may emit a model-offline warning.
This warning does not fail production-readiness when the backend decouples it from
the binary gate. A release candidate may be accepted with Ollama offline if the
release acceptance explicitly notes "model-health: INFORMATIONAL, skipped."

---

## Gate 6 — Acceptance Review

**What it checks:** All 20 acceptance criteria pass across all operational layers.
**Required for:** Any release candidate claiming v1.x acceptance.

```bash
python scripts/william.py acceptance
```

**Pass condition:** 20/20 PASS. Report saved to
`WilliamOS/95_ReleaseGovernance/reports/Acceptance Review - <date>.md`.

For status only:
```bash
python scripts/william.py release-status
```

---

## Gate 7 — Clean Tree Gate

**What it checks:** Working tree has no uncommitted changes in relevant paths.
**Required for:** v1.3.0 tag creation.

```bash
git status --short
```

**Pass condition:** No modified or untracked files exist in paths that belong
to the release. Operational files (daily notes, reports, smoke data) may be
dirty without blocking the tag if they are not part of the release scope.

**Release rule:**
> No tag may be created from a dirty tree unless Bill explicitly authorizes
> tagging with a documented scope exclusion.

---

## Release Acceptance Criteria (Tag Gate)

All of the following must be true before running `python scripts/william.py release-tag`:

```
[ ] Frontend build: PASS
[ ] Backend tests: all pass (206+ expected)
[ ] Control-center smoke: 22/22
[ ] Runtime smoke: 0 critical
[ ] Production readiness: 10/10 PASS
[ ] Acceptance review: 20/20 PASS
[ ] Working tree: clean in release scope
[ ] Phase 6: confirmed BLOCKED
[ ] No external worker write authority added
[ ] Release notes: prepared (see 90_RELEASE_AND_TAG_PLAYBOOK.md)
[ ] devkit-manifest.json: updated with correct version
```

**Release rule:**
> No production release may be claimed if production-readiness is not 10/10.
> Model-dependent acceptance (Ollama online, live model smoke) must explicitly
> state whether it was run or skipped, and why.

---

## Quick Reference

```bash
# Build
cd control-center/frontend && npm run build && cd ../..

# Tests
python -m pytest control-center/backend/tests -q

# Smoke
python scripts/william.py control-center-smoke
python scripts/william.py runtime-smoke

# Full gate
python scripts/william.py production-readiness

# Acceptance
python scripts/william.py acceptance

# Pre-tag check
git status --short
git tag -l v1.3.0
```
