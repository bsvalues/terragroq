# Acceptance Policy

## What v1 means

WilliamOS v1 is a complete local personal brain system with:

- Obsidian vault structure (16+ numbered folders)
- CLI automation (50+ commands)
- Templates and dashboards
- MCP read-only AI guardrails
- Local semantic search
- Weekly synthesis engine
- Inbox processor
- Doctrine, decision, concept, and project/WO promotion engines
- Cortex map generator
- Review cockpit with lane health model
- Git snapshot governance
- Backup governance with archive creation and verification
- Restore drill with proven recovery
- Private remote strategy documentation
- Release governance (this layer)

## What v1 does NOT mean

- v1 does not mean the system is published or shared
- v1 does not mean a remote exists
- v1 does not mean notes have been pushed anywhere
- v1 does not mean the system is feature-complete forever
- v1 does not mean AI has write access
- v1 does not mean automation replaces human judgment

v1 means: the system is validated, snapshotted, and optionally tagged — still private, still local, still yours.

## Acceptance checks

Acceptance runs 20 checks across all operational layers:

### Required (blocking if failed)

1. Vault governance (`check`) — all required dirs and docs exist
2. Git governance status (`git-status`) — repo exists, no forbidden files
3. Forbidden file scan — no secrets, keys, tokens, or credentials in working tree
4. Remote scan — no unexpected Git remotes configured
5. Source note integrity — high-trust folders contain valid notes, no machine-generated markers

### Warning (informational, does not block release)

6. MCP readiness (`mcp-check`)
7. Semantic search status (`semantic-status`)
8. Weekly synthesis status (`synth-status`)
9. Inbox processor status (`inbox-status`)
10. Doctrine promotion status (`doctrine-status`)
11. Decision promotion status (`decision-status`)
12. Concept promotion status (`concept-status`)
13. Project/WO promotion status (`project-status`)
14. Cortex map status (`cortex-status`)
15. Review cockpit status (`cockpit-status`)
16. Backup governance status (`backup-status`)
17. Restore drill status (`restore-status`)
18. Remote protection status (`remote-status`)
19. Orphan notes scan (`orphans`)
20. Stale decisions scan (`stale-decisions`)

## Classification

| Result | Meaning |
|---|---|
| PASS | All required checks pass, no warnings |
| PASS_WITH_WARNINGS | All required checks pass, some warning-level checks flagged |
| FAIL | One or more required checks failed — do not tag |

## Report output

Acceptance reports are written to `reports/Acceptance Review - YYYY-MM-DD.md`.
Acceptance data JSON is written to `data/acceptance-YYYY-MM-DD.json`.

Reports and data are committable and should be included in snapshots.

## Integrity rule

Do not claim v1 acceptance unless checks actually pass. If a required check fails, the system reports FAIL and blocks tagging. There is no override.
