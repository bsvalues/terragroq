# Package Manifest

## Root files

- `README.md` — package overview and quick start
- `PACKAGE_MANIFEST.md` — this file
- `requirements.txt` — Python dependencies
- `requirements-search.txt` — optional search dependencies (sentence-transformers, numpy, scikit-learn)
- `justfile` — command shortcuts
- `.gitignore` — safe defaults
- `WilliamOS_Command_Center.html` — standalone HTML overview

## Vault

- `WilliamOS/` — Obsidian vault scaffold
- `WilliamOS/00_Inbox/` — fast capture
- `WilliamOS/01_Daily/` — daily command notes and weekly reviews
- `WilliamOS/02_Decisions/` — decision records
- `WilliamOS/03_Doctrine/` — seed doctrine notes
- `WilliamOS/04_Appraisal/` — appraisal methodology
- `WilliamOS/05_Assessor_Office/` — assessor leadership
- `WilliamOS/06_TerraFusion_Strategy/` — personal strategy notes
- `WilliamOS/07_Learning/` — learning notes
- `WilliamOS/08_People/` — people notes
- `WilliamOS/09_Cases/` — case analysis
- `WilliamOS/10_Ideas/` — concepts and ideas
- `WilliamOS/11_Projects/` — project notes
- `WilliamOS/12_Maps/` — canvas/diagram thinking
- `WilliamOS/00_Inbox/README.md` through `WilliamOS/12_Maps/README.md` — folder READMEs (13 total)
- `WilliamOS/13_Templates/` — note templates (12 templates)
- `WilliamOS/20_Graphify/` — graph review and generated output
- `WilliamOS/30_MCP/` — MCP policy, AI access rules, setup docs, and example configs
- `WilliamOS/40_Scripts/` — vault-internal scripts
- `WilliamOS/50_Dashboards/` — MOC dashboards and index notes
- `WilliamOS/60_Synthesis/` — weekly synthesis engine docs and generated reviews
- `WilliamOS/90_Exports/` — AI summaries and export output
- `WilliamOS/99_Archive/` — cold storage

## Templates (13_Templates/)

- Daily Command.md
- Weekly Review.md
- Decision Record.md
- Doctrine.md
- Concept Note.md
- Case Analysis.md
- Person.md
- Meeting Note.md
- Project Note.md
- Learning Note.md
- Source Note.md
- Work Order Seed.md

## Dashboards (50_Dashboards/)

- MOC - WilliamOS Home.md
- MOC - Assessor.md
- MOC - Appraisal.md
- MOC - TerraFusion Strategy.md
- MOC - Public Trust.md
- MOC - Learning Code and AI.md
- Decision Log.md
- Open Loops.md
- Question Bank.md
- Weekly Review.md
- Human Review Queue.md
- Governance Overview.md
- Promotion Pipeline.md
- Cortex and Graph.md

## MCP layer (30_MCP/)

- README.md — overview and file index
- AI_ACCESS_RULES.md — what AI can and cannot do
- MCP_WRITE_POLICY.md — write zones and restrictions (not yet enabled)
- READ_ONLY_SCOPE_POLICY.md — what files AI can read
- SAFE_AI_PROMPTS.md — reusable prompt templates
- MCP_SETUP.md — configuration options (filesystem, REST API, custom)
- CLAUDE_DESKTOP_EXAMPLE.md — Claude Desktop MCP config example
- AI_QUERY_EXAMPLES.md — example questions for AI
- examples/claude_desktop_config.example.json
- examples/filesystem_readonly_server.example.json

## Synthesis layer (60_Synthesis/)

- README.md — overview and file index
- WEEKLY_SYNTHESIS_POLICY.md — source scope and detection rules
- WEEKLY_SYNTHESIS_TEMPLATE.md — output format reference
- QUERY_STRATEGY.md — how the synthesizer finds and ranks signals
- Weekly Synthesis - YYYY-Www.md — generated weekly reviews (committable)

## Search layer (40_Search/)

- README.md — overview and file index
- SEARCH_POLICY.md — what gets indexed, what doesn't
- SEMANTIC_SEARCH_SETUP.md — installation and setup guide
- QUERY_EXAMPLES.md — example queries with explanations
- generated/ — auto-generated index files (git-ignored)

## Inbox Processor layer (70_InboxProcessor/)

- README.md — overview and file index
- INBOX_PROCESSING_POLICY.md — source scope, processing rules, confidence tiers
- CLASSIFICATION_RULES.md — 12 category definitions with signal patterns
- PROMOTION_WORKFLOW.md — promoted draft format and human review workflow
- reports/ — generated triage reports (committable)
- promoted_drafts/ — generated draft notes for human review (committable)

## Doctrine Promotion layer (80_DoctrinePromotion/)

- README.md — overview and file index
- DOCTRINE_PROMOTION_POLICY.md — source scope, processing rules, privacy posture
- DETECTION_RULES.md — signal patterns, scoring, grouping, duplicate check
- REVIEW_WORKFLOW.md — draft review process and manual approval workflow
- reports/ — generated promotion reports (committable)
- drafts/ — generated doctrine drafts for human review (committable)

## Decision Promotion layer (85_DecisionPromotion/)

- README.md — overview and file index
- DECISION_PROMOTION_POLICY.md — source scope, processing rules, privacy posture
- DETECTION_RULES.md — signal patterns, scoring, rationale extraction, duplicate check
- REVIEW_WORKFLOW.md — draft review process and manual approval workflow
- reports/ — generated promotion reports (committable)
- drafts/ — generated decision drafts for human review (committable)

## Concept Promotion layer (86_ConceptPromotion/)

- README.md — overview and file index
- CONCEPT_PROMOTION_POLICY.md — source scope, processing rules, privacy posture
- DETECTION_RULES.md — signal patterns, scoring, definition extraction, duplicate check
- REVIEW_WORKFLOW.md — draft review process and manual approval workflow
- reports/ — generated promotion reports (committable)
- drafts/ — generated concept drafts for human review (committable)

## Project / WO Promotion layer (87_ProjectPromotion/)

- README.md — overview and file index
- PROJECT_PROMOTION_POLICY.md — source scope, processing rules, no-execution rule, privacy posture
- DETECTION_RULES.md — signal patterns (project, WO, action, domain), scoring, type classification
- REVIEW_WORKFLOW.md — draft review process and manual approval workflow
- reports/ — generated promotion reports (committable)
- project_drafts/ — generated project drafts for human review (committable)
- work_order_drafts/ — generated WO drafts for human review (committable)

## Cortex Map layer (88_CortexMap/)

- README.md — overview and file index
- CORTEX_MAP_POLICY.md — source scope, output rules, privacy posture, limitations
- GRAPH_MODEL.md — node types, edge types, metrics, centrality/orphan/bridge logic
- REVIEW_WORKFLOW.md — how to review and act on cortex outputs
- reports/ — generated cortex review reports (committable)
- graphs/ — generated graph JSON files (committable)
- maps/ — generated Mermaid map files (committable)
- suggested_links/ — generated suggested link reports (committable)

## Review Cockpit layer (89_ReviewCockpit/)

- README.md — overview and file index
- COCKPIT_POLICY.md — what the cockpit may and may not do, recursion guard
- DASHBOARD_MODEL.md — lane model, status rules, output formats
- REVIEW_WORKFLOW.md — how to review and act on cockpit output
- reports/ — generated dashboard Markdown reports (committable)
- data/ — generated dashboard JSON files (committable)
- html/ — generated standalone HTML dashboards (committable)

## Operating Routine layer (96_OperatingRoutine/)

- README.md — overview and file index
- DAILY_ROUTINE.md — daily operating rhythm guide
- WEEKLY_ROUTINE.md — weekly review rhythm guide
- MONTHLY_ROUTINE.md — monthly cortex rhythm guide
- ROUTINE_POLICY.md — what routines may and may not do
- daily/ — generated daily review notes (committable)
- weekly/ — generated weekly operating reviews (committable)
- monthly/ — generated monthly cortex reviews (committable)
- reports/ — generated routine status reports (committable)

## Human Review Queues layer (97_HumanReviewQueues/)

- README.md — overview and file index
- REVIEW_QUEUE_POLICY.md — what review queues are and how they work
- ACCEPTANCE_WORKFLOW.md — step-by-step acceptance process
- LANE_REVIEW_GUIDE.md — lane-by-lane review instructions
- MANUAL_MOVE_POLICY.md — rules for manually moving accepted items
- reports/ — generated review queue reports (committable)
- checklists/ — generated acceptance checklists (committable)
- data/ — generated queue data JSON files (committable)

## Official Acceptance layer (98_OfficialAcceptance/)

- README.md — overview and file index
- ACCEPTANCE_POLICY.md — what official acceptance means
- VALIDATION_RULES.md — validation checks and blocking rules
- MANUAL_ACCEPTANCE_WORKFLOW.md — step-by-step workflow
- ACCEPTANCE_LOG_POLICY.md — logging rules
- plans/ — generated acceptance plans (committable)
- logs/ — acceptance log (committable, append-only)

## Post-Acceptance Closure layer (99_PostAcceptanceClosure/)

- README.md — overview and file index
- CLOSURE_POLICY.md — what closure means and the rules
- POST_ACCEPTANCE_WORKFLOW.md — step-by-step closure workflow
- SNAPSHOT_RECOMMENDATION_POLICY.md — how snapshot messages are derived
- CLOSURE_CHECKLIST_POLICY.md — checklist format and rules
- reports/ — generated closure reports (committable)
- checklists/ — generated closure checklists (committable)
- data/ — generated closure data JSON files (committable)

## External Drive Backup layer (101_ExternalDriveBackup/)

- README.md — overview and file index
- EXTERNAL_DRIVE_BACKUP_POLICY.md — backup rules and what happens during a run
- DESTINATION_READINESS.md — destination validation checks
- BACKUP_RUNBOOK.md — step-by-step backup procedure
- RESTORE_DRILL_CADENCE.md — recommended restore drill frequency
- plans/ — generated backup plans (committable)
- logs/DRIVE_BACKUP_LOG.md — append-only backup run log (committable)

## Maintenance Release layer (100_MaintenanceRelease/)

- README.md — overview and file index
- MAINTENANCE_POLICY.md — what maintenance releases mean and the rules
- V1_1_CHECKLIST.md — 20-point checklist for v1.1 validation
- TAGGING_POLICY.md — how tags are created and the safety rules
- POST_MAINTENANCE_ROUTINE.md — what to do after a maintenance release
- MAINTENANCE_MANIFEST.md — auto-generated maintenance state manifest (committable)
- reports/ — generated maintenance review reports (committable)
- data/ — generated maintenance data JSON files (committable)

## Production Readiness layer (106_ProductionReadiness/)

- README.md — overview and file index
- PRODUCTION_POLICY.md — gate criteria, verdict rules, non-negotiables
- reports/ — generated production readiness reports (committable)
- data/ — generated gate results JSON (committable)

## Runtime Smoke layer (105_RuntimeSmoke/)

- README.md — overview and file index
- SMOKE_POLICY.md — rules for runtime smoke testing
- reports/ — generated smoke reports (committable)
- data/ — generated smoke JSON (committable)

## Command Registry layer (104_CommandRegistry/)

- README.md — overview and file index
- COMMAND_REGISTRY_POLICY.md — rules for command registration
- reports/ — generated command reports (committable)
- data/ — generated command registry JSON (committable)

## Schema Registry layer (103_SchemaRegistry/)

- README.md — overview and file index
- SCHEMA_POLICY.md — rules for schema validation
- SCHEMA_REFERENCE.md — complete schema reference table
- reports/ — generated schema reports (committable)
- data/ — generated schema check JSON (committable)

## Obsidian Workspace layer (102_ObsidianWorkspace/)

- README.md — overview and file index
- WORKSPACE_POLICY.md — rules for workspace quality automation
- TAG_INDEX.md — canonical tag reference
- LINKING_GUIDE.md — wikilink conventions and patterns
- FOLDER_README_GUIDE.md — standards for folder README notes
- reports/ — generated workspace quality reports (committable)

## Release Governance layer (95_ReleaseGovernance/)

- README.md — overview and file index
- ACCEPTANCE_POLICY.md — what acceptance means and how it works
- V1_ACCEPTANCE_CHECKLIST.md — full v1 acceptance checklist
- RELEASE_TAG_POLICY.md — tagging rules and constraints
- POST_RELEASE_ROUTINE.md — post-release operating cadence
- RELEASE_MANIFEST.md — auto-generated release state manifest (committed with tags)
- reports/ — generated acceptance review reports (committable)
- data/ — generated acceptance data JSON files (committable)

## Private Remote Strategy layer (94_PrivateRemoteStrategy/)

- README.md — overview and file index
- REMOTE_STRATEGY_POLICY.md — what the strategy does and does not do
- OPTION_COMPARISON.md — full comparison of all remote protection options
- PRIVATE_GITHUB_GUIDE.md — setup guide for private GitHub repository
- EXTERNAL_DRIVE_STRATEGY.md — setup guide for external encrypted drive
- ENCRYPTED_ARCHIVE_STRATEGY.md — setup guide for encrypted off-machine archives
- SYNCTHING_STRATEGY.md — setup guide for Syncthing peer-to-peer sync
- OBSIDIAN_SYNC_STRATEGY.md — setup guide for Obsidian Sync
- REMOTE_READINESS_CHECKLIST.md — readiness checks before enabling any remote
- REMOTE_STRATEGY_MANIFEST.md — auto-generated strategy manifest

## Restore Drill layer (93_RestoreDrill/)

- README.md — overview and file index
- RESTORE_DRILL_POLICY.md — what the drill does and does not do
- RESTORE_CHECKS.md — required checks for a restored copy
- DISASTER_RECOVERY_PLAYBOOK.md — manual recovery steps
- RESTORE_MANIFEST.md — auto-generated restore state manifest (committed with snapshots)
- reports/ — generated restore drill reports (committable)
- proofs/ — generated runtime proof reports (committable)

## Backup Governance layer (92_BackupGovernance/)

- README.md — overview and file index
- BACKUP_POLICY.md — archive format, inclusion/exclusion rules, backup discipline
- SYNC_OPTIONS.md — optional sync strategies (external drive, cloud, private remote)
- RESTORE_TEST_POLICY.md — restore verification procedure and pass criteria
- PRIVATE_REMOTE_GUIDE.md — optional guide for private Git remote setup
- BACKUP_MANIFEST.md — auto-generated backup state manifest (committed with snapshots)
- local_archives/ — local backup archives (git-ignored)

## Git Governance layer (91_GitGovernance/)

- README.md — overview and file index
- SNAPSHOT_POLICY.md — what snapshots may and may not do, forbidden file rules
- BACKUP_POLICY.md — backup discipline, local/external/remote options
- RESTORE_WORKFLOW.md — how to restore from a snapshot or bundle
- SNAPSHOT_MANIFEST.md — auto-generated system state manifest (committed with snapshots)

## Scripts

- `scripts/william.py` — personal brain CLI (91 commands: init, today, weekly, inbox, decision, doctrine, concept, case, check, mcp-check, orphans, stale-decisions, graph, semantic-index, semantic-search, semantic-status, semantic-clear, synth-week, synth-status, inbox-status, process-inbox, doctrine-status, promote-doctrine, decision-status, promote-decisions, concept-status, promote-concepts, project-status, promote-projects, cortex-status, cortex-map, cockpit-status, cockpit, git-status, git-init, snapshot, snapshot-manifest, backup-status, backup, backup-manifest, backup-verify, restore-status, restore-drill, restore-runtime-proof, restore-manifest, remote-status, remote-strategy, remote-readiness, release-status, acceptance, release-manifest, release-tag, routine-status, daily-review, weekly-review, monthly-review, review-status, review-queues, acceptance-checklist, accept-status, accept-plan, accept-draft, accept-log, closure-status, post-acceptance, post-acceptance-checklist, maintenance-status, maintenance-review, maintenance-manifest, maintenance-tag, drive-backup-status, drive-backup-plan, drive-backup, drive-backup-log, obsidian-status, obsidian-quality, schema-status, schema-check, schema-report, help-all, command-status, command-report, runtime-status, runtime-smoke, production-status, production-readiness, control-center, control-center-stop, control-center-status, control-center-build, control-center-smoke)
- `scripts/williamos_search.py` — semantic search engine (sentence-transformers + TF-IDF fallback)
- `scripts/williamos_synthesis.py` — weekly review synthesizer (deterministic heuristics + optional semantic)
- `scripts/williamos_inbox.py` — inbox processor engine (deterministic heuristics + optional semantic)
- `scripts/williamos_doctrine.py` — doctrine promotion engine (deterministic heuristics + optional semantic)
- `scripts/williamos_decisions.py` — decision promotion engine (deterministic heuristics + optional semantic)
- `scripts/williamos_concepts.py` — concept promotion engine (deterministic heuristics + optional semantic)
- `scripts/williamos_projects.py` — project/WO promotion engine (deterministic heuristics + optional semantic)
- `scripts/williamos_cortex.py` — cortex map generator (local graph analysis + optional Graphify/semantic)
- `scripts/williamos_cockpit.py` — review cockpit engine (lane health, queues, dashboard generation)
- `scripts/williamos_git.py` — git snapshot governance engine (safety checks, forbidden files, manifests)
- `scripts/williamos_backup.py` — backup governance engine (archive creation, checksum, verification)
- `scripts/williamos_restore.py` — restore drill engine (extraction, health checks, reports, cleanup)
- `scripts/williamos_remote.py` — private remote strategy engine (readiness checks, strategy manifests)
- `scripts/williamos_release.py` — release governance engine (acceptance checks, reports, manifests, tagging)
- `scripts/williamos_routine.py` — operating routine engine (daily/weekly/monthly review generation)
- `scripts/williamos_review.py` — human review queue engine (queue scanning, reports, checklists)
- `scripts/williamos_acceptance.py` — official acceptance assistant (validation, plans, one-item acceptance, logging)
- `scripts/williamos_closure.py` — post-acceptance closure engine (queue refresh, check, snapshot recommendation, reports)
- `scripts/williamos_maintenance.py` — maintenance release engine (20-check validation, reports, manifests, local tagging)
- `scripts/williamos_drive_backup.py` — external drive backup engine (destination validation, plans, backup, verification, logging)
- `scripts/williamos_workspace.py` — workspace quality engine (folder READMEs, links, tags, frontmatter, dashboards)
- `scripts/williamos_schema.py` — schema registry engine (note type schemas, template validation, artifact checks)
- `scripts/williamos_commands.py` — command registry engine (discovery, catalog, reconciliation, reports)
- `scripts/williamos_smoke.py` — runtime smoke suite (end-to-end safe command runner, reports)
- `scripts/williamos_production.py` — production readiness gate (9-check aggregation, verdict, reports)
- `scripts/williamos_control_center.py` — Control Center launcher (start, stop, status, build, smoke)

## Control Center layer (110_ControlCenter/)

- README.md — overview and daily start
- LAUNCH_GUIDE.md — one-command launch, options, troubleshooting
- LOCAL_RUNTIME.md — architecture (one-process serving), dev mode, safety rules
- SMOKE_TESTS.md — 10-point smoke check reference
- AGENT_POLICY.md — operator agent design, rules, priority logic
- CONTROL_CENTER_POLICY.md — boundaries and what the Control Center may not do
- SAFETY_ALLOWLIST.md — full command allowlist tables
- generated/runtime/.gitignore — ignores PID file

## Control Center (control-center/)

- `control-center/backend/app.py` — FastAPI server (port 8420, serves API + built frontend)
- `control-center/backend/agent.py` — deterministic operator agent (read-only, no LLM)
- `control-center/backend/state_reader.py` — read-only vault state reader + review workbench (draft listing, detail, acceptance plans)
- `control-center/backend/safety.py` — command safety gate (allowlist, confirm, forbidden)
- `control-center/backend/command_runner.py` — safe CLI command executor
- `control-center/frontend/` — React 18 + TypeScript + Vite frontend
- `control-center/frontend/dist/` — pre-built production bundle (served by backend)

## Docs

- `docs/SETUP.md`
- `docs/GOVERNANCE.md`
- `docs/OPERATING_RHYTHM.md`
- `docs/MCP_GUARDRAILS.md`
- `docs/PLUGIN_STACK.md`
- `docs/GRAPHIFY_WORKFLOW.md`
- `docs/FIRST_7_DAYS.md`

## CI

- `.github/workflows/williamos-check.yml` — optional GitHub Actions check
