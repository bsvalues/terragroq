"""WilliamOS Obsidian Workspace Quality Engine.

Scans the vault for workspace quality signals: folder READMEs, tag usage,
link density, frontmatter completeness, dashboard coverage.
Generates quality reports. Never modifies source notes.
"""

import os
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TZ_NAME = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")

WORKSPACE_DIR = VAULT / "102_ObsidianWorkspace"
REPORTS_DIR = WORKSPACE_DIR / "reports"

GOVERNANCE_DOCS = [
    "README.md",
    "WORKSPACE_POLICY.md",
    "TAG_INDEX.md",
    "LINKING_GUIDE.md",
    "FOLDER_README_GUIDE.md",
]

CONTENT_FOLDERS = [
    "00_Inbox", "01_Daily", "02_Decisions", "03_Doctrine", "04_Appraisal",
    "05_Assessor_Office", "06_TerraFusion_Strategy", "07_Learning", "08_People",
    "09_Cases", "10_Ideas", "11_Projects", "12_Maps",
]

DASHBOARD_DIR = VAULT / "50_Dashboards"
TEMPLATE_DIR = VAULT / "13_Templates"

HIGH_TRUST_DIRS = {"02_Decisions", "03_Doctrine", "10_Ideas", "11_Projects"}

GOVERNANCE_FOLDERS = [
    "20_Graphify", "30_MCP", "40_Scripts", "40_Search", "50_Dashboards",
    "60_Synthesis", "70_InboxProcessor", "80_DoctrinePromotion",
    "85_DecisionPromotion", "86_ConceptPromotion", "87_ProjectPromotion",
    "88_CortexMap", "89_ReviewCockpit", "91_GitGovernance",
    "92_BackupGovernance", "93_RestoreDrill", "94_PrivateRemoteStrategy",
    "95_ReleaseGovernance", "96_OperatingRoutine", "97_HumanReviewQueues",
    "98_OfficialAcceptance", "99_PostAcceptanceClosure",
    "100_MaintenanceRelease", "101_ExternalDriveBackup",
    "102_ObsidianWorkspace",
]


def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(TZ_NAME)
    except Exception:
        return None


def _now():
    tz = _tz()
    return datetime.now(tz) if tz else datetime.now()


def _now_iso():
    return _now().strftime("%Y-%m-%d %H:%M:%S")


def _today_iso():
    return _now().strftime("%Y-%m-%d")


def _ensure_dirs():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)


def _iter_notes(folder=None):
    root = VAULT / folder if folder else VAULT
    if not root.exists():
        return
    for p in root.rglob("*.md"):
        yield p


def _parse_frontmatter(path):
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return None, text if 'text' in dir() else ""
    if not text.startswith("---"):
        return None, text
    end = text.find("---", 3)
    if end == -1:
        return None, text
    fm_text = text[3:end].strip()
    fm = {}
    for line in fm_text.split("\n"):
        if ":" in line and not line.strip().startswith("-"):
            key, _, val = line.partition(":")
            fm[key.strip()] = val.strip().strip('"').strip("'")
    return fm, text


def _count_wikilinks(text):
    return len(re.findall(r"\[\[([^\]]+)\]\]", text))


def _extract_tags_from_frontmatter(fm):
    return []


def scan_folder_readmes():
    results = []
    for folder in CONTENT_FOLDERS:
        readme = VAULT / folder / "README.md"
        results.append({
            "folder": folder,
            "has_readme": readme.exists(),
        })
    return results


def scan_tag_usage():
    tags = Counter()
    for p in _iter_notes():
        rel = p.relative_to(VAULT)
        parts = rel.parts
        if parts and parts[0] in GOVERNANCE_FOLDERS:
            continue
        if parts and parts[0] == "13_Templates":
            continue
        fm, text = _parse_frontmatter(p)
        if fm and "tags" in text[:500]:
            in_tags = False
            for line in text.split("\n")[:30]:
                if line.strip() == "tags:":
                    in_tags = True
                    continue
                if in_tags and line.strip().startswith("- "):
                    tag = line.strip()[2:].strip()
                    if tag:
                        tags[tag] += 1
                elif in_tags and not line.strip().startswith("-"):
                    in_tags = False
    return dict(tags.most_common(50))


def scan_link_density():
    total_notes = 0
    total_links = 0
    notes_with_links = 0
    notes_without_links = 0
    by_folder = {}

    for folder in CONTENT_FOLDERS:
        folder_notes = 0
        folder_links = 0
        for p in _iter_notes(folder):
            _, text = _parse_frontmatter(p)
            links = _count_wikilinks(text)
            total_notes += 1
            total_links += links
            folder_notes += 1
            folder_links += links
            if links > 0:
                notes_with_links += 1
            else:
                notes_without_links += 1
        if folder_notes > 0:
            by_folder[folder] = {
                "notes": folder_notes,
                "links": folder_links,
                "avg": round(folder_links / folder_notes, 1),
            }

    return {
        "total_notes": total_notes,
        "total_links": total_links,
        "avg_links": round(total_links / total_notes, 1) if total_notes else 0,
        "with_links": notes_with_links,
        "without_links": notes_without_links,
        "by_folder": by_folder,
    }


def scan_frontmatter_completeness():
    total = 0
    has_frontmatter = 0
    has_type = 0
    has_status = 0
    has_tags = 0
    missing = []

    for folder in CONTENT_FOLDERS:
        for p in _iter_notes(folder):
            total += 1
            fm, _ = _parse_frontmatter(p)
            if fm is not None:
                has_frontmatter += 1
                if fm.get("type"):
                    has_type += 1
                if fm.get("status"):
                    has_status += 1
            else:
                missing.append(str(p.relative_to(VAULT)))

    return {
        "total": total,
        "has_frontmatter": has_frontmatter,
        "has_type": has_type,
        "has_status": has_status,
        "missing_frontmatter": missing[:20],
        "completeness_pct": round(has_frontmatter / total * 100) if total else 0,
    }


def scan_dashboard_coverage():
    dashboards = []
    if DASHBOARD_DIR.exists():
        for p in sorted(DASHBOARD_DIR.glob("*.md")):
            fm, text = _parse_frontmatter(p)
            fm_type = fm.get("type", "unknown") if fm else "unknown"
            links = _count_wikilinks(text)
            dashboards.append({
                "name": p.stem,
                "type": fm_type,
                "links": links,
            })
    return {
        "total": len(dashboards),
        "dashboards": dashboards,
    }


def scan_template_coverage():
    templates = []
    if TEMPLATE_DIR.exists():
        for p in sorted(TEMPLATE_DIR.glob("*.md")):
            fm, text = _parse_frontmatter(p)
            sections = [l.strip() for l in text.split("\n") if l.strip().startswith("## ")]
            templates.append({
                "name": p.stem,
                "has_frontmatter": fm is not None,
                "sections": len(sections),
            })
    return {
        "total": len(templates),
        "templates": templates,
    }


def workspace_status():
    docs_exist = all((WORKSPACE_DIR / d).exists() for d in GOVERNANCE_DOCS)
    readmes = scan_folder_readmes()
    readme_count = sum(1 for r in readmes if r["has_readme"])
    dashboards = scan_dashboard_coverage()
    templates = scan_template_coverage()

    latest_report = None
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Workspace Quality - *.md"))
        if reports:
            latest_report = reports[-1].name

    return {
        "workspace_dir_exists": WORKSPACE_DIR.exists(),
        "docs_exist": docs_exist,
        "folder_readmes": f"{readme_count}/{len(CONTENT_FOLDERS)}",
        "dashboards": dashboards["total"],
        "templates": templates["total"],
        "latest_report": latest_report,
    }


def generate_quality_report(dry_run=False):
    date_str = _today_iso()

    readmes = scan_folder_readmes()
    links = scan_link_density()
    fm = scan_frontmatter_completeness()
    dashboards = scan_dashboard_coverage()
    templates = scan_template_coverage()
    tags = scan_tag_usage()

    if dry_run:
        readme_count = sum(1 for r in readmes if r["has_readme"])
        return {
            "date": date_str,
            "folder_readmes": f"{readme_count}/{len(CONTENT_FOLDERS)}",
            "total_notes": links["total_notes"],
            "avg_links": links["avg_links"],
            "frontmatter_pct": fm["completeness_pct"],
            "dashboards": dashboards["total"],
            "templates": templates["total"],
            "top_tags": list(tags.keys())[:10],
            "dry_run": True,
        }

    lines = []
    lines.append("---")
    lines.append("type: workspace-quality")
    lines.append("status: draft")
    lines.append(f"generated: \"{_now_iso()}\"")
    lines.append("tags:")
    lines.append("  - workspace")
    lines.append("  - quality")
    lines.append("  - generated")
    lines.append("---")
    lines.append("")
    lines.append(f"# Workspace Quality Report - {date_str}")
    lines.append("")

    lines.append("## Summary")
    lines.append("")
    readme_count = sum(1 for r in readmes if r["has_readme"])
    lines.append(f"- Content notes: {links['total_notes']}")
    lines.append(f"- Folder READMEs: {readme_count}/{len(CONTENT_FOLDERS)}")
    lines.append(f"- Frontmatter coverage: {fm['completeness_pct']}%")
    lines.append(f"- Average links per note: {links['avg_links']}")
    lines.append(f"- Dashboards: {dashboards['total']}")
    lines.append(f"- Templates: {templates['total']}")
    lines.append("")

    lines.append("## Folder README Status")
    lines.append("")
    lines.append("| Folder | README |")
    lines.append("|--------|--------|")
    for r in readmes:
        lines.append(f"| {r['folder']} | {'yes' if r['has_readme'] else 'MISSING'} |")
    lines.append("")

    lines.append("## Link Density")
    lines.append("")
    lines.append(f"- Total links: {links['total_links']}")
    lines.append(f"- Notes with links: {links['with_links']}")
    lines.append(f"- Notes without links: {links['without_links']}")
    lines.append("")
    lines.append("| Folder | Notes | Links | Avg |")
    lines.append("|--------|-------|-------|-----|")
    for folder, data in links["by_folder"].items():
        lines.append(f"| {folder} | {data['notes']} | {data['links']} | {data['avg']} |")
    lines.append("")

    lines.append("## Frontmatter Completeness")
    lines.append("")
    lines.append(f"- Total content notes: {fm['total']}")
    lines.append(f"- Has frontmatter: {fm['has_frontmatter']}")
    lines.append(f"- Has type field: {fm['has_type']}")
    lines.append(f"- Has status field: {fm['has_status']}")
    if fm["missing_frontmatter"]:
        lines.append("")
        lines.append("Missing frontmatter:")
        for m in fm["missing_frontmatter"]:
            lines.append(f"- `{m}`")
    lines.append("")

    lines.append("## Dashboard Coverage")
    lines.append("")
    lines.append("| Dashboard | Type | Links |")
    lines.append("|-----------|------|-------|")
    for d in dashboards["dashboards"]:
        lines.append(f"| {d['name']} | {d['type']} | {d['links']} |")
    lines.append("")

    lines.append("## Template Coverage")
    lines.append("")
    lines.append("| Template | Frontmatter | Sections |")
    lines.append("|----------|------------|----------|")
    for t in templates["templates"]:
        lines.append(f"| {t['name']} | {'yes' if t['has_frontmatter'] else 'no'} | {t['sections']} |")
    lines.append("")

    lines.append("## Top Tags")
    lines.append("")
    if tags:
        for tag, count in list(tags.items())[:20]:
            lines.append(f"- `{tag}`: {count}")
    else:
        lines.append("No tags found in content notes.")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This report was generated by WilliamOS. No notes were modified.")
    lines.append("")

    _ensure_dirs()
    content = "\n".join(lines)
    report_path = REPORTS_DIR / f"Workspace Quality - {date_str}.md"
    report_path.write_text(content, encoding="utf-8")

    return {
        "date": date_str,
        "folder_readmes": f"{readme_count}/{len(CONTENT_FOLDERS)}",
        "total_notes": links["total_notes"],
        "avg_links": links["avg_links"],
        "frontmatter_pct": fm["completeness_pct"],
        "dashboards": dashboards["total"],
        "templates": templates["total"],
        "report_path": str(report_path),
        "dry_run": False,
    }
