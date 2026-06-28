"""WilliamOS Schema Registry Engine.

Defines required frontmatter fields for every note type and generated artifact type.
Validates notes against their schema. Never modifies source notes.
"""

import json
import os
from datetime import datetime
from pathlib import Path

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
TZ_NAME = os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles")

SCHEMA_DIR = VAULT / "103_SchemaRegistry"
REPORTS_DIR = SCHEMA_DIR / "reports"
DATA_DIR = SCHEMA_DIR / "data"

SCHEMAS = {
    "daily-command": {
        "description": "Daily command note",
        "folder": "01_Daily",
        "required": ["type", "date"],
        "type_value": "daily",
        "template": "Daily Command",
    },
    "weekly-review": {
        "description": "Weekly review note",
        "folder": "01_Daily",
        "required": ["type", "week"],
        "type_value": "weekly-review",
        "template": "Weekly Review",
    },
    "decision": {
        "description": "Decision record",
        "folder": "02_Decisions",
        "required": ["type", "status", "area"],
        "type_value": "decision",
        "template": "Decision Record",
    },
    "doctrine": {
        "description": "Operating principle",
        "folder": "03_Doctrine",
        "required": ["type", "status", "area"],
        "type_value": "doctrine",
        "template": "Doctrine",
    },
    "concept": {
        "description": "Concept or idea note",
        "folder": "10_Ideas",
        "required": ["type", "status", "area"],
        "type_value": "concept",
        "template": "Concept Note",
    },
    "project": {
        "description": "Project note",
        "folder": "11_Projects",
        "required": ["type", "status", "area"],
        "type_value": "project",
        "template": "Project Note",
    },
    "work-order": {
        "description": "Work order seed",
        "folder": "11_Projects",
        "required": ["type", "status"],
        "type_value": "work-order",
        "template": "Work Order Seed",
    },
    "case": {
        "description": "Case analysis",
        "folder": "09_Cases",
        "required": ["type", "status", "case_type"],
        "type_value": "case",
        "template": "Case Analysis",
    },
    "source": {
        "description": "Source / reference note",
        "folder": "07_Learning",
        "required": ["type", "status"],
        "type_value": "source",
        "template": "Source Note",
    },
    "meeting": {
        "description": "Meeting note",
        "folder": None,
        "required": ["type", "date"],
        "type_value": "meeting",
        "template": "Meeting Note",
    },
    "person": {
        "description": "Person note",
        "folder": "08_People",
        "required": ["type"],
        "type_value": "person",
        "template": "Person",
    },
    "learning": {
        "description": "Learning note",
        "folder": "07_Learning",
        "required": ["type", "status", "area"],
        "type_value": "learning",
        "template": "Learning Note",
    },
    "inbox": {
        "description": "Inbox capture",
        "folder": "00_Inbox",
        "required": ["type", "captured"],
        "type_value": "inbox",
        "template": None,
    },
    "readme": {
        "description": "Folder README",
        "folder": None,
        "required": ["type", "status", "area"],
        "type_value": "readme",
        "template": None,
    },
    "moc": {
        "description": "Map of Content",
        "folder": "50_Dashboards",
        "required": ["type", "status"],
        "type_value": "moc",
        "template": None,
    },
    "dashboard": {
        "description": "Dashboard note",
        "folder": "50_Dashboards",
        "required": ["type", "status"],
        "type_value": "dashboard",
        "template": None,
    },
    "governance": {
        "description": "Governance policy doc",
        "folder": None,
        "required": ["type", "status"],
        "type_value": "governance",
        "template": None,
    },
    "policy": {
        "description": "Policy document",
        "folder": None,
        "required": ["type", "status"],
        "type_value": "policy",
        "template": None,
    },
    "reference": {
        "description": "Reference document",
        "folder": None,
        "required": ["type", "status"],
        "type_value": "reference",
        "template": None,
    },
    "inbox-triage": {
        "description": "Inbox triage report",
        "folder": "70_InboxProcessor/reports",
        "required": ["type", "generated"],
        "type_value": "inbox-triage",
        "template": None,
    },
    "weekly-synthesis": {
        "description": "Weekly synthesis review",
        "folder": "60_Synthesis",
        "required": ["type", "week"],
        "type_value": "weekly-synthesis",
        "template": None,
    },
    "promotion-report": {
        "description": "Promotion engine report",
        "folder": None,
        "required": ["type", "generated"],
        "type_value": "promotion-report",
        "template": None,
    },
    "promotion-draft": {
        "description": "Promoted draft note",
        "folder": None,
        "required": ["type", "status"],
        "type_value": "promotion-draft",
        "template": None,
    },
    "acceptance-plan": {
        "description": "Acceptance plan",
        "folder": "98_OfficialAcceptance/plans",
        "required": ["type", "status"],
        "type_value": "acceptance-plan",
        "template": None,
    },
    "acceptance-checklist": {
        "description": "Acceptance checklist",
        "folder": "97_HumanReviewQueues/checklists",
        "required": ["type", "generated"],
        "type_value": "acceptance-checklist",
        "template": None,
    },
    "closure-report": {
        "description": "Post-acceptance closure report",
        "folder": "99_PostAcceptanceClosure/reports",
        "required": ["type", "generated"],
        "type_value": "closure-report",
        "template": None,
    },
    "cockpit": {
        "description": "Review cockpit dashboard",
        "folder": "89_ReviewCockpit/reports",
        "required": ["type", "generated"],
        "type_value": "cockpit-dashboard",
        "template": None,
    },
    "daily-review": {
        "description": "Daily operating review",
        "folder": "96_OperatingRoutine/daily",
        "required": ["type", "date"],
        "type_value": "daily-review",
        "template": None,
    },
    "weekly-operating-review": {
        "description": "Weekly operating review",
        "folder": "96_OperatingRoutine/weekly",
        "required": ["type"],
        "type_value": "weekly-operating-review",
        "template": None,
    },
    "monthly-cortex-review": {
        "description": "Monthly cortex review",
        "folder": "96_OperatingRoutine/monthly",
        "required": ["type"],
        "type_value": "monthly-cortex-review",
        "template": None,
    },
    "cortex-review": {
        "description": "Cortex map review report",
        "folder": "88_CortexMap/reports",
        "required": ["type", "generated"],
        "type_value": "cortex-review",
        "template": None,
    },
    "backup-manifest": {
        "description": "Backup state manifest",
        "folder": "92_BackupGovernance",
        "required": ["type", "generated"],
        "type_value": "backup-manifest",
        "template": None,
    },
    "restore-manifest": {
        "description": "Restore state manifest",
        "folder": "93_RestoreDrill",
        "required": ["type", "generated"],
        "type_value": "restore-manifest",
        "template": None,
    },
    "release-manifest": {
        "description": "Release state manifest",
        "folder": "95_ReleaseGovernance",
        "required": ["type", "generated"],
        "type_value": "release-manifest",
        "template": None,
    },
    "maintenance-manifest": {
        "description": "Maintenance state manifest",
        "folder": "100_MaintenanceRelease",
        "required": ["type", "generated"],
        "type_value": "maintenance-manifest",
        "template": None,
    },
    "workspace-quality": {
        "description": "Workspace quality report",
        "folder": "102_ObsidianWorkspace/reports",
        "required": ["type", "generated"],
        "type_value": "workspace-quality",
        "template": None,
    },
}

TEMPLATE_DIR = VAULT / "13_Templates"

GOVERNANCE_FOLDERS = {
    "20_Graphify", "30_MCP", "40_Scripts", "40_Search", "50_Dashboards",
    "60_Synthesis", "70_InboxProcessor", "80_DoctrinePromotion",
    "85_DecisionPromotion", "86_ConceptPromotion", "87_ProjectPromotion",
    "88_CortexMap", "89_ReviewCockpit", "91_GitGovernance",
    "92_BackupGovernance", "93_RestoreDrill", "94_PrivateRemoteStrategy",
    "95_ReleaseGovernance", "96_OperatingRoutine", "97_HumanReviewQueues",
    "98_OfficialAcceptance", "99_PostAcceptanceClosure",
    "100_MaintenanceRelease", "101_ExternalDriveBackup",
    "102_ObsidianWorkspace", "103_SchemaRegistry",
}


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
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _parse_frontmatter(path):
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return None
    if not text.startswith("---"):
        return None
    end = text.find("---", 3)
    if end == -1:
        return None
    fm = {}
    for line in text[3:end].strip().split("\n"):
        if ":" in line and not line.strip().startswith("-"):
            key, _, val = line.partition(":")
            fm[key.strip()] = val.strip().strip('"').strip("'")
    return fm


def get_schema(type_name):
    return SCHEMAS.get(type_name)


def list_schemas():
    return {k: v["description"] for k, v in SCHEMAS.items()}


def validate_note(path, schema_name=None):
    fm = _parse_frontmatter(path)
    if fm is None:
        return {"valid": False, "errors": ["no frontmatter"], "schema": schema_name}

    if schema_name is None:
        note_type = fm.get("type", "")
        for sn, sd in SCHEMAS.items():
            if sd["type_value"] == note_type:
                schema_name = sn
                break
        if schema_name is None:
            return {"valid": True, "errors": [], "schema": None, "note": "unknown type, no schema to check"}

    schema = SCHEMAS.get(schema_name)
    if not schema:
        return {"valid": False, "errors": [f"unknown schema: {schema_name}"], "schema": schema_name}

    errors = []
    for field in schema["required"]:
        if field not in fm or not fm[field]:
            errors.append(f"missing required field: {field}")

    if schema.get("type_value") and fm.get("type") and fm["type"] != schema["type_value"]:
        pass

    return {"valid": len(errors) == 0, "errors": errors, "schema": schema_name}


def check_templates():
    results = []
    for sn, sd in SCHEMAS.items():
        tmpl_name = sd.get("template")
        if not tmpl_name:
            continue
        tmpl_path = TEMPLATE_DIR / f"{tmpl_name}.md"
        if not tmpl_path.exists():
            results.append({"schema": sn, "template": tmpl_name, "exists": False, "valid": False, "errors": ["template file missing"]})
            continue
        fm = _parse_frontmatter(tmpl_path)
        errors = []
        if fm is None:
            errors.append("no frontmatter in template")
        else:
            for field in sd["required"]:
                if field not in fm and f"{{{{{field}}}}}" not in tmpl_path.read_text(encoding="utf-8", errors="ignore"):
                    if field not in ("date", "captured", "week", "case_type"):
                        errors.append(f"template missing field or placeholder: {field}")
        results.append({"schema": sn, "template": tmpl_name, "exists": True, "valid": len(errors) == 0, "errors": errors})
    return results


def schema_check():
    issues = []

    for doc in ["README.md", "SCHEMA_POLICY.md", "SCHEMA_REFERENCE.md"]:
        if not (SCHEMA_DIR / doc).exists():
            issues.append(f"missing governance doc: {doc}")

    template_results = check_templates()
    for tr in template_results:
        if not tr["valid"]:
            for e in tr["errors"]:
                issues.append(f"template '{tr['template']}': {e}")

    return {
        "pass": len(issues) == 0,
        "issues": issues,
        "schema_count": len(SCHEMAS),
        "template_checks": len(template_results),
    }


def schema_status():
    check = schema_check()
    latest_report = None
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Schema Report - *.md"))
        if reports:
            latest_report = reports[-1].name
    return {
        "schema_dir_exists": SCHEMA_DIR.exists(),
        "docs_exist": all((SCHEMA_DIR / d).exists() for d in ["README.md", "SCHEMA_POLICY.md", "SCHEMA_REFERENCE.md"]),
        "schema_count": len(SCHEMAS),
        "check_pass": check["pass"],
        "issues": len(check["issues"]),
        "latest_report": latest_report,
    }


def generate_schema_report(dry_run=False):
    date_str = _today_iso()
    check = schema_check()
    template_results = check_templates()

    if dry_run:
        return {
            "date": date_str,
            "schema_count": len(SCHEMAS),
            "check_pass": check["pass"],
            "issues": check["issues"],
            "template_checks": len(template_results),
            "templates_valid": sum(1 for t in template_results if t["valid"]),
            "dry_run": True,
        }

    lines = []
    lines.append("---")
    lines.append("type: schema-report")
    lines.append("status: draft")
    lines.append(f"generated: \"{_now_iso()}\"")
    lines.append("tags:")
    lines.append("  - schema")
    lines.append("  - generated")
    lines.append("---")
    lines.append("")
    lines.append(f"# Schema Report - {date_str}")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Schemas defined: {len(SCHEMAS)}")
    lines.append(f"- Check result: {'PASS' if check['pass'] else 'FAIL'}")
    lines.append(f"- Issues: {len(check['issues'])}")
    lines.append(f"- Template checks: {len(template_results)}")
    lines.append(f"- Templates valid: {sum(1 for t in template_results if t['valid'])}/{len(template_results)}")
    lines.append("")

    lines.append("## Schema Index")
    lines.append("")
    lines.append("| Type | Description | Required Fields | Template |")
    lines.append("|------|-------------|-----------------|----------|")
    for sn, sd in sorted(SCHEMAS.items()):
        fields = ", ".join(sd["required"])
        tmpl = sd.get("template") or "—"
        lines.append(f"| {sn} | {sd['description']} | {fields} | {tmpl} |")
    lines.append("")

    if check["issues"]:
        lines.append("## Issues")
        lines.append("")
        for issue in check["issues"]:
            lines.append(f"- {issue}")
        lines.append("")

    lines.append("## Template Validation")
    lines.append("")
    lines.append("| Schema | Template | Exists | Valid | Errors |")
    lines.append("|--------|----------|--------|-------|--------|")
    for tr in template_results:
        errs = "; ".join(tr["errors"]) if tr["errors"] else "—"
        lines.append(f"| {tr['schema']} | {tr['template']} | {'yes' if tr['exists'] else 'NO'} | {'yes' if tr['valid'] else 'NO'} | {errs} |")
    lines.append("")

    lines.append("## Generator Notes")
    lines.append("")
    lines.append("This report was generated by WilliamOS. No notes were modified.")
    lines.append("")

    _ensure_dirs()
    content = "\n".join(lines)
    report_path = REPORTS_DIR / f"Schema Report - {date_str}.md"
    report_path.write_text(content, encoding="utf-8")

    json_data = {
        "date": date_str,
        "schema_count": len(SCHEMAS),
        "check_pass": check["pass"],
        "issues": check["issues"],
        "template_results": template_results,
    }
    json_path = DATA_DIR / f"schema-check-{date_str}.json"
    json_path.write_text(json.dumps(json_data, indent=2, default=str), encoding="utf-8")

    return {
        "date": date_str,
        "schema_count": len(SCHEMAS),
        "check_pass": check["pass"],
        "issues": check["issues"],
        "template_checks": len(template_results),
        "templates_valid": sum(1 for t in template_results if t["valid"]),
        "report_path": str(report_path),
        "json_path": str(json_path),
        "dry_run": False,
    }
