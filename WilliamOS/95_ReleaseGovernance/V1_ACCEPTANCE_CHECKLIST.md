# v1 Acceptance Checklist

## Required Checks (blocking)

- [ ] `python scripts/william.py check` — vault governance passes
- [ ] `python scripts/william.py git-status` — Git repo exists, no forbidden files
- [ ] Forbidden file scan — no .env, .pem, .key, tokens, secrets, credentials
- [ ] Remote scan — `git remote -v` returns empty
- [ ] Source note integrity — high-trust folders (02_Decisions, 03_Doctrine, 10_Ideas, 11_Projects) contain valid frontmatter notes, no auto-generated markers

## Warning Checks (informational)

- [ ] `python scripts/william.py mcp-check` — MCP guardrails configured
- [ ] `python scripts/william.py semantic-status` — search engine state
- [ ] `python scripts/william.py synth-status` — synthesis engine state
- [ ] `python scripts/william.py inbox-status` — inbox processor state
- [ ] `python scripts/william.py doctrine-status` — doctrine promotion state
- [ ] `python scripts/william.py decision-status` — decision promotion state
- [ ] `python scripts/william.py concept-status` — concept promotion state
- [ ] `python scripts/william.py project-status` — project/WO promotion state
- [ ] `python scripts/william.py cortex-status` — cortex map state
- [ ] `python scripts/william.py cockpit-status` — review cockpit state
- [ ] `python scripts/william.py backup-status` — backup governance state
- [ ] `python scripts/william.py restore-status` — restore drill state
- [ ] `python scripts/william.py remote-status` — remote protection state
- [ ] `python scripts/william.py orphans` — unlinked notes count
- [ ] `python scripts/william.py stale-decisions` — overdue decision reviews

## Run sequence

```bash
# Dry run first
python scripts/william.py acceptance --dry-run

# If dry run passes, generate full report
python scripts/william.py acceptance

# Generate release manifest
python scripts/william.py release-manifest

# Preview tag
python scripts/william.py release-tag --name v1.0.0 --dry-run

# Create tag (only if acceptance passed)
python scripts/william.py release-tag --name v1.0.0
```

## Pass criteria

| Outcome | Action |
|---|---|
| All 5 required checks pass | May proceed to tag |
| Required pass, some warnings | May proceed — warnings are informational |
| Any required check fails | Do NOT tag — resolve failures first |

## High-trust folder rule

These folders must not be modified by automation:

- `WilliamOS/02_Decisions/`
- `WilliamOS/03_Doctrine/`
- `WilliamOS/10_Ideas/`
- `WilliamOS/11_Projects/`

The integrity check verifies these contain only user-created notes with valid frontmatter.
