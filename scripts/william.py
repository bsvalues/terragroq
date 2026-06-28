#!/usr/bin/env python3
"""WilliamOS personal brain CLI.

This CLI intentionally keeps the personal vault separate from any TerraFusion repo.
It creates daily notes, captures inbox thoughts, checks vault hygiene, and runs optional Graphify hooks.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
from zoneinfo import ZoneInfo
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TEMPLATES = VAULT / "13_Templates"

REQUIRED_DIRS = [
    "00_Inbox", "01_Daily", "02_Decisions", "03_Doctrine", "04_Appraisal",
    "05_Assessor_Office", "06_TerraFusion_Strategy", "07_Learning", "08_People",
    "09_Cases", "10_Ideas", "11_Projects", "12_Maps", "13_Templates",
    "20_Graphify", "30_MCP", "40_Scripts", "40_Search", "50_Dashboards", "60_Synthesis", "70_InboxProcessor", "80_DoctrinePromotion", "85_DecisionPromotion", "86_ConceptPromotion", "87_ProjectPromotion", "88_CortexMap", "89_ReviewCockpit", "91_GitGovernance", "92_BackupGovernance", "93_RestoreDrill", "94_PrivateRemoteStrategy", "95_ReleaseGovernance", "96_OperatingRoutine", "97_HumanReviewQueues", "98_OfficialAcceptance", "99_PostAcceptanceClosure", "100_MaintenanceRelease", "101_ExternalDriveBackup", "102_ObsidianWorkspace", "103_SchemaRegistry", "104_CommandRegistry", "105_RuntimeSmoke", "106_ProductionReadiness", "110_ControlCenter", "90_Exports", "99_Archive",
]

ORPHAN_EXCLUDE_DIRS = {
    "13_Templates", "20_Graphify", "30_MCP", "40_Scripts", "40_Search", "50_Dashboards", "60_Synthesis", "70_InboxProcessor", "80_DoctrinePromotion", "85_DecisionPromotion", "86_ConceptPromotion", "87_ProjectPromotion", "88_CortexMap", "89_ReviewCockpit", "91_GitGovernance", "92_BackupGovernance", "93_RestoreDrill", "94_PrivateRemoteStrategy", "95_ReleaseGovernance", "96_OperatingRoutine", "97_HumanReviewQueues", "98_OfficialAcceptance", "99_PostAcceptanceClosure", "100_MaintenanceRelease", "101_ExternalDriveBackup", "102_ObsidianWorkspace", "103_SchemaRegistry", "104_CommandRegistry", "105_RuntimeSmoke", "106_ProductionReadiness", "90_Exports", "99_Archive",
}

MCP_REQUIRED_DOCS = [
    "30_MCP/AI_ACCESS_RULES.md",
    "30_MCP/MCP_WRITE_POLICY.md",
    "30_MCP/READ_ONLY_SCOPE_POLICY.md",
    "30_MCP/SAFE_AI_PROMPTS.md",
]

SEARCH_REQUIRED_DOCS = [
    "40_Search/README.md",
    "40_Search/SEARCH_POLICY.md",
    "40_Search/SEMANTIC_SEARCH_SETUP.md",
    "40_Search/QUERY_EXAMPLES.md",
]

SYNTHESIS_REQUIRED_DOCS = [
    "60_Synthesis/README.md",
    "60_Synthesis/WEEKLY_SYNTHESIS_POLICY.md",
    "60_Synthesis/WEEKLY_SYNTHESIS_TEMPLATE.md",
    "60_Synthesis/QUERY_STRATEGY.md",
]

INBOX_REQUIRED_DOCS = [
    "70_InboxProcessor/README.md",
    "70_InboxProcessor/INBOX_PROCESSING_POLICY.md",
    "70_InboxProcessor/CLASSIFICATION_RULES.md",
    "70_InboxProcessor/PROMOTION_WORKFLOW.md",
]

DOCTRINE_PROMOTION_REQUIRED_DOCS = [
    "80_DoctrinePromotion/README.md",
    "80_DoctrinePromotion/DOCTRINE_PROMOTION_POLICY.md",
    "80_DoctrinePromotion/DETECTION_RULES.md",
    "80_DoctrinePromotion/REVIEW_WORKFLOW.md",
]

DECISION_PROMOTION_REQUIRED_DOCS = [
    "85_DecisionPromotion/README.md",
    "85_DecisionPromotion/DECISION_PROMOTION_POLICY.md",
    "85_DecisionPromotion/DETECTION_RULES.md",
    "85_DecisionPromotion/REVIEW_WORKFLOW.md",
]

CONCEPT_PROMOTION_REQUIRED_DOCS = [
    "86_ConceptPromotion/README.md",
    "86_ConceptPromotion/CONCEPT_PROMOTION_POLICY.md",
    "86_ConceptPromotion/DETECTION_RULES.md",
    "86_ConceptPromotion/REVIEW_WORKFLOW.md",
]

PROJECT_PROMOTION_REQUIRED_DOCS = [
    "87_ProjectPromotion/README.md",
    "87_ProjectPromotion/PROJECT_PROMOTION_POLICY.md",
    "87_ProjectPromotion/DETECTION_RULES.md",
    "87_ProjectPromotion/REVIEW_WORKFLOW.md",
]

CORTEX_MAP_REQUIRED_DOCS = [
    "88_CortexMap/README.md",
    "88_CortexMap/CORTEX_MAP_POLICY.md",
    "88_CortexMap/GRAPH_MODEL.md",
    "88_CortexMap/REVIEW_WORKFLOW.md",
]

COCKPIT_REQUIRED_DOCS = [
    "89_ReviewCockpit/README.md",
    "89_ReviewCockpit/COCKPIT_POLICY.md",
    "89_ReviewCockpit/DASHBOARD_MODEL.md",
    "89_ReviewCockpit/REVIEW_WORKFLOW.md",
]

GIT_GOV_REQUIRED_DOCS = [
    "91_GitGovernance/README.md",
    "91_GitGovernance/SNAPSHOT_POLICY.md",
    "91_GitGovernance/BACKUP_POLICY.md",
    "91_GitGovernance/RESTORE_WORKFLOW.md",
]

BACKUP_GOV_REQUIRED_DOCS = [
    "92_BackupGovernance/README.md",
    "92_BackupGovernance/BACKUP_POLICY.md",
    "92_BackupGovernance/SYNC_OPTIONS.md",
    "92_BackupGovernance/RESTORE_TEST_POLICY.md",
    "92_BackupGovernance/PRIVATE_REMOTE_GUIDE.md",
]

RESTORE_DRILL_REQUIRED_DOCS = [
    "93_RestoreDrill/README.md",
    "93_RestoreDrill/RESTORE_DRILL_POLICY.md",
    "93_RestoreDrill/RESTORE_CHECKS.md",
    "93_RestoreDrill/DISASTER_RECOVERY_PLAYBOOK.md",
]

REMOTE_STRATEGY_REQUIRED_DOCS = [
    "94_PrivateRemoteStrategy/README.md",
    "94_PrivateRemoteStrategy/REMOTE_STRATEGY_POLICY.md",
    "94_PrivateRemoteStrategy/OPTION_COMPARISON.md",
    "94_PrivateRemoteStrategy/PRIVATE_GITHUB_GUIDE.md",
    "94_PrivateRemoteStrategy/EXTERNAL_DRIVE_STRATEGY.md",
    "94_PrivateRemoteStrategy/ENCRYPTED_ARCHIVE_STRATEGY.md",
    "94_PrivateRemoteStrategy/SYNCTHING_STRATEGY.md",
    "94_PrivateRemoteStrategy/OBSIDIAN_SYNC_STRATEGY.md",
    "94_PrivateRemoteStrategy/REMOTE_READINESS_CHECKLIST.md",
]

RELEASE_GOV_REQUIRED_DOCS = [
    "95_ReleaseGovernance/README.md",
    "95_ReleaseGovernance/ACCEPTANCE_POLICY.md",
    "95_ReleaseGovernance/V1_ACCEPTANCE_CHECKLIST.md",
    "95_ReleaseGovernance/RELEASE_TAG_POLICY.md",
    "95_ReleaseGovernance/POST_RELEASE_ROUTINE.md",
]

ROUTINE_REQUIRED_DOCS = [
    "96_OperatingRoutine/README.md",
    "96_OperatingRoutine/DAILY_ROUTINE.md",
    "96_OperatingRoutine/WEEKLY_ROUTINE.md",
    "96_OperatingRoutine/MONTHLY_ROUTINE.md",
    "96_OperatingRoutine/ROUTINE_POLICY.md",
]

REVIEW_QUEUE_REQUIRED_DOCS = [
    "97_HumanReviewQueues/README.md",
    "97_HumanReviewQueues/REVIEW_QUEUE_POLICY.md",
    "97_HumanReviewQueues/ACCEPTANCE_WORKFLOW.md",
    "97_HumanReviewQueues/LANE_REVIEW_GUIDE.md",
    "97_HumanReviewQueues/MANUAL_MOVE_POLICY.md",
]

ACCEPTANCE_REQUIRED_DOCS = [
    "98_OfficialAcceptance/README.md",
    "98_OfficialAcceptance/ACCEPTANCE_POLICY.md",
    "98_OfficialAcceptance/VALIDATION_RULES.md",
    "98_OfficialAcceptance/MANUAL_ACCEPTANCE_WORKFLOW.md",
    "98_OfficialAcceptance/ACCEPTANCE_LOG_POLICY.md",
]

CLOSURE_REQUIRED_DOCS = [
    "99_PostAcceptanceClosure/README.md",
    "99_PostAcceptanceClosure/CLOSURE_POLICY.md",
    "99_PostAcceptanceClosure/POST_ACCEPTANCE_WORKFLOW.md",
    "99_PostAcceptanceClosure/SNAPSHOT_RECOMMENDATION_POLICY.md",
    "99_PostAcceptanceClosure/CLOSURE_CHECKLIST_POLICY.md",
]

MAINTENANCE_REQUIRED_DOCS = [
    "100_MaintenanceRelease/README.md",
    "100_MaintenanceRelease/MAINTENANCE_POLICY.md",
    "100_MaintenanceRelease/V1_1_CHECKLIST.md",
    "100_MaintenanceRelease/TAGGING_POLICY.md",
    "100_MaintenanceRelease/POST_MAINTENANCE_ROUTINE.md",
]

DRIVE_BACKUP_REQUIRED_DOCS = [
    "101_ExternalDriveBackup/README.md",
    "101_ExternalDriveBackup/EXTERNAL_DRIVE_BACKUP_POLICY.md",
    "101_ExternalDriveBackup/DESTINATION_READINESS.md",
    "101_ExternalDriveBackup/BACKUP_RUNBOOK.md",
    "101_ExternalDriveBackup/RESTORE_DRILL_CADENCE.md",
]

WORKSPACE_REQUIRED_DOCS = [
    "102_ObsidianWorkspace/README.md",
    "102_ObsidianWorkspace/WORKSPACE_POLICY.md",
    "102_ObsidianWorkspace/TAG_INDEX.md",
    "102_ObsidianWorkspace/LINKING_GUIDE.md",
    "102_ObsidianWorkspace/FOLDER_README_GUIDE.md",
]

SCHEMA_REQUIRED_DOCS = [
    "103_SchemaRegistry/README.md",
    "103_SchemaRegistry/SCHEMA_POLICY.md",
    "103_SchemaRegistry/SCHEMA_REFERENCE.md",
]

COMMAND_REGISTRY_REQUIRED_DOCS = [
    "104_CommandRegistry/README.md",
    "104_CommandRegistry/COMMAND_REGISTRY_POLICY.md",
]

SMOKE_REQUIRED_DOCS = [
    "105_RuntimeSmoke/README.md",
    "105_RuntimeSmoke/SMOKE_POLICY.md",
]

PROD_REQUIRED_DOCS = [
    "106_ProductionReadiness/README.md",
    "106_ProductionReadiness/PRODUCTION_POLICY.md",
]

GRAPHIFY_DEFAULT_TARGETS = [
    "03_Doctrine", "04_Appraisal", "05_Assessor_Office",
    "06_TerraFusion_Strategy", "07_Learning", "09_Cases", "10_Ideas", "11_Projects",
]


def local_today() -> dt.date:
    tz_name = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")
    return dt.datetime.now(ZoneInfo(tz_name)).date()


def today_iso() -> str:
    return local_today().isoformat()


def week_id() -> str:
    y, w, _ = local_today().isocalendar()
    return f"{y}-W{w:02d}"


def slugify(text: str) -> str:
    text = text.strip().replace("/", "-")
    text = re.sub(r"[^A-Za-z0-9 _.-]+", "", text)
    text = re.sub(r"\s+", "-", text)
    return text[:100] or "untitled"


def read_template(name: str) -> str:
    path = TEMPLATES / name
    if not path.exists():
        print(f"Error: Missing template: {path}", file=sys.stderr)
        raise SystemExit(1)
    return path.read_text(encoding="utf-8")


def write_if_missing(path: Path, content: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return False
    path.write_text(content, encoding="utf-8")
    return True


def iter_markdown() -> Iterable[Path]:
    if not VAULT.exists():
        return []
    return VAULT.rglob("*.md")


def _is_excluded_orphan(p: Path) -> bool:
    rel = p.relative_to(VAULT)
    parts = rel.parts
    if not parts:
        return True
    return parts[0] in ORPHAN_EXCLUDE_DIRS


def cmd_init(_: argparse.Namespace) -> None:
    for d in REQUIRED_DIRS:
        (VAULT / d).mkdir(parents=True, exist_ok=True)
    print(f"Initialized vault scaffold at {VAULT.resolve()}")


def cmd_today(_: argparse.Namespace) -> None:
    date = today_iso()
    path = VAULT / "01_Daily" / f"{date}.md"
    template = read_template("Daily Command.md")
    content = template.replace("{{date}}", date)
    created = write_if_missing(path, content)
    print(("Created" if created else "Exists") + f": {path}")


def cmd_weekly(_: argparse.Namespace) -> None:
    week = week_id()
    path = VAULT / "01_Daily" / f"Weekly Review - {week}.md"
    template = read_template("Weekly Review.md")
    content = template.replace("{{week}}", week).replace("{{date}}", today_iso())
    created = write_if_missing(path, content)
    print(("Created" if created else "Exists") + f": {path}")


def cmd_inbox(args: argparse.Namespace) -> None:
    date = today_iso()
    title = slugify(args.text[:60])
    path = VAULT / "00_Inbox" / f"{date}-{title}.md"
    content = f"""---
type: inbox
status: unprocessed
created: {date}
tags:
  - inbox
---

# Inbox - {date}

## Thought

{args.text}

## Possible links

- [[]]

## Promote to

- [ ] concept
- [ ] doctrine
- [ ] decision
- [ ] project
- [ ] archive
"""
    path.write_text(content, encoding="utf-8")
    print(f"Captured: {path}")


def cmd_decision(args: argparse.Namespace) -> None:
    date = today_iso()
    review = args.review or (local_today() + dt.timedelta(days=30)).isoformat()
    path = VAULT / "02_Decisions" / f"DEC-{date}-{slugify(args.title)}.md"
    template = read_template("Decision Record.md")
    content = (
        template.replace("{{title}}", args.title)
        .replace("{{date}}", date)
        .replace("{{review}}", review)
        .replace("{{area}}", args.area)
    )
    created = write_if_missing(path, content)
    print(("Created" if created else "Exists") + f": {path}")


def cmd_doctrine(args: argparse.Namespace) -> None:
    date = today_iso()
    path = VAULT / "03_Doctrine" / f"Doctrine - {slugify(args.title)}.md"
    template = read_template("Doctrine.md")
    content = template.replace("{{title}}", args.title).replace("{{date}}", date).replace("{{area}}", args.area)
    created = write_if_missing(path, content)
    print(("Created" if created else "Exists") + f": {path}")


def cmd_concept(args: argparse.Namespace) -> None:
    date = today_iso()
    path = VAULT / "10_Ideas" / f"{slugify(args.title)}.md"
    template = read_template("Concept Note.md")
    content = template.replace("{{title}}", args.title).replace("{{date}}", date).replace("{{area}}", args.area)
    created = write_if_missing(path, content)
    print(("Created" if created else "Exists") + f": {path}")


def cmd_case(args: argparse.Namespace) -> None:
    date = today_iso()
    path = VAULT / "09_Cases" / f"Case - {slugify(args.title)}.md"
    template = read_template("Case Analysis.md")
    content = (
        template.replace("{{title}}", args.title)
        .replace("{{date}}", date)
        .replace("{{case_type}}", args.case_type)
    )
    created = write_if_missing(path, content)
    print(("Created" if created else "Exists") + f": {path}")


def cmd_orphans(_: argparse.Namespace) -> None:
    files = list(iter_markdown())
    linked_names = set()
    link_re = re.compile(r"\[\[([^\]|#]+)")
    for p in files:
        text = p.read_text(encoding="utf-8", errors="ignore")
        linked_names.update(m.group(1).strip() for m in link_re.finditer(text))
    orphans = []
    for p in files:
        if _is_excluded_orphan(p):
            continue
        stem = p.stem
        if stem.startswith("MOC -"):
            continue
        if stem not in linked_names:
            orphans.append(p)
    if not orphans:
        print("No orphan notes found.")
        return
    print("Potential orphan notes:")
    for p in sorted(orphans):
        print(f"  {p}")


def _frontmatter_field(text: str, field: str) -> str | None:
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None
    for line in parts[1].splitlines():
        if line.strip().startswith(field + ":"):
            return line.split(":", 1)[1].strip().strip('"')
    return None


def cmd_stale_decisions(_: argparse.Namespace) -> None:
    dec_dir = VAULT / "02_Decisions"
    if not dec_dir.exists():
        print("No decisions directory found.")
        return
    today = local_today()
    stale = []
    for p in dec_dir.glob("*.md"):
        text = p.read_text(encoding="utf-8", errors="ignore")
        status = _frontmatter_field(text, "status")
        review = _frontmatter_field(text, "review")
        if status == "closed" or not review:
            continue
        try:
            review_date = dt.date.fromisoformat(review)
        except ValueError:
            continue
        if review_date <= today:
            stale.append((review_date, p))
    if not stale:
        print("No stale decisions found.")
        return
    print("Stale decisions:")
    for review_date, p in sorted(stale):
        print(f"  {review_date}: {p.name}")


def cmd_check(_: argparse.Namespace) -> None:
    issues = []
    for d in REQUIRED_DIRS:
        if not (VAULT / d).exists():
            issues.append(f"Missing directory: {VAULT / d}")
    for doc in MCP_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing MCP doc: {VAULT / doc}")
    for doc in SEARCH_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing search doc: {VAULT / doc}")
    for doc in SYNTHESIS_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing synthesis doc: {VAULT / doc}")
    for doc in INBOX_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing inbox processor doc: {VAULT / doc}")
    for doc in DOCTRINE_PROMOTION_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing doctrine promotion doc: {VAULT / doc}")
    for doc in DECISION_PROMOTION_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing decision promotion doc: {VAULT / doc}")
    for doc in CONCEPT_PROMOTION_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing concept promotion doc: {VAULT / doc}")
    for doc in PROJECT_PROMOTION_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing project promotion doc: {VAULT / doc}")
    for doc in CORTEX_MAP_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing cortex map doc: {VAULT / doc}")
    for doc in COCKPIT_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing cockpit doc: {VAULT / doc}")
    for doc in GIT_GOV_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing git governance doc: {VAULT / doc}")
    for doc in BACKUP_GOV_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing backup governance doc: {VAULT / doc}")
    for doc in RESTORE_DRILL_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing restore drill doc: {VAULT / doc}")
    for doc in REMOTE_STRATEGY_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing remote strategy doc: {VAULT / doc}")
    for doc in RELEASE_GOV_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing release governance doc: {VAULT / doc}")
    for doc in ROUTINE_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing routine doc: {VAULT / doc}")
    for doc in REVIEW_QUEUE_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing review queue doc: {VAULT / doc}")
    for doc in ACCEPTANCE_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing acceptance doc: {VAULT / doc}")
    for doc in CLOSURE_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing closure doc: {VAULT / doc}")
    for doc in MAINTENANCE_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing maintenance doc: {VAULT / doc}")
    for doc in DRIVE_BACKUP_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing drive backup doc: {VAULT / doc}")
    for doc in WORKSPACE_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing workspace doc: {VAULT / doc}")
    for doc in SCHEMA_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing schema doc: {VAULT / doc}")
    for doc in COMMAND_REGISTRY_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing command registry doc: {VAULT / doc}")
    for doc in SMOKE_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing smoke doc: {VAULT / doc}")
    for doc in PROD_REQUIRED_DOCS:
        if not (VAULT / doc).exists():
            issues.append(f"Missing production readiness doc: {VAULT / doc}")
    for p in iter_markdown():
        rel = p.relative_to(VAULT)
        parts = rel.parts
        if parts and parts[0] in ("13_Templates", "20_Graphify", "40_Scripts", "40_Search", "30_MCP", "60_Synthesis", "70_InboxProcessor", "80_DoctrinePromotion", "85_DecisionPromotion", "86_ConceptPromotion", "87_ProjectPromotion", "88_CortexMap", "89_ReviewCockpit", "91_GitGovernance", "92_BackupGovernance", "93_RestoreDrill", "94_PrivateRemoteStrategy", "95_ReleaseGovernance", "96_OperatingRoutine", "97_HumanReviewQueues", "98_OfficialAcceptance", "99_PostAcceptanceClosure", "100_MaintenanceRelease", "101_ExternalDriveBackup", "102_ObsidianWorkspace", "103_SchemaRegistry", "104_CommandRegistry", "105_RuntimeSmoke", "106_ProductionReadiness"):
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        if not text.startswith("---"):
            issues.append(f"Missing frontmatter: {p}")
        if "{{" in text and "}}" in text:
            issues.append(f"Unresolved template token: {p}")
    if issues:
        print("WilliamOS check found issues:")
        for issue in issues:
            print(f"  {issue}")
        raise SystemExit(1)
    print("WilliamOS check passed.")


def cmd_mcp_check(_: argparse.Namespace) -> None:
    issues = []
    passed = []

    mcp_dir = VAULT / "30_MCP"
    if mcp_dir.exists():
        passed.append("30_MCP directory exists")
    else:
        issues.append("Missing directory: 30_MCP")

    for doc in MCP_REQUIRED_DOCS:
        path = VAULT / doc
        if path.exists():
            passed.append(f"Found: {doc}")
        else:
            issues.append(f"Missing: {doc}")

    write_policy = VAULT / "30_MCP" / "MCP_WRITE_POLICY.md"
    if write_policy.exists():
        text = write_policy.read_text(encoding="utf-8", errors="ignore")
        if "read-only" in text.lower() or "write access is not enabled" in text.lower():
            passed.append("Write policy confirms read-only default")
        else:
            issues.append("Write policy does not clearly state read-only default")

    scope_policy = VAULT / "30_MCP" / "READ_ONLY_SCOPE_POLICY.md"
    if scope_policy.exists():
        text = scope_policy.read_text(encoding="utf-8", errors="ignore")
        for folder in ["02_Decisions", "03_Doctrine", "09_Cases", "50_Dashboards"]:
            if folder in text:
                passed.append(f"Protected folder listed in scope policy: {folder}")
            else:
                issues.append(f"Protected folder missing from scope policy: {folder}")

    env_file = Path(".env")
    if env_file.exists():
        issues.append(".env file exists — ensure it is not committed to Git")
    else:
        passed.append("No .env file found (good)")

    print("MCP Readiness Check")
    print("=" * 40)
    if passed:
        print(f"\nPassed ({len(passed)}):")
        for item in passed:
            print(f"  + {item}")
    if issues:
        print(f"\nIssues ({len(issues)}):")
        for item in issues:
            print(f"  - {item}")
        raise SystemExit(1)
    else:
        print(f"\nAll {len(passed)} checks passed.")
        print("MCP readiness confirmed. Live connection not tested.")


def cmd_graph(args: argparse.Namespace) -> None:
    graphify = shutil.which("graphify")
    if not graphify:
        print("Graphify CLI not found on PATH.")
        print()
        print("To install Graphify:")
        print("  See https://github.com/SkepticMystic/graphify for installation.")
        print()
        print("Fallback options:")
        print("  - Use Obsidian's built-in graph view")
        print("  - Run: python scripts/william.py orphans")
        return
    out = VAULT / "20_Graphify" / "generated"
    out.mkdir(parents=True, exist_ok=True)
    if args.target:
        targets = [args.target]
    else:
        targets = [str(VAULT / t) for t in GRAPHIFY_DEFAULT_TARGETS if (VAULT / t).exists()]
    for target in targets:
        print(f"Running Graphify on: {target}")
        subprocess.run([graphify, target, "--output", str(out)], check=False)
    print(f"Graph output written to: {out}")


def cmd_synth_week(args: argparse.Namespace) -> None:
    from williamos_synthesis import synthesize_week
    result = synthesize_week(week_id=args.week, dry_run=args.dry_run)
    mode = result["mode"]
    notes = result["notes_reviewed"]
    loops = result["open_loops"]
    themes = result["themes"]
    if args.dry_run:
        print(f"Dry run for {result['week']} ({result['week_start']} to {result['week_end']})")
        print(f"  Mode: {mode}")
        print(f"  Notes in scope: {len(notes)}")
        print(f"  Open decisions: {len(result['open_decisions'])}")
        print(f"  Open loops: {len(loops)}")
        print(f"  Repeated themes: {len(themes)}")
        print(f"  Candidate doctrines: {len(result['candidate_doctrines'])}")
        print(f"  Candidate WOs: {len(result['candidate_wos'])}")
        if notes:
            print("  Notes:")
            for n in notes[:15]:
                print(f"    {n['rel']}")
            if len(notes) > 15:
                print(f"    ... and {len(notes) - 15} more")
    else:
        print(f"Weekly synthesis generated: {result.get('output_path', '?')}")
        print(f"  Mode: {mode}")
        print(f"  Notes reviewed: {len(notes)}")
        print(f"  Open loops: {len(loops)}")
        print(f"  Repeated themes: {len(themes)}")


def cmd_synth_status(_: argparse.Namespace) -> None:
    from williamos_synthesis import get_synthesis_status
    status = get_synthesis_status()
    print("Weekly Synthesis Status")
    print("=" * 40)
    print(f"  Docs exist: {'yes' if status['docs_exist'] else 'no'}")
    print(f"  Output dir: {status['output_dir']} ({'exists' if status['output_dir_exists'] else 'missing'})")
    if status.get("last_synthesis"):
        print(f"  Last synthesis: {status['last_synthesis']}")
    else:
        print("  Last synthesis: none")
    print(f"  Semantic search: {status['semantic_available']}")
    print(f"  Semantic index: {'yes' if status['semantic_index_exists'] else 'no'}")


def cmd_semantic_index(_: argparse.Namespace) -> None:
    from williamos_search import build_index
    result = build_index()
    if result.get("error") == "no_dependencies":
        print("No search dependencies available.")
        print("Install sentence-transformers or scikit-learn:")
        print("  pip install -r requirements-search.txt")
        raise SystemExit(1)
    if result.get("error") == "no_content":
        print(f"No indexable content found ({result.get('files', 0)} files scanned).")
        raise SystemExit(1)
    print(f"Index built: mode={result['mode']}, files={result['files_indexed']}, chunks={result['chunks_indexed']}")


def cmd_semantic_search(args: argparse.Namespace) -> None:
    from williamos_search import search
    results = search(args.query, top_k=args.top)
    if not results:
        print("No results found.")
        return
    if results[0].get("error") == "no_index":
        print("No index found. Run: python scripts/william.py semantic-index")
        raise SystemExit(1)
    if results[0].get("error"):
        print(f"Search error: {results[0]}")
        raise SystemExit(1)
    for r in results:
        print(f"  [{r['rank']}] {r['score']:.4f}  {r['source']}")
        print(f"      {r['title']}")
        excerpt = r.get("excerpt", "")
        if excerpt:
            print(f"      {excerpt[:120]}...")
        print()


def cmd_semantic_status(_: argparse.Namespace) -> None:
    from williamos_search import get_status
    status = get_status()
    print("Semantic Search Status")
    print("=" * 40)
    print(f"  Available mode: {status['available_mode']}")
    if status.get("index_exists"):
        print(f"  Index exists: yes")
        print(f"  Index mode: {status.get('mode', 'unknown')}")
        print(f"  Model: {status.get('model', 'unknown')}")
        print(f"  Files indexed: {status.get('files_indexed', 0)}")
        print(f"  Chunks indexed: {status.get('chunks_indexed', 0)}")
        print(f"  Created: {status.get('created_at', 'unknown')}")
    else:
        print(f"  Index exists: no")
        if status["available_mode"] == "unavailable":
            print("  Install: pip install -r requirements-search.txt")
        else:
            print("  Run: python scripts/william.py semantic-index")


def cmd_semantic_clear(args: argparse.Namespace) -> None:
    from williamos_search import clear_index
    if not args.confirm:
        print("Use --confirm to delete the search index.")
        return
    if clear_index(confirm=True):
        print("Search index cleared.")
    else:
        print("No index to clear.")


def cmd_doctrine_status(_: argparse.Namespace) -> None:
    from williamos_doctrine import get_doctrine_status
    status = get_doctrine_status()
    print("Doctrine Promotion Status")
    print("=" * 40)
    print(f"  Official doctrine dir: {'yes' if status['doctrine_dir_exists'] else 'no'}")
    print(f"  Official doctrine notes: {status['official_doctrine_count']}")
    print(f"  Promotion dir: {'yes' if status['promotion_dir_exists'] else 'no'}")
    print(f"  Promotion docs: {'yes' if status['promotion_docs_exist'] else 'no'}")
    print(f"  Existing drafts: {status['existing_drafts_count']}")
    print(f"  Synthesis reports: {status['synthesis_reports']}")
    print(f"  Inbox triage reports: {status['inbox_triage_reports']}")
    if status.get("last_report"):
        print(f"  Last promotion report: {status['last_report']}")
    else:
        print("  Last promotion report: none")
    print(f"  Semantic: {status['semantic_available']}")


def cmd_promote_doctrine(args: argparse.Namespace) -> None:
    from williamos_doctrine import promote_doctrine
    result = promote_doctrine(source=args.source, dry_run=args.dry_run)
    total = result["total_candidates"]
    mode = result["mode"]
    high = len(result["high"])
    medium = len(result["medium"])
    low = len(result["low"])
    if args.dry_run:
        print(f"Dry run: {result['total_files_scanned']} source files scanned (scope: {args.source})")
        print(f"  Mode: {mode}")
        print(f"  Doctrine candidates: {total}")
        print(f"  High confidence: {high}")
        print(f"  Medium confidence: {medium}")
        print(f"  Low / needs review: {low}")
        if result["candidates"]:
            print("  Candidates:")
            for c in result["candidates"][:15]:
                sim_flag = " [possible duplicate]" if c["similar_existing_doctrine"] else ""
                print(f"    {c['candidate_title']} ({c['confidence']}){sim_flag}")
    else:
        print(f"Doctrine promotion report: {result.get('report_path', '?')}")
        print(f"  Mode: {mode}")
        print(f"  Files scanned: {result['total_files_scanned']}")
        print(f"  Candidates: {total} (high: {high}, medium: {medium}, low: {low})")
        if result.get("draft_paths"):
            print(f"  Drafts created: {len(result['draft_paths'])}")
            for dp in result["draft_paths"][:10]:
                print(f"    {dp}")


def cmd_decision_status(_: argparse.Namespace) -> None:
    from williamos_decisions import get_decision_status
    status = get_decision_status()
    print("Decision Promotion Status")
    print("=" * 40)
    print(f"  Official decisions dir: {'yes' if status['decisions_dir_exists'] else 'no'}")
    print(f"  Official decision notes: {status['official_decision_count']}")
    print(f"  Open decisions: {status['open_decision_count']}")
    print(f"  Promotion dir: {'yes' if status['promotion_dir_exists'] else 'no'}")
    print(f"  Promotion docs: {'yes' if status['promotion_docs_exist'] else 'no'}")
    print(f"  Existing drafts: {status['existing_drafts_count']}")
    print(f"  Synthesis reports: {status['synthesis_reports']}")
    print(f"  Inbox triage reports: {status['inbox_triage_reports']}")
    if status.get("last_report"):
        print(f"  Last promotion report: {status['last_report']}")
    else:
        print("  Last promotion report: none")
    print(f"  Semantic: {status['semantic_available']}")


def cmd_promote_decisions(args: argparse.Namespace) -> None:
    from williamos_decisions import promote_decisions
    result = promote_decisions(source=args.source, dry_run=args.dry_run)
    total = result["total_candidates"]
    mode = result["mode"]
    high = len(result["high"])
    medium = len(result["medium"])
    low = len(result["low"])
    if args.dry_run:
        print(f"Dry run: {result['total_files_scanned']} source files scanned (scope: {args.source})")
        print(f"  Mode: {mode}")
        print(f"  Decision candidates: {total}")
        print(f"  High confidence: {high}")
        print(f"  Medium confidence: {medium}")
        print(f"  Low / needs review: {low}")
        if result["candidates"]:
            print("  Candidates:")
            for c in result["candidates"][:15]:
                sim_flag = " [possible duplicate]" if c["similar_existing_decisions"] else ""
                print(f"    {c['candidate_title']} ({c['confidence']}){sim_flag}")
    else:
        print(f"Decision promotion report: {result.get('report_path', '?')}")
        print(f"  Mode: {mode}")
        print(f"  Files scanned: {result['total_files_scanned']}")
        print(f"  Candidates: {total} (high: {high}, medium: {medium}, low: {low})")
        if result.get("draft_paths"):
            print(f"  Drafts created: {len(result['draft_paths'])}")
            for dp in result["draft_paths"][:10]:
                print(f"    {dp}")


def cmd_project_status(_: argparse.Namespace) -> None:
    from williamos_projects import get_project_status
    status = get_project_status()
    print("Project / WO Promotion Status")
    print("=" * 40)
    print(f"  Official projects dir: {'yes' if status['projects_dir_exists'] else 'no'}")
    print(f"  Official project notes: {status['official_project_count']}")
    print(f"  Promotion dir: {'yes' if status['promotion_dir_exists'] else 'no'}")
    print(f"  Promotion docs: {'yes' if status['promotion_docs_exist'] else 'no'}")
    print(f"  Project drafts: {status['project_drafts_count']}")
    print(f"  Work-order drafts: {status['wo_drafts_count']}")
    print(f"  Synthesis reports: {status['synthesis_reports']}")
    print(f"  Inbox triage reports: {status['inbox_triage_reports']}")
    print(f"  Idea notes: {status['idea_notes']}")
    print(f"  Learning notes: {status['learning_notes']}")
    print(f"  Case notes: {status['case_notes']}")
    print(f"  Project notes: {status['project_notes']}")
    if status.get("last_report"):
        print(f"  Last promotion report: {status['last_report']}")
    else:
        print("  Last promotion report: none")
    print(f"  Semantic: {status['semantic_available']}")


def cmd_promote_projects(args: argparse.Namespace) -> None:
    from williamos_projects import promote_projects
    result = promote_projects(source=args.source, dry_run=args.dry_run)
    total = result["total_candidates"]
    mode = result["mode"]
    high = len(result["high"])
    medium = len(result["medium"])
    low = len(result["low"])
    projects = len(result["projects"])
    work_orders = len(result["work_orders"])
    actions = len(result["actions"])
    if args.dry_run:
        print(f"Dry run: {result['total_files_scanned']} source files scanned (scope: {args.source})")
        print(f"  Mode: {mode}")
        print(f"  Total candidates: {total}")
        print(f"  Projects: {projects}, Work orders: {work_orders}, Action items: {actions}")
        print(f"  High confidence: {high}, Medium: {medium}, Low: {low}")
        if result["candidates"]:
            print("  Candidates:")
            for c in result["candidates"][:15]:
                sim_flag = " [possible duplicate]" if c["similar_existing_projects"] else ""
                print(f"    {c['candidate_title']} ({c['candidate_type']}, {c['confidence']}){sim_flag}")
    else:
        print(f"Project promotion report: {result.get('report_path', '?')}")
        print(f"  Mode: {mode}")
        print(f"  Files scanned: {result['total_files_scanned']}")
        print(f"  Candidates: {total} (projects: {projects}, WOs: {work_orders}, actions: {actions})")
        print(f"  Confidence: high={high}, medium={medium}, low={low}")
        if result.get("draft_paths"):
            print(f"  Drafts created: {len(result['draft_paths'])}")
            for dp in result["draft_paths"][:10]:
                print(f"    {dp}")


def cmd_cortex_status(_: argparse.Namespace) -> None:
    from williamos_cortex import get_cortex_status
    status = get_cortex_status()
    print("Cortex Map Status")
    print("=" * 40)
    print(f"  Cortex dir: {'yes' if status['cortex_dir_exists'] else 'no'}")
    print(f"  Docs exist: {'yes' if status['docs_exist'] else 'no'}")
    print(f"  Reports dir: {'yes' if status['reports_dir_exists'] else 'no'}")
    print(f"  Graphs dir: {'yes' if status['graphs_dir_exists'] else 'no'}")
    print(f"  Maps dir: {'yes' if status['maps_dir_exists'] else 'no'}")
    print(f"  Core source notes: {status['core_source_notes']}")
    print(f"  Promotion source notes: {status['promotion_source_notes']}")
    print(f"  All source notes: {status['all_source_notes']}")
    if status.get("last_report"):
        print(f"  Last report: {status['last_report']}")
    else:
        print("  Last report: none")
    if status.get("last_graph"):
        print(f"  Last graph: {status['last_graph']} ({status['last_graph_nodes']} nodes, {status['last_graph_edges']} edges)")
    else:
        print("  Last graph: none")
    print(f"  Graphify output: {'yes' if status['graphify_exists'] else 'no'}")
    print(f"  Semantic index: {'yes' if status['semantic_exists'] else 'no'}")


def cmd_cortex_map(args: argparse.Namespace) -> None:
    from williamos_cortex import cortex_map
    result = cortex_map(scope=args.scope, dry_run=args.dry_run)
    if args.dry_run:
        print(f"Dry run: {result['notes_scanned']} source notes scanned (scope: {result['scope']})")
        print(f"  Notes: {result['note_count']}")
        print(f"  Nodes: {result['node_count']}")
        print(f"  Edges: {result['edge_count']}")
        print(f"  Orphans: {result['orphan_count']}")
        print(f"  Bridge nodes: {result['bridge_count']}")
        print(f"  Weakly connected: {result['weakly_connected_count']}")
        print(f"  Suggested links: {result['suggestion_count']}")
        print(f"  Themes: {result['theme_count']}")
        print(f"  Graphify: {'used' if result['graphify_used'] else 'absent'}")
        print(f"  Semantic: {'available' if result['semantic_available'] else 'absent'}")
        if result.get("central_nodes"):
            print("  Central nodes:")
            for cn in result["central_nodes"][:10]:
                print(f"    {cn}")
        if result.get("relationships"):
            print("  Relationships:")
            for rtype, count in sorted(result["relationships"].items()):
                print(f"    {rtype}: {count}")
    else:
        print(f"Cortex review report: {result.get('report_path', '?')}")
        print(f"  Graph JSON: {result.get('graph_json_path', '?')}")
        print(f"  Mermaid map: {result.get('mermaid_path', '?')}")
        print(f"  Suggested links: {result.get('suggested_links_path', '?')}")
        print(f"  Scope: {result['scope']}")
        print(f"  Notes: {result['note_count']}, Nodes: {result['node_count']}, Edges: {result['edge_count']}")
        print(f"  Orphans: {result['orphan_count']}, Bridges: {result['bridge_count']}")
        print(f"  Suggestions: {result['suggestion_count']}")
        print(f"  Graphify: {'used' if result['graphify_used'] else 'absent'}")
        print(f"  Semantic: {'available' if result['semantic_available'] else 'absent'}")


def cmd_cockpit_status(_: argparse.Namespace) -> None:
    from williamos_cockpit import get_cockpit_status
    status = get_cockpit_status()
    print("Review Cockpit Status")
    print("=" * 40)
    print(f"  Cockpit dir: {'yes' if status['cockpit_dir_exists'] else 'no'}")
    print(f"  Docs exist: {'yes' if status['docs_exist'] else 'no'}")
    print(f"  Lanes: {status['lane_count']}")
    print(f"  Green: {status['green_lanes']}, Yellow: {status['yellow_lanes']}, Red: {status['red_lanes']}")
    if status.get("latest_report"):
        print(f"  Latest report: {status['latest_report']}")
    else:
        print("  Latest report: none")
    if status.get("latest_json"):
        print(f"  Latest JSON: {status['latest_json']}")
    if status.get("latest_html"):
        print(f"  Latest HTML: {status['latest_html']}")


def cmd_cockpit(args: argparse.Namespace) -> None:
    from williamos_cockpit import cockpit
    result = cockpit(dry_run=args.dry_run, html=args.html)
    overall = result["overall_status"]
    lane_count = result["lane_count"]
    review_needed = result["review_needed"]
    total_queue = result["total_queue"]
    if args.dry_run:
        print(f"Dry run: {lane_count} lanes checked")
        print(f"  Overall status: {overall.upper()}")
        print(f"  Lanes needing review: {review_needed}")
        print(f"  Total queue items: {total_queue}")
        queues = result.get("queues", {})
        for k, v in queues.items():
            if v:
                print(f"    {k.replace('_', ' ')}: {v}")
        for lane in result.get("lanes", []):
            icon = {"green": "OK", "yellow": "REVIEW", "red": "ACTION", "unknown": "?"}.get(lane["status"], "?")
            print(f"  [{icon}] {lane['name']}: {lane['summary']}")
        if result.get("actions"):
            print("  Recommended actions:")
            for i, a in enumerate(result["actions"], 1):
                print(f"    {i}. {a}")
    else:
        print(f"Cockpit report: {result.get('report_path', '?')}")
        print(f"  Dashboard JSON: {result.get('json_path', '?')}")
        if result.get("html_path"):
            print(f"  HTML dashboard: {result['html_path']}")
        print(f"  Overall: {overall.upper()}")
        print(f"  Lanes: {lane_count}, Need review: {review_needed}")
        print(f"  Queue: {total_queue} items")


def cmd_git_status(_: argparse.Namespace) -> None:
    from williamos_git import git_status_summary
    s = git_status_summary()
    print("Git Status")
    print("=" * 40)
    print(f"  Git repo: {'yes' if s['is_git_repo'] else 'no'}")
    if s["is_git_repo"]:
        print(f"  Branch: {s['branch'] or '(none)'}")
        print(f"  Has commits: {'yes' if s['has_commits'] else 'no'}")
        if s["latest_commit"]:
            print(f"  Latest commit: {s['latest_commit']}")
        print(f"  Untracked files: {s['untracked_count']}")
        print(f"  Modified files: {s['modified_count']}")
        print(f"  Staged files: {s['staged_count']}")
    print(f"  .gitignore exists: {'yes' if s['gitignore_exists'] else 'no'}")
    print(f"  .gitignore coverage: {s['gitignore_coverage']:.0%}")
    if s["gitignore_missing"]:
        print(f"  Missing .gitignore entries: {len(s['gitignore_missing'])}")
        for m in s["gitignore_missing"][:5]:
            print(f"    {m}")
    if s["forbidden_files"]:
        print(f"  FORBIDDEN files detected: {len(s['forbidden_files'])}")
        for f in s["forbidden_files"][:10]:
            print(f"    {f}")
    elif s["is_git_repo"]:
        print("  Forbidden files: none (safe)")
    if s["suspicious_files"]:
        print(f"  Suspicious filenames: {len(s['suspicious_files'])}")
        for f in s["suspicious_files"][:10]:
            print(f"    {f}")


def cmd_git_init(_: argparse.Namespace) -> None:
    from williamos_git import git_init
    result = git_init()
    if result.get("already_exists"):
        print("Git repository already exists.")
        print("Next steps:")
        print("  python scripts/william.py git-status")
        print("  python scripts/william.py snapshot --dry-run")
    elif result.get("initialized"):
        print("Git repository initialized.")
        print("No remote created. No push will occur.")
        print("Next steps:")
        print("  python scripts/william.py git-status")
        print("  python scripts/william.py snapshot --dry-run")
        print("  python scripts/william.py snapshot --message \"Baseline WilliamOS v1\"")
    else:
        print(f"Error: {result.get('error', 'unknown')}")
        raise SystemExit(1)


def cmd_snapshot(args: argparse.Namespace) -> None:
    if args.dry_run:
        from williamos_git import snapshot_dry_run
        result = snapshot_dry_run()
        if result.get("error"):
            print(f"Error: {result['message']}")
            raise SystemExit(1)
        safe = result["safe"]
        print(f"Snapshot dry run: {'SAFE' if safe else 'BLOCKED'}")
        print(f"  Files to add: {result['would_add_count']}")
        print(f"  Already staged: {result['already_staged_count']}")
        print(f"  Clean files: {result['clean_count']}")
        print(f"  .gitignore coverage: {result['gitignore_coverage']:.0%}")
        if result["forbidden_files"]:
            print(f"  FORBIDDEN ({len(result['forbidden_files'])}):")
            for f in result["forbidden_files"]:
                print(f"    {f}")
        if result["suspicious_files"]:
            print(f"  Suspicious ({len(result['suspicious_files'])}):")
            for f in result["suspicious_files"]:
                print(f"    {f}")
        if result["gitignore_missing"]:
            print(f"  Missing .gitignore entries:")
            for m in result["gitignore_missing"]:
                print(f"    {m}")
        if safe:
            print("  Dry run passed. Safe to commit.")
        else:
            print("  Dry run FAILED. Remove or ignore forbidden files before committing.")
            raise SystemExit(1)
    else:
        if not args.message:
            print("Error: --message is required for snapshot commit.")
            print("Usage: python scripts/william.py snapshot --message \"Your message\"")
            raise SystemExit(1)
        from williamos_git import create_snapshot_commit
        result = create_snapshot_commit(args.message)
        if result.get("error"):
            print(f"Error: {result['error']}: {result['message']}")
            if result.get("forbidden"):
                for f in result["forbidden"]:
                    print(f"  {f}")
            raise SystemExit(1)
        print(f"Snapshot committed: {result['commit_hash']}")
        print(f"  Message: {result['message']}")
        print(f"  Files: {result['files_committed']}")
        print(f"  Manifest: {result['manifest_path']}")
        print("  No push. No remote.")


def cmd_snapshot_manifest(_: argparse.Namespace) -> None:
    from williamos_git import write_snapshot_manifest
    path = write_snapshot_manifest()
    print(f"Snapshot manifest generated: {path}")


def cmd_backup_status(_: argparse.Namespace) -> None:
    from williamos_backup import backup_status
    s = backup_status()
    print("Backup Status")
    print("=" * 40)
    print(f"  Backup dir exists: {'yes' if s['backup_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Git repo: {'yes' if s['git_repo'] else 'no'}")
    if s["git_repo"]:
        print(f"  Branch: {s['branch'] or '(none)'}")
        print(f"  Latest commit: {s['latest_commit'] or '(none)'}")
        print(f"  Clean tree: {'yes' if s['clean_tree'] else 'no'}")
    print(f"  Manifest exists: {'yes' if s['manifest_exists'] else 'no'}")
    print(f"  Local archives: {s['archive_count']}")
    if s["latest_archive"]:
        print(f"  Latest archive: {s['latest_archive']}")


def cmd_backup(args: argparse.Namespace) -> None:
    if args.dry_run:
        from williamos_backup import scan_backup_sources, estimate_backup_size
        scan = scan_backup_sources()
        included = scan["included"]
        excluded = scan["excluded"]
        forbidden = scan["forbidden"]
        size = estimate_backup_size(included)
        print("Backup dry run")
        print("=" * 40)
        print(f"  Files to include: {len(included)}")
        print(f"  Files excluded: {len(excluded)}")
        print(f"  Forbidden files: {len(forbidden)}")
        print(f"  Estimated size: {size:,} bytes ({size / 1024 / 1024:.1f} MB)")
        if forbidden:
            print(f"  FORBIDDEN files detected:")
            for f in forbidden:
                print(f"    {f}")
            print("  Backup BLOCKED. Remove or exclude forbidden files.")
            raise SystemExit(1)
        top_dirs: dict[str, int] = {}
        for f in included:
            parts = f.split("/")
            top = parts[0] if parts else f
            top_dirs[top] = top_dirs.get(top, 0) + 1
        print("  Included by directory:")
        for d, count in sorted(top_dirs.items()):
            print(f"    {d}/ — {count} files")
        print("  Dry run passed. Safe to backup.")
    else:
        if not args.dest:
            print("Error: --dest is required for backup.")
            print("Usage: python scripts/william.py backup --dest <path>")
            print("       python scripts/william.py backup --dry-run")
            raise SystemExit(1)
        from williamos_backup import create_backup_archive
        result = create_backup_archive(args.dest, create_dest=args.create_dest)
        if result.get("error"):
            print(f"Error: {result['error']}: {result['message']}")
            if result.get("forbidden"):
                for f in result["forbidden"]:
                    print(f"  {f}")
            raise SystemExit(1)
        print(f"Backup created: {result['archive_path']}")
        print(f"  Checksum: {result['checksum_path']}")
        print(f"  SHA-256: {result['checksum']}")
        print(f"  Files: {result['files_included']}")
        print(f"  Git files: {result['git_files_included']}")
        print(f"  Excluded: {result['files_excluded']}")
        print(f"  Archive size: {result['archive_size']:,} bytes")
        print("  No push. No sync. No remote.")


def cmd_backup_manifest(_: argparse.Namespace) -> None:
    from williamos_backup import write_backup_manifest
    path = write_backup_manifest()
    print(f"Backup manifest generated: {path}")


def cmd_backup_verify(args: argparse.Namespace) -> None:
    from williamos_backup import verify_backup_archive
    result = verify_backup_archive(args.archive)
    if result.get("error"):
        print(f"Error: {result['error']}: {result['message']}")
        raise SystemExit(1)
    print(f"Backup verification: {'PASSED' if result['passed'] else 'FAILED'}")
    print(f"  Archive: {result['archive']}")
    print(f"  Files: {result['file_count']}")
    print(f"  Git history: {'yes' if result['has_git_history'] else 'no'}")
    if result["checksum_verified"] is not None:
        print(f"  Checksum: {'verified' if result['checksum_verified'] else 'MISMATCH'}")
    else:
        print("  Checksum: no .sha256 file found")
    if result["missing_required"]:
        print(f"  Missing required files:")
        for m in result["missing_required"]:
            print(f"    {m}")
    if result["forbidden_found"]:
        print(f"  FORBIDDEN files in archive:")
        for f in result["forbidden_found"]:
            print(f"    {f}")
    if not result["passed"]:
        raise SystemExit(1)


def cmd_restore_status(_: argparse.Namespace) -> None:
    from williamos_restore import restore_status
    s = restore_status()
    print("Restore Drill Status")
    print("=" * 40)
    print(f"  Restore dir exists: {'yes' if s['restore_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Manifest exists: {'yes' if s['manifest_exists'] else 'no'}")
    print(f"  Latest report: {s['latest_report'] or 'none'}")
    print(f"  Backup dir exists: {'yes' if s['backup_dir_exists'] else 'no'}")
    print(f"  Backup docs: {'yes' if s['backup_docs_exist'] else 'MISSING'}")
    print(f"  Local archives: {s['archive_count']}")
    if s["latest_archive"]:
        print(f"  Latest archive: {s['latest_archive']}")


def cmd_restore_drill(args: argparse.Namespace) -> None:
    archive = args.archive
    if args.latest:
        from williamos_restore import find_latest_archive
        archive = find_latest_archive()
        if not archive:
            print("Error: No local backup archives found.")
            print("Run: python scripts/william.py backup --dest <path>")
            raise SystemExit(1)
        print(f"Using latest archive: {archive}")

    if not archive:
        print("Error: --archive or --latest is required.")
        print("Usage: python scripts/william.py restore-drill --archive <path> --dest <path>")
        raise SystemExit(1)

    if not args.dest:
        print("Error: --dest is required.")
        print("Usage: python scripts/william.py restore-drill --archive <path> --dest <path>")
        raise SystemExit(1)

    from williamos_restore import run_restore_drill
    result = run_restore_drill(archive, args.dest, keep=args.keep)

    if result.get("error"):
        print(f"Error: {result['error']}: {result['message']}")
        raise SystemExit(1)

    print(f"Restore Drill: {'PASSED' if result['passed'] else 'ISSUES FOUND'}")
    print(f"  Confidence: {result['confidence']}")
    print(f"  Archive: {result['archive']}")
    print(f"  Destination: {result['dest']}")
    print(f"  Extracted files: {result['extracted_files']}")

    cs = result["checksum"]
    if cs.get("verified") is True:
        print(f"  Checksum: verified")
    elif cs.get("verified") is False:
        print(f"  Checksum: MISMATCH")
    else:
        print(f"  Checksum: not available")

    req = result["required_files"]
    print(f"  Required files: {'all present' if req['passed'] else 'MISSING'}")
    if not req["passed"]:
        for m in req["missing_files"]:
            print(f"    missing: {m}")
        for d in req["missing_dirs"]:
            print(f"    missing dir: {d}")

    fb = result["forbidden_files"]
    fb_count = len(fb["forbidden"])
    print(f"  Forbidden files: {'none' if fb['passed'] else f'{fb_count} detected'}")

    git = result["git_history"]
    print(f"  Git history: {'present' if git['present'] else 'MISSING'}")
    if git.get("latest_commit"):
        print(f"    Latest: {git['latest_commit']}")

    print("  Health checks:")
    for h in result["health_checks"]:
        status = "PASS" if h["passed"] else "FAIL"
        print(f"    {h['label']}: {status}")

    cl = result["cleanup"]
    if result["keep"]:
        print(f"  Kept for inspection: {result['dest']}")
    else:
        print(f"  Cleanup: {cl.get('message', '')}")

    print(f"  Report: {result['report_path']}")
    print(f"  Manifest: {result['manifest_path']}")

    if not result["passed"]:
        raise SystemExit(1)


def cmd_restore_runtime_proof(args: argparse.Namespace) -> None:
    archive = args.archive
    if args.latest:
        from williamos_restore import find_latest_archive
        archive = find_latest_archive()
        if not archive:
            print("Error: No local backup archives found.")
            print("Run: python scripts/william.py backup --dest <path>")
            raise SystemExit(1)
        print(f"Using latest archive: {archive}")

    if not archive:
        print("Error: --archive or --latest is required.")
        print("Usage: python scripts/william.py restore-runtime-proof --archive <path> --dest <path>")
        raise SystemExit(1)

    if not args.dest:
        print("Error: --dest is required.")
        print("Usage: python scripts/william.py restore-runtime-proof --archive <path> --dest <path>")
        raise SystemExit(1)

    from williamos_restore import run_runtime_proof
    result = run_runtime_proof(archive, args.dest, keep=args.keep)

    if result.get("error"):
        print(f"Error: {result['error']}: {result['message']}")
        raise SystemExit(1)

    print(f"Runtime Proof: {result['confidence']}")
    print(f"  Archive: {result['archive']}")
    print(f"  Destination: {result['dest']}")
    print(f"  Extracted files: {result['extracted_files']}")

    cs = result["checksum"]
    if cs.get("verified") is True:
        print(f"  Checksum: verified")
    elif cs.get("verified") is False:
        print(f"  Checksum: MISMATCH")
    else:
        print(f"  Checksum: not available")

    req = result["required_files"]
    print(f"  Required files: {'all present' if req['passed'] else 'MISSING'}")

    fb = result["forbidden_files"]
    fb_count = len(fb["forbidden"])
    print(f"  Forbidden files: {'none' if fb['passed'] else str(fb_count) + ' detected'}")

    git = result["git_history"]
    print(f"  Git history: {'present' if git['present'] else 'MISSING'}")
    if git.get("latest_commit"):
        print(f"    Latest: {git['latest_commit']}")

    sm = result["smoke_suite"]
    sm_line = f"  Smoke suite: {sm['overall']} ({sm['pass']}/{sm['total']} pass, {sm['critical_fail']} critical fail)"
    print(sm_line)
    for r in sm["results"]:
        if r["status"] != "PASS":
            print(f"    {r['name']}: {r['status']}")

    if result["keep"]:
        print(f"  Kept for inspection: {result['dest']}")
    else:
        cl = result["cleanup"]
        print(f"  Cleanup: {cl.get('message', '')}")

    print(f"  Report: {result['report_path']}")

    if not result["passed"]:
        raise SystemExit(1)


def cmd_restore_manifest(_: argparse.Namespace) -> None:
    from williamos_restore import write_restore_manifest
    path = write_restore_manifest()
    print(f"Restore manifest generated: {path}")


def cmd_remote_status(_: argparse.Namespace) -> None:
    from williamos_remote import remote_status
    s = remote_status()
    print("Remote Status")
    print("=" * 40)
    print(f"  Remote strategy dir: {'yes' if s['remote_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Git repo: {'yes' if s['git_repo'] else 'no'}")
    if s["git_repo"]:
        print(f"  Branch: {s['branch'] or '(none)'}")
        print(f"  Latest commit: {s['latest_commit'] or '(none)'}")
        print(f"  Clean tree: {'yes' if s['clean_tree'] else 'no'}")
    print(f"  Remotes: {len(s['remotes'])}")
    for rm in s["remotes"]:
        print(f"    {rm['name']} → {rm['url']}")
    if s["push_urls"]:
        print(f"  Push URLs: {len(s['push_urls'])}")
        for pu in s["push_urls"]:
            print(f"    {pu}")
    print(f"  Remote state: {s['remote_state']}")
    print(f"  Strategy manifest: {'yes' if s['manifest_exists'] else 'no'}")
    print(f"  Backup manifest: {s['backup_manifest']}")
    print(f"  Restore manifest: {s['restore_manifest']}")
    if s["latest_restore_report"]:
        print(f"  Latest restore report: {s['latest_restore_report']}")


def cmd_remote_strategy(_: argparse.Namespace) -> None:
    from williamos_remote import write_remote_strategy_manifest
    path = write_remote_strategy_manifest()
    print(f"Remote strategy manifest generated: {path}")


def cmd_remote_readiness(args: argparse.Namespace) -> None:
    from williamos_remote import remote_readiness
    r = remote_readiness(provider=args.provider)
    print("Remote Readiness")
    print("=" * 40)
    for c in r["checks"]:
        status = "PASS" if c["passed"] else "FAIL"
        detail = f" ({c['detail']})" if c.get("detail") else ""
        print(f"  {c['check']}: {status}{detail}")
    print(f"  Overall: {'READY' if r['all_passed'] else 'NOT READY'}")
    if r["provider"]:
        print(f"\n  Provider: {r['provider_name']}")
        print("  Guidance:")
        for g in r["guidance"]:
            print(f"    {g}")


def cmd_release_status(_: argparse.Namespace) -> None:
    from williamos_release import release_status
    s = release_status()
    print("Release Status")
    print("=" * 40)
    print(f"  Release governance dir: {'yes' if s['release_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Release manifest: {'yes' if s['manifest_exists'] else 'no'}")
    print(f"  Latest acceptance report: {s['latest_report'] or '(none)'}")
    print(f"  Latest acceptance data: {s['latest_json'] or '(none)'}")
    print(f"  Git repo: {'yes' if s['git_repo'] else 'no'}")
    if s["git_repo"]:
        print(f"  Branch: {s['branch'] or '(none)'}")
        print(f"  Latest commit: {s['latest_commit'] or '(none)'}")
        print(f"  Clean tree: {'yes' if s['clean_tree'] else 'no'}")
        print(f"  Latest tag: {s['latest_tag'] or '(none)'}")
    print(f"  Remotes: {s['remotes']}")
    print(f"  Remote state: {s['remote_state']}")


def cmd_acceptance(args: argparse.Namespace) -> None:
    from williamos_release import run_acceptance_checks, write_acceptance_report, write_acceptance_json
    acceptance = run_acceptance_checks(dry_run=args.dry_run)
    if args.dry_run:
        print("Acceptance Dry Run")
        print("=" * 40)
        for chk in acceptance["checks"]:
            status = "PASS" if chk["passed"] else "FAIL"
            cat = chk["category"].upper()
            print(f"  [{cat}] {chk['name']}: {status}")
        print(f"\n  Overall: {acceptance['overall']}")
        print(f"  Required passed: {acceptance['all_required_pass']}")
        print(f"  Total: {acceptance['total']} | Passed: {acceptance['passed_count']} | Failed: {acceptance['failed_count']}")
        if acceptance["blocking_failures"]:
            print(f"\n  Blocking failures ({len(acceptance['blocking_failures'])}):")
            for b in acceptance["blocking_failures"]:
                print(f"    - {b['name']}")
        if acceptance["warning_failures"]:
            print(f"\n  Warnings ({len(acceptance['warning_failures'])}):")
            for w in acceptance["warning_failures"]:
                print(f"    - {w['name']}")
    else:
        report_path = write_acceptance_report(acceptance)
        json_path = write_acceptance_json(acceptance)
        print(f"Acceptance report: {report_path}")
        print(f"Acceptance data: {json_path}")
        print(f"  Overall: {acceptance['overall']}")
        print(f"  Total: {acceptance['total']} | Passed: {acceptance['passed_count']} | Failed: {acceptance['failed_count']}")
        if acceptance["blocking_failures"]:
            print(f"  Blocking failures: {len(acceptance['blocking_failures'])}")
            for b in acceptance["blocking_failures"]:
                print(f"    - {b['name']}")


def cmd_release_manifest(_: argparse.Namespace) -> None:
    from williamos_release import write_release_manifest
    path = write_release_manifest()
    print(f"Release manifest generated: {path}")


def cmd_release_tag(args: argparse.Namespace) -> None:
    if args.dry_run:
        from williamos_release import release_tag_dry_run
        result = release_tag_dry_run(args.name)
        print("Release Tag Dry Run")
        print("=" * 40)
        print(f"  Tag name: {result['name']}")
        print(f"  Can tag: {'yes' if result['can_tag'] else 'NO'}")
        if result["git"]:
            print(f"  Branch: {result['git']['branch'] or '(none)'}")
            print(f"  Commit: {result['git']['commit'] or '(none)'}")
            print(f"  Clean tree: {'yes' if result['git']['clean'] else 'no'}")
        if result["existing_tags"]:
            print(f"  Existing tags: {', '.join(result['existing_tags'])}")
        if result["acceptance_report"]:
            print(f"  Acceptance report: {result['acceptance_report']}")
        if result["issues"]:
            print(f"\n  Issues ({len(result['issues'])}):")
            for issue in result["issues"]:
                print(f"    - {issue}")
    else:
        from williamos_release import create_release_tag
        result = create_release_tag(args.name)
        if result["created"]:
            print(f"Tag created: {result['name']}")
            print(f"  Hash: {result['hash']}")
            print("  Push performed: no")
        else:
            print(f"Tag NOT created: {result['name']}")
            for issue in result["issues"]:
                print(f"  - {issue}")
            raise SystemExit(1)


def cmd_routine_status(_: argparse.Namespace) -> None:
    from williamos_routine import routine_status
    s = routine_status()
    print("Routine Status")
    print("=" * 40)
    print(f"  Routine dir: {'yes' if s['routine_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Latest daily review: {s['latest_daily'] or '(none)'}")
    print(f"  Latest weekly review: {s['latest_weekly'] or '(none)'}")
    print(f"  Latest monthly review: {s['latest_monthly'] or '(none)'}")
    print(f"  Cockpit available: {'yes' if s['cockpit_available'] else 'no'}")
    if s["cockpit_available"]:
        print(f"  Cockpit: {s['cockpit_green']} green / {s['cockpit_yellow']} yellow / {s['cockpit_red']} red")
    print(f"  Draft queue total: {s['draft_queue_total']}")
    for qn, qc in s["draft_queues"].items():
        if qc > 0:
            print(f"    {qn}: {qc}")
    print(f"  Git clean: {'yes' if s['git_clean'] else 'no'}")
    print(f"  Latest tag: {s['latest_tag'] or '(none)'}")
    print(f"  Archives: {s['archives']}")
    print(f"  Recommended: {s['recommended_action']}")


def cmd_daily_review(args: argparse.Namespace) -> None:
    from williamos_routine import generate_daily_review
    result = generate_daily_review(dry_run=args.dry_run)
    if args.dry_run:
        print("Daily Review Dry Run")
        print("=" * 40)
        print(f"  Date: {result['date']}")
        print(f"  Inbox: {result['inbox_count']} notes")
        cockpit = result["cockpit"]
        if cockpit["available"]:
            print(f"  Cockpit: {cockpit['green']} green / {cockpit['yellow']} yellow / {cockpit['red']} red")
        print(f"  Draft queue: {result['queues']['total']} pending")
        print(f"  Top 3:")
        for t in result["top3"]:
            print(f"    - {t}")
    else:
        print(f"Daily review: {result.get('path', '?')}")
        print(f"  Date: {result['date']}")
        print(f"  Inbox: {result['inbox_count']} notes")
        print(f"  Drafts: {result['queues']['total']} pending")


def cmd_weekly_review(args: argparse.Namespace) -> None:
    from williamos_routine import generate_weekly_operating_review
    result = generate_weekly_operating_review(dry_run=args.dry_run)
    if args.dry_run:
        print("Weekly Review Dry Run")
        print("=" * 40)
        print(f"  Week: {result['week']}")
        print(f"  Inbox: {result['inbox_count']} notes")
        cockpit = result["cockpit"]
        if cockpit["available"]:
            print(f"  Cockpit: {cockpit['green']} green / {cockpit['yellow']} yellow / {cockpit['red']} red")
        print(f"  Draft queue: {result['queues']['total']} pending")
    else:
        print(f"Weekly review: {result.get('path', '?')}")
        print(f"  Week: {result['week']}")
        print(f"  Inbox: {result['inbox_count']} notes")
        print(f"  Drafts: {result['queues']['total']} pending")


def cmd_monthly_review(args: argparse.Namespace) -> None:
    from williamos_routine import generate_monthly_cortex_review
    result = generate_monthly_cortex_review(dry_run=args.dry_run)
    if args.dry_run:
        print("Monthly Review Dry Run")
        print("=" * 40)
        print(f"  Month: {result['month']}")
        print(f"  Cortex data: {'available' if result['cortex_available'] else 'not available'}")
        cockpit = result["cockpit"]
        if cockpit["available"]:
            print(f"  Cockpit: {cockpit['green']} green / {cockpit['yellow']} yellow / {cockpit['red']} red")
        print(f"  Draft queue: {result['queues']['total']} pending")
    else:
        print(f"Monthly review: {result.get('path', '?')}")
        print(f"  Month: {result['month']}")
        print(f"  Cortex: {'available' if result['cortex_available'] else 'not available'}")
        print(f"  Drafts: {result['queues']['total']} pending")


def cmd_review_status(_: argparse.Namespace) -> None:
    from williamos_review import review_status
    s = review_status()
    print("Review Queue Status")
    print("=" * 40)
    print(f"  Review dir: {'yes' if s['review_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Total pending: {s['total_pending']}")
    print(f"  Stale total: {s['stale_total']}")
    print(f"  Oldest pending: {s['oldest_pending'] or '(none)'}")
    print(f"  Newest pending: {s['newest_pending'] or '(none)'}")
    for lane, count in s["lanes"].items():
        if count > 0:
            print(f"    {lane}: {count}")
    print(f"  Latest report: {s['latest_report'] or '(none)'}")
    print(f"  Latest checklist: {s['latest_checklist'] or '(none)'}")
    if s["priority_lanes"]:
        print(f"  Priority lanes: {', '.join(s['priority_lanes'])}")


def cmd_review_queues(args: argparse.Namespace) -> None:
    from williamos_review import generate_review_queue_report, resolve_lane_key
    lane_filter = None
    if args.lane:
        if args.lane == "all":
            lane_filter = None
        else:
            lane_filter = resolve_lane_key(args.lane)
            if lane_filter is None:
                print(f"Unknown lane: {args.lane}")
                raise SystemExit(1)
    result = generate_review_queue_report(lane_filter=lane_filter, dry_run=args.dry_run)
    if args.dry_run:
        print("Review Queues Dry Run")
        print("=" * 40)
        print(f"  Date: {result['date']}")
        print(f"  Total pending: {result['total_pending']}")
        print(f"  Stale: {result['stale_total']}")
        print(f"  Duplicates: {result['duplicate_count']}")
        for l in result["lanes"]:
            if l["item_count"] > 0:
                print(f"    {l['label']}: {l['item_count']} ({l['priority']})")
        if result["high_priority"]:
            print(f"  High priority: {', '.join(result['high_priority'])}")
    else:
        print(f"Review queue report: {result.get('path', '?')}")
        print(f"  Date: {result['date']}")
        print(f"  Total pending: {result['total_pending']}")
        print(f"  Stale: {result['stale_total']}")
        print(f"  Duplicates: {result['duplicate_count']}")
        print(f"  JSON: {result.get('json_path', '?')}")


def cmd_acceptance_checklist(args: argparse.Namespace) -> None:
    from williamos_review import generate_acceptance_checklist, resolve_lane_key
    lane_filter = None
    if args.lane:
        if args.lane == "all":
            lane_filter = None
        else:
            lane_filter = resolve_lane_key(args.lane)
            if lane_filter is None:
                print(f"Unknown lane: {args.lane}")
                raise SystemExit(1)
    result = generate_acceptance_checklist(lane_filter=lane_filter, dry_run=args.dry_run)
    if args.dry_run:
        print("Acceptance Checklist Dry Run")
        print("=" * 40)
        print(f"  Date: {result['date']}")
        print(f"  Lanes with items: {result['lanes_with_items']}")
        print(f"  Total items: {result['total_items']}")
        for l in result["lanes"]:
            print(f"    {l['label']}: {l['item_count']}")
    else:
        print(f"Acceptance checklist: {result.get('path', '?')}")
        print(f"  Date: {result['date']}")
        print(f"  Lanes: {result['lanes_with_items']}")
        print(f"  Items: {result['total_items']}")


def cmd_accept_status(_: argparse.Namespace) -> None:
    from williamos_acceptance import acceptance_status
    s = acceptance_status()
    print("Acceptance Status")
    print("=" * 40)
    print(f"  Acceptance dir: {'yes' if s['acceptance_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Pending drafts: {s['pending_total']}")
    for lane, count in s["lane_counts"].items():
        print(f"    {lane}: {count}")
    print(f"  Acceptance log: {'yes' if s['log_exists'] else 'not yet'}")
    print(f"  Latest entry: {s['latest_entry'] or '(none)'}")
    print(f"  Official folders:")
    for folder, count in s["official_counts"].items():
        print(f"    {folder}: {count} notes")
    if s["git_clean"] is not None:
        print(f"  Git clean: {'yes' if s['git_clean'] else 'no'}")
    print(f"  Snapshot: {'recommended' if not s['git_clean'] else 'not needed'}")


def cmd_accept_plan(args: argparse.Namespace) -> None:
    from williamos_acceptance import generate_acceptance_plan
    result = generate_acceptance_plan(args.draft, args.dest)
    if not result.get("valid"):
        print("Acceptance Plan: BLOCKED")
        for e in result.get("errors", []):
            print(f"  ERROR: {e}")
        raise SystemExit(1)
    print("Acceptance Plan")
    print("=" * 40)
    print(f"  Draft: {result['draft_filename']}")
    print(f"  Lane: {result['lane_type']}")
    print(f"  Source: {result['source_folder']}")
    print(f"  Destination: {result['dest_folder']}")
    print(f"  Proposed: {result['proposed_filename']}")
    print(f"  Duplicate exact: {'BLOCKED' if result['duplicate_exact'] else 'no'}")
    if result["duplicate_similar"]:
        print(f"  Similar notes: {', '.join(result['duplicate_similar'])}")
    sc = result["section_check"]
    if sc["missing"]:
        print(f"  Missing sections: {', '.join(sc['missing'])}")
    else:
        print(f"  Required sections: all present")
    for w in result.get("warnings", []):
        print(f"  WARNING: {w}")
    print(f"  Plan: {result.get('plan_path', '?')}")
    print(f"  Command: {result['command']}")


def cmd_accept_draft(args: argparse.Namespace) -> None:
    from williamos_acceptance import accept_draft
    result = accept_draft(args.draft, args.dest, confirm=args.confirm)
    if not result.get("accepted"):
        err = result.get("error") or "; ".join(result.get("errors", ["Unknown error"]))
        print(f"Acceptance REFUSED: {err}")
        raise SystemExit(1)
    print("Acceptance COMPLETE")
    print("=" * 40)
    print(f"  Draft: {result['draft_path']}")
    print(f"  Official: {result['official_path']}")
    print(f"  Lane: {result['lane']}")
    print(f"  Log: written")
    print(f"  Snapshot: {result['snapshot_recommendation']}")


def cmd_accept_log(_: argparse.Namespace) -> None:
    from williamos_acceptance import read_acceptance_log
    log = read_acceptance_log()
    print("Acceptance Log")
    print("=" * 40)
    print(f"  Path: {log['path']}")
    print(f"  Exists: {'yes' if log['exists'] else 'no'}")
    if not log["exists"]:
        print("  No acceptances yet.")
        return
    print(f"  Total entries: {log['total_entries']}")
    for entry in log["entries"]:
        print(f"\n  [{entry['timestamp']}]")
        for detail in entry["details"]:
            print(f"    {detail}")


def cmd_closure_status(_: argparse.Namespace) -> None:
    from williamos_closure import closure_status
    s = closure_status()
    print("Post-Acceptance Closure Status")
    print("=" * 40)
    print(f"  Closure dir: {'yes' if s['closure_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Acceptance log: {'yes' if s['acceptance_log_exists'] else 'no'}")
    print(f"  Acceptance entries: {s['acceptance_count']}")
    if s.get("latest_acceptance_entry"):
        print(f"  Latest acceptance: {s['latest_acceptance_entry']}")
    if s.get("latest_closure_report"):
        print(f"  Latest closure report: {s['latest_closure_report']}")
    else:
        print("  Latest closure report: none")
    if s.get("latest_closure_checklist"):
        print(f"  Latest closure checklist: {s['latest_closure_checklist']}")
    if s.get("latest_review_queue_report"):
        print(f"  Latest review queue report: {s['latest_review_queue_report']}")
    if s.get("latest_cockpit_report"):
        print(f"  Latest cockpit report: {s['latest_cockpit_report']}")
    if s.get("git_clean") is not None:
        print(f"  Git clean: {'yes' if s['git_clean'] else 'no'}")
    print(f"  Snapshot recommended: {'yes' if s.get('snapshot_recommended') else 'no'}")


def cmd_post_acceptance(args: argparse.Namespace) -> None:
    from williamos_closure import generate_closure_report
    result = generate_closure_report(
        dry_run=args.dry_run,
        refresh_cortex_flag=args.refresh_cortex,
    )
    if args.dry_run:
        print("Post-Acceptance Closure — dry run")
        print("=" * 40)
        print(f"  Date: {result['date']}")
        print(f"  Accepted items: {result['accepted_items']}")
        if result.get("recent_acceptances"):
            for a in result["recent_acceptances"]:
                print(f"    [{a['timestamp']}] {a['lane']}")
        print(f"  Would refresh: {', '.join(result.get('would_refresh', []))}")
        print(f"  Git clean: {result.get('git_clean')}")
    else:
        print("Post-Acceptance Closure Report Generated")
        print("=" * 40)
        print(f"  Date: {result['date']}")
        print(f"  Accepted items: {result['accepted_items']}")
        print(f"  Check passed: {'yes' if result['check_passed'] else 'NO'}")
        print(f"  Review queues refreshed: {'yes' if result['review_queues_refreshed'] else 'no'}")
        print(f"  Cockpit refreshed: {'yes' if result['cockpit_refreshed'] else 'no'}")
        if result.get("cortex_refreshed") is not None:
            print(f"  Cortex refreshed: {'yes' if result['cortex_refreshed'] else 'no'}")
        print(f"  Recommended snapshot message:")
        print(f"    {result['snapshot_message']}")
        print(f"  Report: {result['path']}")
        print(f"  Data: {result['json_path']}")


def cmd_post_acceptance_checklist(_: argparse.Namespace) -> None:
    from williamos_closure import generate_closure_checklist
    result = generate_closure_checklist()
    print("Post-Acceptance Checklist Generated")
    print("=" * 40)
    print(f"  Date: {result['date']}")
    print(f"  Accepted items: {result['accepted_items']}")
    print(f"  Path: {result['path']}")


def cmd_maintenance_status(_: argparse.Namespace) -> None:
    from williamos_maintenance import maintenance_status
    s = maintenance_status()
    print("Maintenance Release Status")
    print("=" * 40)
    print(f"  Maintenance dir: {'yes' if s['maint_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Latest report: {s['latest_report'] or 'none'}")
    print(f"  Manifest: {'yes' if s['manifest_exists'] else 'no'}")
    print(f"  Latest tag: {s['latest_tag'] or 'none'}")
    print(f"  Branch: {s['branch'] or '?'}")
    print(f"  Latest commit: {s['latest_commit'] or '?'}")
    print(f"  Working tree clean: {'yes' if s['clean'] else 'no'}")
    print(f"  Remotes: {s['remote_count']}")


def cmd_maintenance_review(args: argparse.Namespace) -> None:
    from williamos_maintenance import generate_maintenance_report
    result = generate_maintenance_report(dry_run=args.dry_run)
    if args.dry_run:
        print("Maintenance Review — dry run")
        print("=" * 40)
        print(f"  Date: {result['date']}")
        print(f"  Overall: {result['overall']}")
        print(f"  Total checks: {result['total_checks']}")
        print(f"  Post-v1 layers:")
        for l in result.get("layers", []):
            print(f"    {l['wo']} {l['name']}: {'exists' if l['exists'] else 'MISSING'}")
        git = result.get("git", {})
        print(f"  Branch: {git.get('branch', '?')}")
        print(f"  Commit: {git.get('latest_commit', '?')}")
        print(f"  Clean: {git.get('clean', '?')}")
    else:
        print("Maintenance Review Report Generated")
        print("=" * 40)
        print(f"  Date: {result['date']}")
        print(f"  Overall: {result['overall']}")
        print(f"  Passed: {result['passed_count']}/{result['total_checks']}")
        if result['blocking_failures']:
            print(f"  Blocking failures:")
            for b in result['blocking_failures']:
                print(f"    - {b['name']}")
        if result['warning_failures']:
            print(f"  Warnings:")
            for w in result['warning_failures']:
                print(f"    - {w['name']}")
        print(f"  Report: {result['report_path']}")
        print(f"  Data: {result['json_path']}")


def cmd_maintenance_manifest(_: argparse.Namespace) -> None:
    from williamos_maintenance import write_maintenance_manifest
    result = write_maintenance_manifest()
    print("Maintenance Manifest Generated")
    print("=" * 40)
    print(f"  Path: {result['path']}")
    print(f"  Overall from latest report: {result['overall']}")


def cmd_maintenance_tag(args: argparse.Namespace) -> None:
    from williamos_maintenance import maintenance_tag_dry_run, create_maintenance_tag
    if args.dry_run:
        result = maintenance_tag_dry_run(args.name)
        print(f"Maintenance Tag Dry Run — {args.name}")
        print("=" * 40)
        print(f"  Can tag: {'yes' if result['can_tag'] else 'NO'}")
        if result["issues"]:
            print(f"  Issues:")
            for issue in result["issues"]:
                print(f"    - {issue}")
        git = result.get("git", {})
        print(f"  Branch: {git.get('branch', '?')}")
        print(f"  Commit: {git.get('latest_commit', '?')}")
        print(f"  Clean: {git.get('clean', '?')}")
        print(f"  Latest tag: {git.get('latest_tag', 'none')}")
        print(f"  Existing tags: {', '.join(result.get('existing_tags', [])) or 'none'}")
        print(f"  Maintenance overall: {result.get('maintenance_overall', '?')}")
    else:
        result = create_maintenance_tag(args.name)
        if result["created"]:
            print(f"Maintenance Tag Created")
            print("=" * 40)
            print(f"  Tag: {result['name']}")
            print(f"  Hash: {result['hash']}")
            print(f"  Message: {result['message']}")
            print(f"  Push: NOT performed (local only)")
        else:
            print(f"Maintenance Tag FAILED")
            print("=" * 40)
            print(f"  Tag: {result['name']}")
            for issue in result["issues"]:
                print(f"  Issue: {issue}")
            raise SystemExit(1)


def cmd_drive_backup_status(_: argparse.Namespace) -> None:
    from williamos_drive_backup import drive_backup_status
    s = drive_backup_status()
    print("External Drive Backup Status")
    print("=" * 40)
    print(f"  Drive backup dir: {'yes' if s['drive_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Backup log: {'yes' if s['log_exists'] else 'no'}")
    if s.get("latest_log_entry"):
        print(f"  Latest log entry: {s['latest_log_entry']}")
    print(f"  Backup governance: {'yes' if s['backup_governance_exists'] else 'no'}")
    print(f"  Backup archives: {s['backup_archives']}")
    if s.get("latest_archive"):
        print(f"  Latest archive: {s['latest_archive']}")
    if s.get("git_clean") is not None:
        print(f"  Git clean: {'yes' if s['git_clean'] else 'no'}")
    if s.get("latest_tag"):
        print(f"  Latest tag: {s['latest_tag']}")


def cmd_drive_backup_plan(args: argparse.Namespace) -> None:
    from williamos_drive_backup import generate_backup_plan
    result = generate_backup_plan(dest_str=args.dest, dry_run=args.dry_run)
    if args.dry_run:
        print("Drive Backup Plan — dry run")
        print("=" * 40)
        print(f"  Destination: {result['dest']}")
        print(f"  Valid: {'yes' if result['valid'] else 'NO'}")
        if result["issues"]:
            for issue in result["issues"]:
                print(f"  Issue: {issue}")
        if result.get("warnings"):
            for w in result["warnings"]:
                print(f"  Warning: {w}")
        print(f"  Estimated size: {result['estimated_size']}")
        print(f"  Free space: {result.get('free_space', 'unknown')}")
        print(f"  Archive name: {result['archive_name']}")
        print(f"  Backup command:")
        print(f"    {result['backup_command']}")
    else:
        print("Drive Backup Plan Generated")
        print("=" * 40)
        print(f"  Destination: {result['dest']}")
        print(f"  Valid: {'yes' if result['valid'] else 'NO'}")
        if result["issues"]:
            for issue in result["issues"]:
                print(f"  Issue: {issue}")
        print(f"  Estimated size: {result['estimated_size']}")
        print(f"  Free space: {result.get('free_space', 'unknown')}")
        print(f"  Plan: {result.get('plan_path', 'none')}")


def cmd_drive_backup(args: argparse.Namespace) -> None:
    from williamos_drive_backup import run_drive_backup
    result = run_drive_backup(dest_str=args.dest)
    if result["success"]:
        print("External Drive Backup Complete")
        print("=" * 40)
        print(f"  Archive: {result['archive_path']}")
        print(f"  Checksum: {result['checksum']}")
        print(f"  Files: {result['files_included']}")
        print(f"  Verified: {'PASS' if result['verified'] else 'FAIL'}")
        if result.get("verification_issues"):
            for issue in result["verification_issues"]:
                print(f"  Verify issue: {issue}")
        print(f"  Log written: yes")
        print(f"  Restore drill:")
        print(f"    {result['restore_drill_command']}")
    else:
        print("External Drive Backup FAILED")
        print("=" * 40)
        print(f"  Error: {result.get('error', 'unknown')}")
        if result.get("issues"):
            for issue in result["issues"]:
                print(f"  Issue: {issue}")
        if result.get("detail"):
            print(f"  Detail: {result['detail']}")
        raise SystemExit(1)


def cmd_drive_backup_log(_: argparse.Namespace) -> None:
    from williamos_drive_backup import read_drive_backup_log
    log = read_drive_backup_log()
    print("External Drive Backup Log")
    print("=" * 40)
    print(f"  Path: {log['path']}")
    print(f"  Exists: {'yes' if log['exists'] else 'no'}")
    if not log["exists"]:
        print("  No drive backups logged yet.")
        return
    print(f"  Total entries: {log.get('total', 0)}")
    for entry in log["entries"]:
        print(f"\n  [{entry['timestamp']}]")
        for detail in entry.get("details", []):
            print(f"    {detail}")


def cmd_concept_status(_: argparse.Namespace) -> None:
    from williamos_concepts import get_concept_status
    status = get_concept_status()
    print("Concept Promotion Status")
    print("=" * 40)
    print(f"  Official ideas dir: {'yes' if status['ideas_dir_exists'] else 'no'}")
    print(f"  Official idea/concept notes: {status['official_idea_count']}")
    print(f"  Promotion dir: {'yes' if status['promotion_dir_exists'] else 'no'}")
    print(f"  Promotion docs: {'yes' if status['promotion_docs_exist'] else 'no'}")
    print(f"  Existing drafts: {status['existing_drafts_count']}")
    print(f"  Synthesis reports: {status['synthesis_reports']}")
    print(f"  Inbox triage reports: {status['inbox_triage_reports']}")
    print(f"  Learning notes: {status['learning_notes']}")
    print(f"  Case notes: {status['case_notes']}")
    print(f"  Project notes: {status['project_notes']}")
    if status.get("last_report"):
        print(f"  Last promotion report: {status['last_report']}")
    else:
        print("  Last promotion report: none")
    print(f"  Semantic: {status['semantic_available']}")


def cmd_promote_concepts(args: argparse.Namespace) -> None:
    from williamos_concepts import promote_concepts
    result = promote_concepts(source=args.source, dry_run=args.dry_run)
    total = result["total_candidates"]
    mode = result["mode"]
    high = len(result["high"])
    medium = len(result["medium"])
    low = len(result["low"])
    if args.dry_run:
        print(f"Dry run: {result['total_files_scanned']} source files scanned (scope: {args.source})")
        print(f"  Mode: {mode}")
        print(f"  Concept candidates: {total}")
        print(f"  High confidence: {high}")
        print(f"  Medium confidence: {medium}")
        print(f"  Low / needs review: {low}")
        if result["candidates"]:
            print("  Candidates:")
            for c in result["candidates"][:15]:
                sim_flag = " [possible duplicate]" if c["similar_existing_concepts"] else ""
                print(f"    {c['candidate_title']} ({c['confidence']}){sim_flag}")
    else:
        print(f"Concept promotion report: {result.get('report_path', '?')}")
        print(f"  Mode: {mode}")
        print(f"  Files scanned: {result['total_files_scanned']}")
        print(f"  Candidates: {total} (high: {high}, medium: {medium}, low: {low})")
        if result.get("draft_paths"):
            print(f"  Drafts created: {len(result['draft_paths'])}")
            for dp in result["draft_paths"][:10]:
                print(f"    {dp}")


def cmd_inbox_status(_: argparse.Namespace) -> None:
    from williamos_inbox import get_inbox_status
    status = get_inbox_status()
    print("Inbox Processor Status")
    print("=" * 40)
    print(f"  Inbox exists: {'yes' if status['inbox_exists'] else 'no'}")
    print(f"  Inbox notes: {status['inbox_count']}")
    if status.get("oldest"):
        print(f"  Oldest: {status['oldest']}")
    if status.get("newest"):
        print(f"  Newest: {status['newest']}")
    print(f"  Processor docs: {'yes' if status['processor_docs_exist'] else 'no'}")
    if status.get("last_report"):
        print(f"  Last report: {status['last_report']}")
    else:
        print("  Last report: none")
    print(f"  Semantic: {status['semantic_available']}")


def cmd_process_inbox(args: argparse.Namespace) -> None:
    import datetime as _dt
    from williamos_inbox import process_inbox
    since = None
    if args.since:
        try:
            since = _dt.date.fromisoformat(args.since)
        except ValueError:
            print(f"Invalid date: {args.since}")
            raise SystemExit(1)
    result = process_inbox(since=since, dry_run=args.dry_run, promote_drafts=args.promote_drafts)
    total = result["total"]
    mode = result["mode"]
    high = len(result["high"])
    medium = len(result["medium"])
    low = len(result["low"])
    loops = len(result["open_loops"])
    seeds = len(result["wo_seeds"])
    noise = len(result["noise"])
    if args.dry_run:
        print(f"Dry run: {total} inbox notes scanned")
        print(f"  Mode: {mode}")
        print(f"  High confidence: {high}")
        print(f"  Medium confidence: {medium}")
        print(f"  Low / needs review: {low}")
        print(f"  Open loops: {loops}")
        print(f"  WO seeds: {seeds}")
        print(f"  Archive/noise: {noise}")
        if result["items"]:
            print("  Notes:")
            for item in result["items"][:20]:
                cat = item["primary"]["category"] if item["primary"] else "unknown"
                conf = item["primary"]["confidence"] if item["primary"] else "?"
                print(f"    {item['note']['rel']} -> {cat} ({conf})")
    else:
        print(f"Triage report: {result.get('report_path', '?')}")
        print(f"  Mode: {mode}")
        print(f"  Notes processed: {total}")
        print(f"  High: {high}, Medium: {medium}, Low: {low}")
        if result.get("draft_paths"):
            print(f"  Promoted drafts: {len(result['draft_paths'])}")
            for dp in result["draft_paths"][:10]:
                print(f"    {dp}")


def cmd_runtime_status(_: argparse.Namespace) -> None:
    from williamos_smoke import runtime_status
    status = runtime_status()
    print("Runtime Smoke Status")
    print("=" * 40)
    print(f"  Smoke dir: {'yes' if status['smoke_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if status['docs_exist'] else 'MISSING'}")
    print(f"  Smoke commands: {status['smoke_commands']}")
    print(f"  Critical commands: {status['critical_commands']}")
    if status.get("latest_report"):
        print(f"  Latest report: {status['latest_report']}")
    else:
        print("  Latest report: none")


def cmd_runtime_smoke(args: argparse.Namespace) -> None:
    from williamos_smoke import run_smoke
    result = run_smoke(dry_run=args.dry_run)
    if args.dry_run:
        print("Runtime Smoke (dry run)")
        print("=" * 40)
        print(f"  Commands: {result['total']}")
        print(f"  Would run all status/check commands")
        print(f"  Critical: {sum(1 for r in result['results'] if r['critical'])}")
    else:
        print(f"Runtime Smoke: {result['overall']}")
        print("=" * 40)
        print(f"  Commands: {result['total']}")
        print(f"  Pass: {result['pass']}")
        print(f"  Fail: {result['fail']}")
        print(f"  Critical failures: {result['critical_fail']}")
        if result.get("report_path"):
            print(f"  Report: {result['report_path']}")
        for r in result["results"]:
            if r["status"] not in ("PASS",):
                label = "INFO" if r.get("info") else "FAIL"
                print(f"  {label}: {r['name']} — {r['status']}")


def cmd_production_status(_: argparse.Namespace) -> None:
    from williamos_production import production_status
    s = production_status()
    print("Production Readiness Status")
    print("=" * 40)
    print(f"  Production dir exists: {'yes' if s['prod_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if s['docs_exist'] else 'MISSING'}")
    print(f"  Latest report: {s['latest_report'] or 'none'}")


def cmd_production_readiness(_: argparse.Namespace) -> None:
    from williamos_production import run_production_readiness
    result = run_production_readiness()
    print(f"Production Readiness: {result['verdict']}")
    print(f"  Checks: {result['passed']}/{result['total']} passed")
    print("")
    for c in result["checks"]:
        status = "PASS" if c["passed"] else "FAIL"
        print(f"  [{status}] {c['name']}: {c.get('detail', '')[:60]}")
    print("")
    print(f"  Report: {result['report_path']}")
    if result["verdict"] == "FAIL":
        raise SystemExit(1)


def cmd_help_all(_: argparse.Namespace) -> None:
    from williamos_commands import COMMAND_GROUPS
    print("WilliamOS CLI — All Commands")
    print("=" * 50)
    total = 0
    for gn, gd in COMMAND_GROUPS.items():
        print(f"\n  [{gn}] {gd['description']}")
        for cmd in gd["commands"]:
            safe = "" if cmd.get("safe", True) else " [!]"
            print(f"    {cmd['name']:<30} {cmd['purpose']}{safe}")
            total += 1
    print(f"\n  Total: {total} commands")


def cmd_command_status(_: argparse.Namespace) -> None:
    from williamos_commands import command_status
    status = command_status()
    print("Command Registry Status")
    print("=" * 40)
    print(f"  Registry dir: {'yes' if status['cmd_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if status['docs_exist'] else 'MISSING'}")
    print(f"  Registry commands: {status['registry_count']}")
    print(f"  CLI commands: {status['cli_count']}")
    print(f"  Groups: {status['groups']}")
    print(f"  Safe commands: {status['safe_count']}")
    print(f"  Write commands: {status['write_count']}")
    if status.get("latest_report"):
        print(f"  Latest report: {status['latest_report']}")
    else:
        print("  Latest report: none")


def cmd_command_report(args: argparse.Namespace) -> None:
    from williamos_commands import generate_command_report
    result = generate_command_report(dry_run=args.dry_run)
    if args.dry_run:
        print("Command Report (dry run)")
        print("=" * 40)
        print(f"  Registry: {result['registry_count']}")
        print(f"  CLI: {result['cli_count']}")
        print(f"  Match: {'YES' if result['match'] else 'NO'}")
        print(f"  Groups: {result['groups']}")
        print(f"  Safe: {result['safe']}")
        print(f"  Write: {result['write']}")
    else:
        print(f"Command report: {result['report_path']}")
        print(f"  Registry: {result['registry_count']}")
        print(f"  CLI: {result['cli_count']}")
        print(f"  Match: {'YES' if result['match'] else 'NO'}")


def cmd_schema_status(_: argparse.Namespace) -> None:
    from williamos_schema import schema_status
    status = schema_status()
    print("Schema Registry Status")
    print("=" * 40)
    print(f"  Schema dir: {'yes' if status['schema_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if status['docs_exist'] else 'MISSING'}")
    print(f"  Schemas defined: {status['schema_count']}")
    print(f"  Check: {'PASS' if status['check_pass'] else 'FAIL'}")
    if status["issues"]:
        print(f"  Issues: {status['issues']}")
    if status.get("latest_report"):
        print(f"  Latest report: {status['latest_report']}")
    else:
        print("  Latest report: none")


def cmd_schema_check(_: argparse.Namespace) -> None:
    from williamos_schema import schema_check
    result = schema_check()
    print("Schema Check")
    print("=" * 40)
    print(f"  Schemas: {result['schema_count']}")
    print(f"  Template checks: {result['template_checks']}")
    print(f"  Result: {'PASS' if result['pass'] else 'FAIL'}")
    if result["issues"]:
        for issue in result["issues"]:
            print(f"  - {issue}")


def cmd_schema_report(args: argparse.Namespace) -> None:
    from williamos_schema import generate_schema_report
    result = generate_schema_report(dry_run=args.dry_run)
    if args.dry_run:
        print("Schema Report (dry run)")
        print("=" * 40)
        print(f"  Schemas: {result['schema_count']}")
        print(f"  Check: {'PASS' if result['check_pass'] else 'FAIL'}")
        print(f"  Template checks: {result['template_checks']}")
        print(f"  Templates valid: {result['templates_valid']}/{result['template_checks']}")
        if result["issues"]:
            for issue in result["issues"]:
                print(f"  - {issue}")
    else:
        print(f"Schema report: {result['report_path']}")
        print(f"  Schemas: {result['schema_count']}")
        print(f"  Check: {'PASS' if result['check_pass'] else 'FAIL'}")
        print(f"  Templates valid: {result['templates_valid']}/{result['template_checks']}")


def cmd_obsidian_status(_: argparse.Namespace) -> None:
    from williamos_workspace import workspace_status
    status = workspace_status()
    print("Obsidian Workspace Status")
    print("=" * 40)
    print(f"  Workspace dir: {'yes' if status['workspace_dir_exists'] else 'no'}")
    print(f"  Governance docs: {'yes' if status['docs_exist'] else 'MISSING'}")
    print(f"  Folder READMEs: {status['folder_readmes']}")
    print(f"  Dashboards: {status['dashboards']}")
    print(f"  Templates: {status['templates']}")
    if status.get("latest_report"):
        print(f"  Latest report: {status['latest_report']}")
    else:
        print("  Latest report: none")


def cmd_obsidian_quality(args: argparse.Namespace) -> None:
    from williamos_workspace import generate_quality_report
    result = generate_quality_report(dry_run=args.dry_run)
    if args.dry_run:
        print("Workspace Quality (dry run)")
        print("=" * 40)
        print(f"  Date: {result['date']}")
        print(f"  Folder READMEs: {result['folder_readmes']}")
        print(f"  Content notes: {result['total_notes']}")
        print(f"  Avg links/note: {result['avg_links']}")
        print(f"  Frontmatter coverage: {result['frontmatter_pct']}%")
        print(f"  Dashboards: {result['dashboards']}")
        print(f"  Templates: {result['templates']}")
        if result.get("top_tags"):
            print(f"  Top tags: {', '.join(result['top_tags'][:5])}")
    else:
        print(f"Workspace quality report: {result['report_path']}")
        print(f"  Content notes: {result['total_notes']}")
        print(f"  Folder READMEs: {result['folder_readmes']}")
        print(f"  Frontmatter coverage: {result['frontmatter_pct']}%")
        print(f"  Avg links/note: {result['avg_links']}")
        print(f"  Dashboards: {result['dashboards']}")
        print(f"  Templates: {result['templates']}")


def cmd_control_center(args: argparse.Namespace) -> None:
    from williamos_control_center import start
    sys.exit(start(open_browser=not args.no_open))


def cmd_control_center_stop(_: argparse.Namespace) -> None:
    from williamos_control_center import stop
    sys.exit(stop())


def cmd_control_center_restart(args: argparse.Namespace) -> None:
    from williamos_control_center import restart
    sys.exit(restart(open_browser=not args.no_open))


def cmd_control_center_status(_: argparse.Namespace) -> None:
    from williamos_control_center import status
    sys.exit(status())


def cmd_control_center_build(_: argparse.Namespace) -> None:
    from williamos_control_center import build_frontend
    ok = build_frontend()
    sys.exit(0 if ok else 1)


def cmd_control_center_smoke(_: argparse.Namespace) -> None:
    from williamos_control_center import smoke
    sys.exit(smoke())


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="william", description="WilliamOS personal brain CLI")
    sub = p.add_subparsers(required=True, dest="command")

    sub.add_parser("init", help="Initialize vault scaffold").set_defaults(func=cmd_init)
    sub.add_parser("today", help="Create today's daily note").set_defaults(func=cmd_today)
    sub.add_parser("weekly", help="Create this week's review note").set_defaults(func=cmd_weekly)

    inbox = sub.add_parser("inbox", help="Capture a quick thought")
    inbox.add_argument("text", help="The thought to capture")
    inbox.set_defaults(func=cmd_inbox)

    decision = sub.add_parser("decision", help="Create a decision record")
    decision.add_argument("title", help="Decision title")
    decision.add_argument("--area", default="personal", help="Area (default: personal)")
    decision.add_argument("--review", help="Review date (default: 30 days from now)")
    decision.set_defaults(func=cmd_decision)

    doctrine = sub.add_parser("doctrine", help="Create a doctrine note")
    doctrine.add_argument("title", help="Doctrine title")
    doctrine.add_argument("--area", default="personal", help="Area (default: personal)")
    doctrine.set_defaults(func=cmd_doctrine)

    concept = sub.add_parser("concept", help="Create a concept note")
    concept.add_argument("title", help="Concept title")
    concept.add_argument("--area", default="personal", help="Area (default: personal)")
    concept.set_defaults(func=cmd_concept)

    case = sub.add_parser("case", help="Create a case analysis note")
    case.add_argument("title", help="Case title")
    case.add_argument("--case-type", default="general", help="Case type (default: general)")
    case.set_defaults(func=cmd_case)

    sub.add_parser("check", help="Run vault governance checks").set_defaults(func=cmd_check)
    sub.add_parser("mcp-check", help="Check MCP readiness").set_defaults(func=cmd_mcp_check)
    sub.add_parser("orphans", help="Find unlinked notes").set_defaults(func=cmd_orphans)
    sub.add_parser("stale-decisions", help="Find decisions past review date").set_defaults(func=cmd_stale_decisions)

    graph = sub.add_parser("graph", help="Run Graphify on vault")
    graph.add_argument("--target", help="Specific folder to graph")
    graph.set_defaults(func=cmd_graph)

    synth_week = sub.add_parser("synth-week", help="Generate weekly synthesis")
    synth_week.add_argument("--week", help="ISO week (e.g. 2026-W25)")
    synth_week.add_argument("--dry-run", action="store_true", help="Preview without writing")
    synth_week.set_defaults(func=cmd_synth_week)

    sub.add_parser("synth-status", help="Show weekly synthesis status").set_defaults(func=cmd_synth_status)

    sub.add_parser("semantic-index", help="Build semantic search index").set_defaults(func=cmd_semantic_index)

    sem_search = sub.add_parser("semantic-search", help="Search the vault semantically")
    sem_search.add_argument("query", help="Search query")
    sem_search.add_argument("--top", type=int, default=8, help="Number of results (default: 8)")
    sem_search.set_defaults(func=cmd_semantic_search)

    sub.add_parser("semantic-status", help="Show semantic search status").set_defaults(func=cmd_semantic_status)

    sem_clear = sub.add_parser("semantic-clear", help="Delete search index")
    sem_clear.add_argument("--confirm", action="store_true", help="Confirm deletion")
    sem_clear.set_defaults(func=cmd_semantic_clear)

    sub.add_parser("inbox-status", help="Show inbox processor status").set_defaults(func=cmd_inbox_status)

    proc_inbox = sub.add_parser("process-inbox", help="Process inbox notes")
    proc_inbox.add_argument("--dry-run", action="store_true", help="Preview without writing")
    proc_inbox.add_argument("--since", help="Only process notes modified since YYYY-MM-DD")
    proc_inbox.add_argument("--promote-drafts", action="store_true", help="Create promoted draft notes")
    proc_inbox.set_defaults(func=cmd_process_inbox)

    sub.add_parser("doctrine-status", help="Show doctrine promotion status").set_defaults(func=cmd_doctrine_status)

    promote = sub.add_parser("promote-doctrine", help="Promote doctrine candidates")
    promote.add_argument("--dry-run", action="store_true", help="Preview without writing")
    promote.add_argument("--source", default="all", choices=["inbox", "synthesis", "all"], help="Source scope (default: all)")
    promote.set_defaults(func=cmd_promote_doctrine)

    sub.add_parser("decision-status", help="Show decision promotion status").set_defaults(func=cmd_decision_status)

    promote_dec = sub.add_parser("promote-decisions", help="Promote decision candidates")
    promote_dec.add_argument("--dry-run", action="store_true", help="Preview without writing")
    promote_dec.add_argument("--source", default="all", choices=["inbox", "synthesis", "all"], help="Source scope (default: all)")
    promote_dec.set_defaults(func=cmd_promote_decisions)

    sub.add_parser("concept-status", help="Show concept promotion status").set_defaults(func=cmd_concept_status)

    promote_con = sub.add_parser("promote-concepts", help="Promote concept candidates")
    promote_con.add_argument("--dry-run", action="store_true", help="Preview without writing")
    promote_con.add_argument("--source", default="all", choices=["inbox", "synthesis", "ideas", "all"], help="Source scope (default: all)")
    promote_con.set_defaults(func=cmd_promote_concepts)

    sub.add_parser("cortex-status", help="Show cortex map status").set_defaults(func=cmd_cortex_status)

    cortex = sub.add_parser("cortex-map", help="Generate cortex map")
    cortex.add_argument("--dry-run", action="store_true", help="Preview without writing")
    cortex.add_argument("--scope", default="all", choices=["core", "promotions", "all"], help="Source scope (default: all)")
    cortex.set_defaults(func=cmd_cortex_map)

    sub.add_parser("cockpit-status", help="Show review cockpit status").set_defaults(func=cmd_cockpit_status)

    cockpit_cmd = sub.add_parser("cockpit", help="Generate review cockpit dashboard")
    cockpit_cmd.add_argument("--dry-run", action="store_true", help="Preview without writing")
    cockpit_cmd.add_argument("--html", action="store_true", help="Also generate standalone HTML dashboard")
    cockpit_cmd.set_defaults(func=cmd_cockpit)

    sub.add_parser("project-status", help="Show project/WO promotion status").set_defaults(func=cmd_project_status)

    promote_proj = sub.add_parser("promote-projects", help="Promote project/WO candidates")
    promote_proj.add_argument("--dry-run", action="store_true", help="Preview without writing")
    promote_proj.add_argument("--source", default="all", choices=["inbox", "synthesis", "ideas", "all"], help="Source scope (default: all)")
    promote_proj.set_defaults(func=cmd_promote_projects)

    sub.add_parser("git-status", help="Show Git repo status and safety checks").set_defaults(func=cmd_git_status)
    sub.add_parser("git-init", help="Initialize Git repository (no remote)").set_defaults(func=cmd_git_init)

    snap = sub.add_parser("snapshot", help="Create a Git snapshot")
    snap.add_argument("--dry-run", action="store_true", help="Preview without committing")
    snap.add_argument("--message", help="Commit message for the snapshot")
    snap.set_defaults(func=cmd_snapshot)

    sub.add_parser("snapshot-manifest", help="Generate snapshot manifest").set_defaults(func=cmd_snapshot_manifest)

    sub.add_parser("backup-status", help="Show backup readiness and status").set_defaults(func=cmd_backup_status)

    bkp = sub.add_parser("backup", help="Create a backup archive")
    bkp.add_argument("--dry-run", action="store_true", help="Preview what would be backed up")
    bkp.add_argument("--dest", help="Destination folder for the backup archive")
    bkp.add_argument("--create-dest", action="store_true", help="Create destination if it doesn't exist")
    bkp.set_defaults(func=cmd_backup)

    sub.add_parser("backup-manifest", help="Generate/update backup manifest").set_defaults(func=cmd_backup_manifest)

    bkv = sub.add_parser("backup-verify", help="Verify a backup archive")
    bkv.add_argument("archive", help="Path to the backup archive zip file")
    bkv.set_defaults(func=cmd_backup_verify)

    sub.add_parser("restore-status", help="Show restore drill readiness and status").set_defaults(func=cmd_restore_status)

    rdrill = sub.add_parser("restore-drill", help="Run a restore drill against a backup archive")
    rdrill.add_argument("--archive", help="Path to backup archive zip file")
    rdrill.add_argument("--latest", action="store_true", help="Use the latest local backup archive")
    rdrill.add_argument("--dest", help="Destination folder for restore extraction")
    rdrill.add_argument("--keep", action="store_true", help="Keep restored folder for inspection")
    rdrill.set_defaults(func=cmd_restore_drill)

    rproof = sub.add_parser("restore-runtime-proof", help="Run full runtime proof against restored backup")
    rproof.add_argument("--archive", help="Path to backup archive zip file")
    rproof.add_argument("--latest", action="store_true", help="Use the latest local backup archive")
    rproof.add_argument("--dest", help="Destination folder for restore extraction")
    rproof.add_argument("--keep", action="store_true", help="Keep restored folder for inspection")
    rproof.set_defaults(func=cmd_restore_runtime_proof)

    sub.add_parser("restore-manifest", help="Generate/update restore manifest").set_defaults(func=cmd_restore_manifest)

    sub.add_parser("remote-status", help="Show remote protection status").set_defaults(func=cmd_remote_status)
    sub.add_parser("remote-strategy", help="Generate remote strategy manifest").set_defaults(func=cmd_remote_strategy)

    rr = sub.add_parser("remote-readiness", help="Check readiness for remote protection")
    rr.add_argument("--provider", choices=["github-private", "external-drive", "encrypted-archive", "syncthing", "obsidian-sync"], help="Provider-specific guidance")
    rr.set_defaults(func=cmd_remote_readiness)

    sub.add_parser("release-status", help="Show release governance status").set_defaults(func=cmd_release_status)

    acc = sub.add_parser("acceptance", help="Run v1 acceptance review")
    acc.add_argument("--dry-run", action="store_true", help="Preview checks without writing report")
    acc.set_defaults(func=cmd_acceptance)

    sub.add_parser("release-manifest", help="Generate/update release manifest").set_defaults(func=cmd_release_manifest)

    rtag = sub.add_parser("release-tag", help="Create a local release tag")
    rtag.add_argument("--name", required=True, help="Tag name (e.g. v1.0.0)")
    rtag.add_argument("--dry-run", action="store_true", help="Preview without creating tag")
    rtag.set_defaults(func=cmd_release_tag)

    sub.add_parser("routine-status", help="Show operating routine status").set_defaults(func=cmd_routine_status)

    dr = sub.add_parser("daily-review", help="Generate daily review note")
    dr.add_argument("--dry-run", action="store_true", help="Preview without writing")
    dr.set_defaults(func=cmd_daily_review)

    wr = sub.add_parser("weekly-review", help="Generate weekly operating review")
    wr.add_argument("--dry-run", action="store_true", help="Preview without writing")
    wr.set_defaults(func=cmd_weekly_review)

    mr = sub.add_parser("monthly-review", help="Generate monthly cortex review")
    mr.add_argument("--dry-run", action="store_true", help="Preview without writing")
    mr.set_defaults(func=cmd_monthly_review)

    sub.add_parser("review-status", help="Show human review queue status").set_defaults(func=cmd_review_status)

    rq = sub.add_parser("review-queues", help="Generate review queue report")
    rq.add_argument("--dry-run", action="store_true", help="Preview without writing")
    rq.add_argument("--lane", default=None, help="Filter to lane (doctrine, decisions, concepts, projects, work-orders, all)")
    rq.set_defaults(func=cmd_review_queues)

    ac = sub.add_parser("acceptance-checklist", help="Generate acceptance checklist")
    ac.add_argument("--dry-run", action="store_true", help="Preview without writing")
    ac.add_argument("--lane", default=None, help="Filter to lane (doctrine, decisions, concepts, projects, work-orders, all)")
    ac.set_defaults(func=cmd_acceptance_checklist)

    sub.add_parser("accept-status", help="Show acceptance assistant status").set_defaults(func=cmd_accept_status)

    ap = sub.add_parser("accept-plan", help="Generate acceptance plan for a draft")
    ap.add_argument("--draft", required=True, help="Path to draft file")
    ap.add_argument("--dest", default=None, help="Override destination folder")
    ap.set_defaults(func=cmd_accept_plan)

    ad = sub.add_parser("accept-draft", help="Accept a draft into official folder")
    ad.add_argument("--draft", required=True, help="Path to draft file")
    ad.add_argument("--dest", required=True, help="Destination folder")
    ad.add_argument("--confirm", action="store_true", help="Required to actually perform the move")
    ad.set_defaults(func=cmd_accept_draft)

    sub.add_parser("accept-log", help="Show acceptance log").set_defaults(func=cmd_accept_log)

    sub.add_parser("closure-status", help="Show post-acceptance closure status").set_defaults(func=cmd_closure_status)

    pa = sub.add_parser("post-acceptance", help="Generate post-acceptance closure report")
    pa.add_argument("--dry-run", action="store_true", help="Preview without writing")
    pa.add_argument("--refresh-cortex", action="store_true", help="Also refresh cortex map")
    pa.set_defaults(func=cmd_post_acceptance)

    sub.add_parser("post-acceptance-checklist", help="Generate post-acceptance checklist").set_defaults(func=cmd_post_acceptance_checklist)

    sub.add_parser("maintenance-status", help="Show maintenance release status").set_defaults(func=cmd_maintenance_status)

    mrev = sub.add_parser("maintenance-review", help="Run maintenance review checks")
    mrev.add_argument("--dry-run", action="store_true", help="Preview without writing")
    mrev.set_defaults(func=cmd_maintenance_review)

    sub.add_parser("maintenance-manifest", help="Generate maintenance manifest").set_defaults(func=cmd_maintenance_manifest)

    mtag = sub.add_parser("maintenance-tag", help="Create maintenance release tag")
    mtag.add_argument("--name", required=True, help="Tag name (e.g. v1.1.0)")
    mtag.add_argument("--dry-run", action="store_true", help="Preview without creating tag")
    mtag.set_defaults(func=cmd_maintenance_tag)

    sub.add_parser("drive-backup-status", help="Show external drive backup status").set_defaults(func=cmd_drive_backup_status)

    dbp = sub.add_parser("drive-backup-plan", help="Generate external drive backup plan")
    dbp.add_argument("--dest", required=True, help="Destination folder path")
    dbp.add_argument("--dry-run", action="store_true", help="Preview without writing")
    dbp.set_defaults(func=cmd_drive_backup_plan)

    db = sub.add_parser("drive-backup", help="Run backup to external drive")
    db.add_argument("--dest", required=True, help="Destination folder path")
    db.set_defaults(func=cmd_drive_backup)

    sub.add_parser("drive-backup-log", help="Show external drive backup log").set_defaults(func=cmd_drive_backup_log)

    sub.add_parser("runtime-status", help="Show runtime smoke status").set_defaults(func=cmd_runtime_status)

    rs = sub.add_parser("runtime-smoke", help="Run runtime smoke suite")
    rs.add_argument("--dry-run", action="store_true", help="Preview without running")
    rs.set_defaults(func=cmd_runtime_smoke)

    sub.add_parser("help-all", help="Show all commands grouped").set_defaults(func=cmd_help_all)
    sub.add_parser("command-status", help="Show command registry status").set_defaults(func=cmd_command_status)

    cr = sub.add_parser("command-report", help="Generate command report")
    cr.add_argument("--dry-run", action="store_true", help="Preview without writing")
    cr.set_defaults(func=cmd_command_report)

    sub.add_parser("schema-status", help="Show schema registry status").set_defaults(func=cmd_schema_status)
    sub.add_parser("schema-check", help="Validate schemas and templates").set_defaults(func=cmd_schema_check)

    sr = sub.add_parser("schema-report", help="Generate schema report")
    sr.add_argument("--dry-run", action="store_true", help="Preview without writing")
    sr.set_defaults(func=cmd_schema_report)

    sub.add_parser("obsidian-status", help="Show workspace quality status").set_defaults(func=cmd_obsidian_status)

    oq = sub.add_parser("obsidian-quality", help="Generate workspace quality report")
    oq.add_argument("--dry-run", action="store_true", help="Preview without writing")
    oq.set_defaults(func=cmd_obsidian_quality)

    sub.add_parser("production-status", help="Show production readiness status").set_defaults(func=cmd_production_status)
    sub.add_parser("production-readiness", help="Run full production readiness gate").set_defaults(func=cmd_production_readiness)

    cc = sub.add_parser("control-center", help="Launch the Control Center cockpit")
    cc.add_argument("--no-open", action="store_true", help="Start services without opening browser")
    cc.set_defaults(func=cmd_control_center)

    sub.add_parser("control-center-stop", help="Stop the Control Center").set_defaults(func=cmd_control_center_stop)
    ccr = sub.add_parser("control-center-restart", help="Restart the Control Center")
    ccr.add_argument("--no-open", action="store_true", help="Restart without opening browser")
    ccr.set_defaults(func=cmd_control_center_restart)
    sub.add_parser("control-center-status", help="Show Control Center status").set_defaults(func=cmd_control_center_status)
    sub.add_parser("control-center-build", help="Build frontend production bundle").set_defaults(func=cmd_control_center_build)
    sub.add_parser("control-center-smoke", help="Run Control Center smoke tests").set_defaults(func=cmd_control_center_smoke)

    return p


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
