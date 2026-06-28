---
type: command-report
status: draft
generated: "2026-06-19 09:34:17"
tags:
  - commands
  - generated
---

# Command Report - 2026-06-19

## Summary

- Registry commands: 91
- CLI commands (argparse): 91
- Match: YES
- Groups: 13
- Safe commands: 89
- Write commands: 53

## Create new notes (create)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `init` | Initialize vault scaffold | yes | yes |
| `today` | Create today's daily note | yes | yes |
| `weekly` | Create this week's review note | yes | yes |
| `inbox` | Capture a quick thought | yes | yes |
| `decision` | Create a decision record | yes | yes |
| `doctrine` | Create a doctrine note | yes | yes |
| `concept` | Create a concept note | yes | yes |
| `case` | Create a case analysis note | yes | yes |

## Governance and health checks (check)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `check` | Run vault governance checks | yes | — |
| `mcp-check` | Check MCP readiness | yes | — |
| `orphans` | Find unlinked notes | yes | — |
| `stale-decisions` | Find decisions past review date | yes | — |

## Search and graph (search)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `graph` | Run Graphify on vault | yes | yes |
| `semantic-index` | Build semantic search index | yes | yes |
| `semantic-search` | Search the vault semantically | yes | — |
| `semantic-status` | Show semantic search status | yes | — |
| `semantic-clear` | Delete search index | NO | yes |

## Weekly synthesis (synthesis)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `synth-week` | Generate weekly synthesis | yes | yes |
| `synth-status` | Show weekly synthesis status | yes | — |

## Promote inbox and source notes into official knowledge (promotion)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `inbox-status` | Show inbox processor status | yes | — |
| `process-inbox` | Process inbox notes | yes | yes |
| `doctrine-status` | Show doctrine promotion status | yes | — |
| `promote-doctrine` | Promote doctrine candidates | yes | yes |
| `decision-status` | Show decision promotion status | yes | — |
| `promote-decisions` | Promote decision candidates | yes | yes |
| `concept-status` | Show concept promotion status | yes | — |
| `promote-concepts` | Promote concept candidates | yes | yes |
| `project-status` | Show project/WO promotion status | yes | — |
| `promote-projects` | Promote project/WO candidates | yes | yes |

## Knowledge graph and cockpit (cortex)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `cortex-status` | Show cortex map status | yes | — |
| `cortex-map` | Generate cortex map | yes | yes |
| `cockpit-status` | Show review cockpit status | yes | — |
| `cockpit` | Generate review cockpit dashboard | yes | yes |

## Git snapshot governance (git)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `git-status` | Show Git repo status and safety checks | yes | — |
| `git-init` | Initialize Git repository (no remote) | yes | yes |
| `snapshot` | Create a Git snapshot | yes | yes |
| `snapshot-manifest` | Generate snapshot manifest | yes | yes |

## Backup, restore, and remote strategy (backup)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `backup-status` | Show backup readiness | yes | — |
| `backup` | Create a backup archive | yes | yes |
| `backup-manifest` | Generate/update backup manifest | yes | yes |
| `backup-verify` | Verify a backup archive | yes | — |
| `restore-status` | Show restore drill readiness | yes | — |
| `restore-drill` | Run a restore drill | yes | yes |
| `restore-runtime-proof` | Run full runtime proof against restored backup | yes | yes |
| `restore-manifest` | Generate/update restore manifest | yes | yes |
| `remote-status` | Show remote protection status | yes | — |
| `remote-strategy` | Generate remote strategy manifest | yes | yes |
| `remote-readiness` | Check readiness for remote protection | yes | — |
| `drive-backup-status` | Show external drive backup status | yes | — |
| `drive-backup-plan` | Generate drive backup plan | yes | yes |
| `drive-backup` | Run backup to external drive | yes | yes |
| `drive-backup-log` | Show external drive backup log | yes | — |

## Release governance and maintenance (release)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `release-status` | Show release governance status | yes | — |
| `acceptance` | Run v1 acceptance review | yes | yes |
| `release-manifest` | Generate/update release manifest | yes | yes |
| `release-tag` | Create a local release tag | yes | yes |
| `maintenance-status` | Show maintenance release status | yes | — |
| `maintenance-review` | Run maintenance review checks | yes | yes |
| `maintenance-manifest` | Generate maintenance manifest | yes | yes |
| `maintenance-tag` | Create maintenance release tag | yes | yes |

## Operating routine and reviews (routine)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `routine-status` | Show operating routine status | yes | — |
| `daily-review` | Generate daily review note | yes | yes |
| `weekly-review` | Generate weekly operating review | yes | yes |
| `monthly-review` | Generate monthly cortex review | yes | yes |
| `review-status` | Show human review queue status | yes | — |
| `review-queues` | Generate review queue report | yes | yes |
| `acceptance-checklist` | Generate acceptance checklist | yes | yes |

## Official acceptance workflow (acceptance)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `accept-status` | Show acceptance assistant status | yes | — |
| `accept-plan` | Generate acceptance plan | yes | yes |
| `accept-draft` | Accept a draft into official folder | NO | yes |
| `accept-log` | Show acceptance log | yes | — |
| `closure-status` | Show post-acceptance closure status | yes | — |
| `post-acceptance` | Generate closure report | yes | yes |
| `post-acceptance-checklist` | Generate closure checklist | yes | yes |

## Workspace quality, schema registry, and command registry (workspace)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `obsidian-status` | Show workspace quality status | yes | — |
| `obsidian-quality` | Generate workspace quality report | yes | yes |
| `schema-status` | Show schema registry status | yes | — |
| `schema-check` | Validate schemas and templates | yes | — |
| `schema-report` | Generate schema report | yes | yes |
| `help-all` | Show all commands grouped | yes | — |
| `command-status` | Show command registry status | yes | — |
| `command-report` | Generate command report | yes | yes |
| `runtime-status` | Show runtime smoke status | yes | — |
| `runtime-smoke` | Run runtime smoke suite | yes | yes |
| `production-status` | Show production readiness status | yes | — |
| `production-readiness` | Run full production readiness gate | yes | yes |

## Control Center cockpit and runtime (control)

| Command | Purpose | Safe | Writes |
|---------|---------|------|--------|
| `control-center` | Launch the Control Center cockpit | yes | yes |
| `control-center-stop` | Stop the Control Center | yes | yes |
| `control-center-status` | Show Control Center status | yes | — |
| `control-center-build` | Build frontend production bundle | yes | yes |
| `control-center-smoke` | Run Control Center smoke tests | yes | — |

## Generator Notes

This report was generated by WilliamOS. No notes were modified.
