# SWEEP LEDGER — live phase-by-phase status

Updated each loop pass. Status: ✅ green · 🔧 fixing · ❌ gap · ⬜ unchecked

| # | Phase | Verify command | Status | Notes |
|---|-------|----------------|--------|-------|
| — | Global governance | `check` | ⬜ | baseline PASS |
| 40 | Semantic search | `sem-status` | ⬜ | |
| 60 | Synthesis | `synth-status` | ⬜ | |
| 70 | Inbox processor | `inbox-status` | ⬜ | |
| 80 | Doctrine promotion | `doctrine-status` | ⬜ | |
| 85 | Decision promotion | `decision-status` | ⬜ | |
| 86 | Concept promotion | `concept-status` | ⬜ | |
| 87 | Project promotion | `project-status` | ⬜ | |
| 88 | Cortex map | `cortex-status` | ⬜ | |
| 89 | Review cockpit | `cockpit-status` | ⬜ | |
| 91 | Git governance | `git-status` | ⬜ | |
| 92 | Backup governance | `backup-status` | ⬜ | |
| 93 | Restore drill | `restore-status` | ⬜ | |
| 94 | Private remote | `remote-status` | ⬜ | |
| 95 | Release governance | `release-status` | ⬜ | |
| 96 | Operating routine | `routine-status` | ⬜ | |
| 97 | Human review queues | `review-status` | ⬜ | |
| 98 | Official acceptance | `accept-status` | ⬜ | |
| 99 | Post-acceptance closure | `closure-status` | ⬜ | |
| 100 | Maintenance release | `maintenance-status` | ⬜ | |
| 101 | External drive backup | `drive-backup-status` | ⬜ | |
| 102 | Obsidian workspace | `obsidian-status` | ⬜ | |
| 103 | Schema registry | `schema-status` | ⬜ | |
| 104 | Command registry | `command-status` | ❌ | registry=86 vs cli=91 drift |
| 105 | Runtime smoke | `runtime-status` | ⬜ | baseline 28/28 |
| 106 | Production readiness | `production-status` | ❌ | 7/9: cmd-registry + forbidden file |
| 110 | Control center | `cockpit --dry-run` | ⬜ | |

## Gate status

- [x] check PASS
- [x] runtime-smoke 0 critical (28/28)
- [x] production-readiness 9/9 PASS
- [x] all per-phase status green (run clean)
- [x] committed (24026e4, 1d1dd39) — working tree clean

## Root causes fixed this sweep

1. **Empty venv** — `requirements.txt` deps (incl. `python-frontmatter`) were never
   installed. Broke 7 status commands (synth/inbox/doctrine/decision/concept/project/cortex).
   Fix: `pip install -r requirements.txt`.
2. **Missing `tzdata`** — Windows has no system tz DB; zoneinfo failed → cockpit-status crash.
   Fix: installed + added `tzdata` to requirements.txt.
3. **command-registry drift** (86→91) — 5 `control-center*` commands unregistered.
   Fix: added a `control` group to `williamos_commands.py`. Now 91=91 match.
4. **forbidden-file false positive** — readiness scan rglob'd `.venv`, caught certifi's
   bundled `cacert.pem`. Fix: scoped scan to skip `.venv`/`.git`/site-packages/etc.

## Not gaps (governance-gated, left for human review)

- 14 pending review-queue items / 9 promotion drafts — require manual approval per governance.
- Semantic search "unavailable" — optional `requirements-search.txt` (heavy ML deps), not in the 9-point gate.

## Loop log

- 2026-06-19 baseline: production-readiness 7/9 FAIL. 2 known gaps. Loop started.
- 2026-06-19 pass 1: installed deps, fixed registry + forbidden-file scope. ALL 3 gates PASS, all phases green. Committing.
