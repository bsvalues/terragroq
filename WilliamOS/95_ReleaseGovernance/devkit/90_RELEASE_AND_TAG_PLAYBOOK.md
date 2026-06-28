---
type: release-playbook
version_target: v1.3.0
generated: 2026-06-24
tags:
  - devkit
  - release
  - tag
  - governance
---

# Release and Tag Playbook — v1.3.0

## Release Governance Hold

As of 2026-06-24, v1.3.0 is in a governance hold. The hold exists because:

1. The working tree is dirty (operational files modified since last commit).
2. The daily note disposition has not been confirmed.

The hold does not indicate a quality problem. Phase 5A–5D are accepted and gates
are green. The hold is a procedural gate — clean tree required before tag.

**To release v1.3.0, work through this playbook in order. Do not skip steps.**

---

## Step 1 — Resolve Working Tree

Determine which dirty files belong to the release and which are operational:

```bash
git status --short
```

**Operational files (may be stale-committed or excluded from release):**
- `WilliamOS/01_Daily/` — daily notes
- `WilliamOS/00_Inbox/` — inbox notes
- `WilliamOS/105_RuntimeSmoke/`, `WilliamOS/106_ProductionReadiness/` — generated reports
- `WilliamOS/96_OperatingRoutine/` — routine notes

**Code/governance files (must be committed before release):**
- `WilliamOS/95_ReleaseGovernance/devkit/` — this Dev Kit
- Any future release-scoped code file explicitly authorized by Bill

**Resolution options for operational dirty files:**
1. Commit them as-is with a descriptive message (e.g., `chore(vault): update operational records`)
2. Commit only the release-relevant files and leave operational files for a follow-up commit

**Rule:** Do not tag from a dirty tree. Make a decision on every dirty file
before creating the tag.

---

## Step 2 — Commit Dev Kit and Any Release-Scoped Files

For this work order, commit only the Dev Kit files:

```bash
# Stage only the Dev Kit files
git add WilliamOS/95_ReleaseGovernance/devkit/

# Verify scope before committing
git diff --stat --cached

# Commit
git commit -m "docs(devkit): add WilliamOS v1.3.0 production playbook"
```

If future release-scoped code files exist, they must be handled in a separate
explicitly authorized commit. Do not mix feature code into the Dev Kit commit.

---

## Step 3 — Rerun Gates After All Commits

After all commits are made and before the tag:

```bash
python scripts/william.py runtime-smoke
python scripts/william.py production-readiness
```

Expected results:
- Runtime smoke: 28/28, 0 critical
- Production readiness: 10/10 PASS

If any gate fails, fix the failure before continuing.

---

## Step 4 — Confirm Clean Tree

```bash
git status --short
```

Expected output: empty (no modified or untracked files in release scope).

If there are remaining dirty files, do not tag. Resolve every modified and
untracked file first by committing, explicitly excluding through an approved
workflow, or stopping for Bill's decision. The release tag requires a completely
clean working tree, including operational notes and generated reports.

---

## Step 5 — Prepare Release Notes

Create a release notes document:
```
WilliamOS/95_ReleaseGovernance/reports/Release Notes - v1.3.0.md
```

Minimum contents:
- Version: v1.3.0
- Date
- Phases included (1, 2, 3, 4, 4.5, 5A, 5B, 5C, 5D)
- Key capabilities added since v1.2.0
- Gate results (tests, smoke, production-readiness)
- Model-health note (whether live model gate was run or skipped, and why)
- Phase 6 status: BLOCKED
- Known open items (daily note disposition, dirty operational files, etc.)
- Acceptance report reference

---

## Step 6 — Update Dev Kit Manifest

Update `devkit-manifest.json` to confirm the release is ready:

```json
{
  "version_target": "v1.3.0",
  "release_ready": true,
  "release_notes": "WilliamOS/95_ReleaseGovernance/reports/Release Notes - v1.3.0.md"
}
```

Commit the manifest update:
```bash
git add WilliamOS/95_ReleaseGovernance/devkit/devkit-manifest.json
git commit -m "chore(release): mark v1.3.0 release ready in devkit manifest"
```

---

## Step 7 — Tag Dry Run

Verify the tag does not already exist:

```bash
git tag -l v1.3.0
```

Expected output: empty (tag not yet created).

---

## Step 8 — Create the Tag

```bash
# Option A: WilliamOS governed tag (recommended)
python scripts/william.py release-tag

# Option B: Direct git tag (only if governed tag has a problem)
git tag -a v1.3.0 -m "WilliamOS v1.3.0 — Phases 1-5D complete, Phase 6 blocked"
```

**Rule:** Never create the tag from a dirty tree. Run `git status --short` and
confirm it is empty immediately before tagging.

---

## Step 9 — Post-Tag Verification

```bash
# Confirm tag exists
git tag -l v1.3.0

# Confirm tag points to the right commit
git log -1 v1.3.0 --oneline

# Rerun production readiness post-tag
python scripts/william.py production-readiness
```

Expected: 10/10 PASS, tag present at the current HEAD.

---

## Step 10 — Update Release Manifest

```bash
python scripts/william.py release-manifest
```

The manifest now records v1.3.0 as the latest tag.

---

## Post-Release: What Comes Next

After the v1.3.0 tag, resume normal operating routine. Do not immediately
begin Phase 6 or any new feature work without explicit operator decision.

**Recommended post-release sequence:**
1. Resume daily operating routine.
2. Decide on daily note disposition (commit, exclude, or archive).
3. Plan next increment: Phase 5E (post-5D hardening), containerization,
   PWA/Tauri packaging, or Phase 6 (only with explicit authorization).

**Phase 6 remains blocked until Bill explicitly says "Begin Phase 6."**

---

## Tag Rules (Summary)

```
NEVER tag from a dirty tree.
NEVER tag if production-readiness is not 10/10.
NEVER tag if any gate is red.
NEVER tag if Phase 6 is enabled (it must remain BLOCKED at tag time).
ALWAYS document whether live model gate was run or skipped.
ALWAYS prepare release notes before tagging.
```

---

## Quick Reference

```bash
# Pre-tag checks
git status --short
git tag -l v1.3.0
python scripts/william.py runtime-smoke
python scripts/william.py production-readiness

# Create tag (governed)
python scripts/william.py release-tag

# Post-tag verification
git tag -l v1.3.0
git log -1 v1.3.0 --oneline
python scripts/william.py release-manifest
```
