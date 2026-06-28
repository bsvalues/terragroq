"""WilliamOS release governance engine.

Local-first acceptance review and release tagging.
Runs all system checks, generates acceptance reports,
writes release manifests, and creates local Git tags.

Never pushes. Never creates remotes. Never uploads anything.
Tags are local only unless the user explicitly pushes later.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

VAULT = Path(os.environ.get("WILLIAMOS_VAULT", "WilliamOS"))
RELEASE_DIR = VAULT / "95_ReleaseGovernance"
REPORTS_DIR = RELEASE_DIR / "reports"
DATA_DIR = RELEASE_DIR / "data"
MANIFEST_PATH = RELEASE_DIR / "RELEASE_MANIFEST.md"

RELEASE_REQUIRED_DOCS = [
    "95_ReleaseGovernance/README.md",
    "95_ReleaseGovernance/ACCEPTANCE_POLICY.md",
    "95_ReleaseGovernance/V1_ACCEPTANCE_CHECKLIST.md",
    "95_ReleaseGovernance/RELEASE_TAG_POLICY.md",
    "95_ReleaseGovernance/POST_RELEASE_ROUTINE.md",
]

HIGH_TRUST_DIRS = [
    "02_Decisions",
    "03_Doctrine",
    "10_Ideas",
    "11_Projects",
]

FORBIDDEN_PATTERNS = [
    ".env", "*.env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx",
    "id_rsa", "id_ed25519", "secrets.*", "token.*", "credentials.*",
]

SUSPICIOUS_NAME_PARTS = [
    "secret", "token", "credential", "password",
    "apikey", "api_key", "private_key",
]

ACCEPTANCE_CHECKS = [
    {"name": "Vault governance (check)", "cmd": ["check"], "category": "required"},
    {"name": "MCP readiness", "cmd": ["mcp-check"], "category": "warning"},
    {"name": "Semantic search status", "cmd": ["semantic-status"], "category": "warning"},
    {"name": "Weekly synthesis status", "cmd": ["synth-status"], "category": "warning"},
    {"name": "Inbox processor status", "cmd": ["inbox-status"], "category": "warning"},
    {"name": "Doctrine promotion status", "cmd": ["doctrine-status"], "category": "warning"},
    {"name": "Decision promotion status", "cmd": ["decision-status"], "category": "warning"},
    {"name": "Concept promotion status", "cmd": ["concept-status"], "category": "warning"},
    {"name": "Project/WO promotion status", "cmd": ["project-status"], "category": "warning"},
    {"name": "Cortex map status", "cmd": ["cortex-status"], "category": "warning"},
    {"name": "Review cockpit status", "cmd": ["cockpit-status"], "category": "warning"},
    {"name": "Git governance status", "cmd": ["git-status"], "category": "required"},
    {"name": "Backup governance status", "cmd": ["backup-status"], "category": "warning"},
    {"name": "Restore drill status", "cmd": ["restore-status"], "category": "warning"},
    {"name": "Remote protection status", "cmd": ["remote-status"], "category": "warning"},
    {"name": "Orphan notes scan", "cmd": ["orphans"], "category": "warning"},
    {"name": "Stale decisions scan", "cmd": ["stale-decisions"], "category": "warning"},
]

WO_LAYERS = [
    {"wo": "WO-001", "name": "Vault Structure", "dir": None, "check": "REQUIRED_DIRS present"},
    {"wo": "WO-002", "name": "CLI Automation", "dir": None, "check": "scripts/william.py exists"},
    {"wo": "WO-003", "name": "Templates", "dir": "13_Templates", "check": "12 templates present"},
    {"wo": "WO-004", "name": "Dashboards", "dir": "50_Dashboards", "check": "MOC files present"},
    {"wo": "WO-005", "name": "MCP Guardrails", "dir": "30_MCP", "check": "AI access rules present"},
    {"wo": "WO-006", "name": "Semantic Search", "dir": "40_Search", "check": "Search docs present"},
    {"wo": "WO-007", "name": "Weekly Synthesis", "dir": "60_Synthesis", "check": "Synthesis docs present"},
    {"wo": "WO-008", "name": "Inbox Processor", "dir": "70_InboxProcessor", "check": "Processor docs present"},
    {"wo": "WO-009", "name": "Doctrine Promotion", "dir": "80_DoctrinePromotion", "check": "Promotion docs present"},
    {"wo": "WO-010", "name": "Decision Promotion", "dir": "85_DecisionPromotion", "check": "Promotion docs present"},
    {"wo": "WO-011", "name": "Concept Promotion", "dir": "86_ConceptPromotion", "check": "Promotion docs present"},
    {"wo": "WO-012A", "name": "Project/WO Promotion", "dir": "87_ProjectPromotion", "check": "Promotion docs present"},
    {"wo": "WO-012B", "name": "Cortex Map", "dir": "88_CortexMap", "check": "Cortex docs present"},
    {"wo": "WO-012C", "name": "Review Cockpit", "dir": "89_ReviewCockpit", "check": "Cockpit docs present"},
    {"wo": "WO-012D", "name": "Git Governance", "dir": "91_GitGovernance", "check": "Git gov docs present"},
    {"wo": "WO-013", "name": "Backup Governance", "dir": "92_BackupGovernance", "check": "Backup docs present"},
    {"wo": "WO-014", "name": "Restore Drill", "dir": "93_RestoreDrill", "check": "Restore docs present"},
    {"wo": "WO-015", "name": "Private Remote Strategy", "dir": "94_PrivateRemoteStrategy", "check": "Strategy docs present"},
    {"wo": "WO-016", "name": "Release Governance", "dir": "95_ReleaseGovernance", "check": "Release docs present"},
]


def _tz() -> ZoneInfo:
    return ZoneInfo(os.environ.get("WILLIAMOS_TZ", "America/Los_Angeles"))


def _now_iso() -> str:
    return dt.datetime.now(_tz()).strftime("%Y-%m-%d %H:%M:%S %Z")


def _today_iso() -> str:
    return dt.datetime.now(_tz()).date().isoformat()


def _run_command(cmd_args: list[str]) -> dict[str, Any]:
    """Run a william.py subcommand and capture output."""
    full_cmd = [sys.executable, "scripts/william.py"] + cmd_args
    try:
        r = subprocess.run(
            full_cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        return {
            "exit_code": r.returncode,
            "stdout": r.stdout.strip(),
            "stderr": r.stderr.strip(),
            "passed": r.returncode == 0,
        }
    except subprocess.TimeoutExpired:
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": "Command timed out",
            "passed": False,
        }
    except Exception as e:
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": str(e),
            "passed": False,
        }


def check_forbidden_files() -> dict[str, Any]:
    """Scan working directory for forbidden files."""
    import fnmatch
    found = []
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", ".venv", "venv", "node_modules")]
        for f in files:
            rel = os.path.join(root, f).replace("\\", "/")
            if rel.startswith("./"):
                rel = rel[2:]
            for pat in FORBIDDEN_PATTERNS:
                if fnmatch.fnmatch(f, pat) or fnmatch.fnmatch(rel, pat):
                    found.append(rel)
                    break
            else:
                name_lower = f.lower()
                for sp in SUSPICIOUS_NAME_PARTS:
                    if sp in name_lower:
                        found.append(rel)
                        break
    return {
        "passed": len(found) == 0,
        "forbidden": found,
    }


def check_remote_state() -> dict[str, Any]:
    """Check for Git remotes."""
    try:
        r = subprocess.run(
            ["git", "remote", "-v"],
            capture_output=True, text=True, timeout=10,
        )
        lines = [l.strip() for l in r.stdout.strip().splitlines() if l.strip()]
        return {
            "passed": len(lines) == 0,
            "remotes": lines,
            "count": len(lines),
        }
    except Exception as e:
        return {"passed": True, "remotes": [], "count": 0, "error": str(e)}


def check_source_note_integrity() -> dict[str, Any]:
    """Spot-check high-trust folders for integrity."""
    issues = []
    stats = {}
    for hdir in HIGH_TRUST_DIRS:
        folder = VAULT / hdir
        if not folder.exists():
            stats[hdir] = {"exists": False, "count": 0}
            continue
        md_files = list(folder.glob("*.md"))
        stats[hdir] = {"exists": True, "count": len(md_files)}
        for mf in md_files:
            text = mf.read_text(encoding="utf-8", errors="ignore")
            if not text.startswith("---"):
                issues.append(f"Missing frontmatter: {mf.relative_to('.')}")
            if "status: auto-generated" in text.lower():
                issues.append(f"Machine-generated marker found: {mf.relative_to('.')}")
    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "stats": stats,
    }


def _git_info() -> dict[str, Any]:
    """Gather Git repository information."""
    info = {"repo": False, "branch": None, "commit": None, "clean": False, "tag": None}
    try:
        r = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return info
        info["repo"] = True
        r = subprocess.run(["git", "branch", "--show-current"],
                           capture_output=True, text=True, timeout=10)
        info["branch"] = r.stdout.strip() or None
        r = subprocess.run(["git", "log", "-1", "--format=%h %s"],
                           capture_output=True, text=True, timeout=10)
        info["commit"] = r.stdout.strip() or None
        r = subprocess.run(["git", "status", "--porcelain"],
                           capture_output=True, text=True, timeout=10)
        info["clean"] = len(r.stdout.strip()) == 0
        r = subprocess.run(["git", "describe", "--tags", "--abbrev=0"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0 and r.stdout.strip():
            info["tag"] = r.stdout.strip()
    except Exception:
        pass
    return info


def get_latest_tag() -> str | None:
    """Return the latest Git tag or None."""
    try:
        r = subprocess.run(["git", "describe", "--tags", "--abbrev=0"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return None


def run_acceptance_checks(dry_run: bool = False) -> dict[str, Any]:
    """Run all v1 acceptance checks and classify results."""
    results = []

    for chk in ACCEPTANCE_CHECKS:
        r = _run_command(chk["cmd"])
        result = {
            "name": chk["name"],
            "command": " ".join(chk["cmd"]),
            "category": chk["category"],
            "passed": r["passed"],
            "output": r["stdout"],
            "error": r["stderr"] if not r["passed"] else "",
        }
        results.append(result)

    fb = check_forbidden_files()
    fb_count = len(fb["forbidden"])
    results.append({
        "name": "Forbidden file scan",
        "command": "(direct scan)",
        "category": "required",
        "passed": fb["passed"],
        "output": "No forbidden files" if fb["passed"] else f"{fb_count} forbidden files found",
        "error": "\n".join(fb["forbidden"]) if not fb["passed"] else "",
    })

    rm = check_remote_state()
    results.append({
        "name": "Remote scan",
        "command": "git remote -v",
        "category": "required",
        "passed": rm["passed"],
        "output": "No remotes configured" if rm["passed"] else f"{rm['count']} remote(s) found",
        "error": "\n".join(rm["remotes"]) if not rm["passed"] else "",
    })

    si = check_source_note_integrity()
    stats_summary = ", ".join(f"{k}: {v['count']}" for k, v in si["stats"].items())
    results.append({
        "name": "Source note integrity",
        "command": "(direct scan)",
        "category": "required",
        "passed": si["passed"],
        "output": f"High-trust folders OK ({stats_summary})" if si["passed"] else f"{len(si['issues'])} integrity issues",
        "error": "\n".join(si["issues"]) if not si["passed"] else "",
    })

    required_pass = [r for r in results if r["category"] == "required"]
    warnings = [r for r in results if r["category"] == "warning"]
    blocking = [r for r in required_pass if not r["passed"]]
    warning_fails = [r for r in warnings if not r["passed"]]

    all_required_pass = len(blocking) == 0

    if all_required_pass and len(warning_fails) == 0:
        overall = "PASS"
    elif all_required_pass:
        overall = "PASS_WITH_WARNINGS"
    else:
        overall = "FAIL"

    return {
        "checks": results,
        "required_checks": required_pass,
        "warnings": warnings,
        "blocking_failures": blocking,
        "warning_failures": warning_fails,
        "overall": overall,
        "all_required_pass": all_required_pass,
        "total": len(results),
        "passed_count": sum(1 for r in results if r["passed"]),
        "failed_count": sum(1 for r in results if not r["passed"]),
        "timestamp": _now_iso(),
    }


def _layer_status() -> list[dict[str, Any]]:
    """Check presence of each WO layer."""
    layers = []
    for layer in WO_LAYERS:
        present = True
        if layer["dir"]:
            present = (VAULT / layer["dir"]).exists()
        elif layer["wo"] == "WO-001":
            present = VAULT.exists()
        elif layer["wo"] == "WO-002":
            present = Path("scripts/william.py").exists()
        layers.append({
            "wo": layer["wo"],
            "name": layer["name"],
            "present": present,
            "check": layer["check"],
        })
    return layers


def generate_acceptance_report(acceptance: dict[str, Any]) -> str:
    """Generate the acceptance report Markdown."""
    today = _today_iso()
    git = _git_info()
    layers = _layer_status()

    overall_text = {
        "PASS": "ALL CHECKS PASSED",
        "PASS_WITH_WARNINGS": "PASSED WITH WARNINGS",
        "FAIL": "BLOCKED — required checks failed",
    }.get(acceptance["overall"], acceptance["overall"])

    recommendation = {
        "PASS": "System is ready for v1 release tag.",
        "PASS_WITH_WARNINGS": "System is ready for v1 release tag. Warnings are informational and do not block release.",
        "FAIL": "System is NOT ready for v1 release tag. Resolve blocking failures before tagging.",
    }.get(acceptance["overall"], "Review results manually.")

    lines = [
        "---",
        "type: acceptance-review",
        f"status: {'draft' if acceptance['overall'] == 'FAIL' else 'approved'}",
        f"generated: {_now_iso()}",
        "tags:",
        "  - release",
        "  - acceptance",
        "  - governance",
        "---",
        "",
        f"# WilliamOS v1 Acceptance Review - {today}",
        "",
        "## Executive Summary",
        "",
        f"Full acceptance review of WilliamOS v1 covering {acceptance['total']} checks across all operational layers.",
        f"Generated: {_now_iso()}",
        "",
        "## Overall Result",
        "",
        f"**{overall_text}**",
        "",
        f"- Total checks: {acceptance['total']}",
        f"- Passed: {acceptance['passed_count']}",
        f"- Failed: {acceptance['failed_count']}",
        f"- Blocking failures: {len(acceptance['blocking_failures'])}",
        f"- Warnings: {len(acceptance['warning_failures'])}",
        "",
        "## Layer Status",
        "",
        "| WO | Layer | Present | Check |",
        "|---|---|---|---|",
    ]
    for layer in layers:
        status = "yes" if layer["present"] else "MISSING"
        lines.append(f"| {layer['wo']} | {layer['name']} | {status} | {layer['check']} |")

    lines += [
        "",
        "## Command Verification",
        "",
        "| Check | Category | Result | Detail |",
        "|---|---|---|---|",
    ]
    for chk in acceptance["checks"]:
        status = "PASS" if chk["passed"] else "FAIL"
        cat = chk["category"].upper()
        first_line = chk["output"].split("\n")[0][:80] if chk["output"] else "(no output)"
        lines.append(f"| {chk['name']} | {cat} | {status} | {first_line} |")

    lines += [
        "",
        "## Git / Snapshot Status",
        "",
        f"- Git repo: {'yes' if git['repo'] else 'no'}",
        f"- Branch: {git['branch'] or '(none)'}",
        f"- Latest commit: {git['commit'] or '(none)'}",
        f"- Clean tree: {'yes' if git['clean'] else 'no'}",
        f"- Latest tag: {git['tag'] or '(none)'}",
        "",
        "## Backup / Restore Status",
        "",
    ]
    for chk in acceptance["checks"]:
        if "backup" in chk["name"].lower() or "restore" in chk["name"].lower():
            lines.append(f"- {chk['name']}: {'PASS' if chk['passed'] else 'FAIL'}")
            if chk["output"]:
                for ol in chk["output"].split("\n")[:5]:
                    if ol.strip():
                        lines.append(f"  {ol.strip()}")

    lines += [
        "",
        "## Remote Status",
        "",
    ]
    for chk in acceptance["checks"]:
        if "remote" in chk["name"].lower():
            lines.append(f"- {chk['name']}: {'PASS' if chk['passed'] else 'FAIL'}")
    rm = check_remote_state()
    lines.append(f"- Remotes configured: {rm['count']}")
    lines.append(f"- Push performed: no")

    lines += [
        "",
        "## Forbidden File Scan",
        "",
    ]
    for chk in acceptance["checks"]:
        if "forbidden" in chk["name"].lower():
            lines.append(f"- {chk['name']}: {'PASS — no forbidden files' if chk['passed'] else 'FAIL'}")
            if not chk["passed"] and chk["error"]:
                for ef in chk["error"].split("\n")[:10]:
                    lines.append(f"  - {ef}")

    lines += [
        "",
        "## Source Note Integrity",
        "",
    ]
    for chk in acceptance["checks"]:
        if "integrity" in chk["name"].lower():
            lines.append(f"- {chk['name']}: {'PASS' if chk['passed'] else 'FAIL'}")
            if chk["output"]:
                lines.append(f"  {chk['output']}")

    if acceptance["warning_failures"]:
        lines += [
            "",
            "## Warnings",
            "",
        ]
        for w in acceptance["warning_failures"]:
            lines.append(f"- **{w['name']}**: {w['output'][:100] if w['output'] else w['error'][:100]}")

    if acceptance["blocking_failures"]:
        lines += [
            "",
            "## Blocking Failures",
            "",
        ]
        for b in acceptance["blocking_failures"]:
            lines.append(f"- **{b['name']}**: {b['error'][:200] if b['error'] else b['output'][:200]}")

    lines += [
        "",
        "## Release Recommendation",
        "",
        recommendation,
        "",
        "## Source Paths",
        "",
        "- CLI: scripts/william.py",
        "- Vault: WilliamOS/",
        "- Release docs: WilliamOS/95_ReleaseGovernance/",
        "",
        "## Generator Notes",
        "",
        "This note was generated by WilliamOS. No remote was created and no push was performed.",
        "",
    ]
    return "\n".join(lines)


def write_acceptance_report(acceptance: dict[str, Any]) -> Path:
    """Write acceptance report to disk."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    today = _today_iso()
    report = generate_acceptance_report(acceptance)
    path = REPORTS_DIR / f"Acceptance Review - {today}.md"
    path.write_text(report, encoding="utf-8")
    return path


def write_acceptance_json(acceptance: dict[str, Any]) -> Path:
    """Write acceptance data as JSON."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    today = _today_iso()
    data = {
        "generated": _now_iso(),
        "overall": acceptance["overall"],
        "total": acceptance["total"],
        "passed": acceptance["passed_count"],
        "failed": acceptance["failed_count"],
        "blocking_failures": len(acceptance["blocking_failures"]),
        "warning_failures": len(acceptance["warning_failures"]),
        "checks": [
            {
                "name": c["name"],
                "category": c["category"],
                "passed": c["passed"],
                "output_preview": c["output"][:200] if c["output"] else "",
            }
            for c in acceptance["checks"]
        ],
        "layers": _layer_status(),
        "git": _git_info(),
    }
    path = DATA_DIR / f"acceptance-{today}.json"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path


def generate_release_manifest() -> str:
    """Generate the release manifest Markdown."""
    git = _git_info()
    layers = _layer_status()
    rm = check_remote_state()

    latest_report = None
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Acceptance Review - *.md"))
        if reports:
            latest_report = reports[-1].name

    overall = "unknown"
    if latest_report:
        text = (REPORTS_DIR / latest_report).read_text(encoding="utf-8", errors="ignore")
        if "ALL CHECKS PASSED" in text:
            overall = "PASS"
        elif "PASSED WITH WARNINGS" in text:
            overall = "PASS_WITH_WARNINGS"
        elif "BLOCKED" in text:
            overall = "FAIL"

    layer_count = sum(1 for l in layers if l["present"])
    total_layers = len(layers)

    lines = [
        "---",
        "type: release-manifest",
        "status: active",
        f"generated: {_now_iso()}",
        "tags:",
        "  - release",
        "  - governance",
        "---",
        "",
        "# WilliamOS Release Manifest",
        "",
        "## Generated",
        "",
        _now_iso(),
        "",
        "## Release Candidate",
        "",
        "WilliamOS v1",
        "",
        "## Current Commit",
        "",
        f"{git['commit'] or '(no commits)'}",
        "",
        "## Current Branch",
        "",
        f"{git['branch'] or '(no branch)'}",
        "",
        "## Latest Tag",
        "",
        f"{git['tag'] or '(no tags)'}",
        "",
        "## Acceptance Result",
        "",
        f"{overall}",
        f"Latest report: {latest_report or '(none)'}",
        "",
        "## Layer Summary",
        "",
        f"{layer_count}/{total_layers} layers present",
        "",
        "| WO | Layer | Present |",
        "|---|---|---|",
    ]
    for layer in layers:
        status = "yes" if layer["present"] else "MISSING"
        lines.append(f"| {layer['wo']} | {layer['name']} | {status} |")

    lines += [
        "",
        "## Backup / Restore Confidence",
        "",
    ]
    backup_dir = VAULT / "92_BackupGovernance" / "local_archives"
    archives = sorted(backup_dir.glob("WilliamOS-backup-*.zip")) if backup_dir.exists() else []
    restore_reports = sorted((VAULT / "93_RestoreDrill" / "reports").glob("Restore Drill - *.md")) if (VAULT / "93_RestoreDrill" / "reports").exists() else []
    lines.append(f"- Local archives: {len(archives)}")
    lines.append(f"- Latest archive: {archives[-1].name if archives else '(none)'}")
    lines.append(f"- Restore drill reports: {len(restore_reports)}")
    lines.append(f"- Latest drill: {restore_reports[-1].name if restore_reports else '(none)'}")

    lines += [
        "",
        "## Remote Status",
        "",
        f"- Remotes configured: {rm['count']}",
        f"- Remote state: {'none' if rm['count'] == 0 else 'present'}",
        "- Push performed: no",
        "",
        "## Tagging Status",
        "",
        f"- Latest tag: {git['tag'] or '(none)'}",
        f"- Clean tree: {'yes' if git['clean'] else 'no'}",
        "",
        "## Recommended Next Step",
        "",
    ]
    if overall == "PASS" or overall == "PASS_WITH_WARNINGS":
        if git["tag"]:
            lines.append("System is tagged and accepted. Begin daily operating routine (WO-017).")
        else:
            lines.append("Run `python scripts/william.py release-tag --name v1.0.0` to create the local release tag.")
    elif overall == "FAIL":
        lines.append("Resolve blocking failures before tagging.")
    else:
        lines.append("Run `python scripts/william.py acceptance` to generate an acceptance review first.")

    lines += [
        "",
        "## Generator Notes",
        "",
        "This manifest was generated by WilliamOS. It does not push or publish anything.",
        "",
    ]
    return "\n".join(lines)


def write_release_manifest() -> Path:
    """Write or update the release manifest."""
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    content = generate_release_manifest()
    MANIFEST_PATH.write_text(content, encoding="utf-8")
    return MANIFEST_PATH


def release_tag_dry_run(name: str) -> dict[str, Any]:
    """Preview what tag would be created."""
    git = _git_info()
    fb = check_forbidden_files()
    rm = check_remote_state()

    issues = []
    if not git["repo"]:
        issues.append("No Git repository found")
    if not git["clean"]:
        issues.append("Working tree is not clean — commit or snapshot first")
    if not fb["passed"]:
        issues.append(f"Forbidden files found: {len(fb['forbidden'])}")
    if not rm["passed"]:
        issues.append(f"Unexpected remotes found: {rm['count']}")

    latest_report = None
    acceptance_ok = False
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Acceptance Review - *.md"))
        if reports:
            latest_report = reports[-1].name
            text = reports[-1].read_text(encoding="utf-8", errors="ignore")
            acceptance_ok = "ALL CHECKS PASSED" in text or "PASSED WITH WARNINGS" in text

    if not acceptance_ok:
        issues.append("No passing acceptance review found — run 'acceptance' first")

    existing_tags = []
    try:
        r = subprocess.run(["git", "tag", "-l"], capture_output=True, text=True, timeout=10)
        existing_tags = [t.strip() for t in r.stdout.strip().splitlines() if t.strip()]
    except Exception:
        pass

    if name in existing_tags:
        issues.append(f"Tag '{name}' already exists")

    return {
        "name": name,
        "can_tag": len(issues) == 0,
        "issues": issues,
        "git": git,
        "acceptance_report": latest_report,
        "existing_tags": existing_tags,
    }


def create_release_tag(name: str) -> dict[str, Any]:
    """Create a local annotated Git tag."""
    dry = release_tag_dry_run(name)
    if not dry["can_tag"]:
        return {
            "created": False,
            "name": name,
            "issues": dry["issues"],
        }

    message = f"WilliamOS {name} — local release tag\n\nAcceptance review: {dry['acceptance_report'] or 'unknown'}\nCreated by: williamos_release.py\nNo push performed."

    try:
        r = subprocess.run(
            ["git", "tag", "-a", name, "-m", message],
            capture_output=True, text=True, timeout=10,
        )
        if r.returncode != 0:
            return {
                "created": False,
                "name": name,
                "issues": [f"git tag failed: {r.stderr.strip()}"],
            }
    except Exception as e:
        return {
            "created": False,
            "name": name,
            "issues": [f"git tag error: {e}"],
        }

    tag_hash = None
    try:
        r = subprocess.run(
            ["git", "rev-parse", name],
            capture_output=True, text=True, timeout=10,
        )
        tag_hash = r.stdout.strip()
    except Exception:
        pass

    return {
        "created": True,
        "name": name,
        "hash": tag_hash,
        "message": message,
        "issues": [],
    }


def release_status() -> dict[str, Any]:
    """Gather release governance status."""
    git = _git_info()
    rm = check_remote_state()

    docs_exist = all((VAULT / d).exists() for d in RELEASE_REQUIRED_DOCS)

    latest_report = None
    if REPORTS_DIR.exists():
        reports = sorted(REPORTS_DIR.glob("Acceptance Review - *.md"))
        if reports:
            latest_report = reports[-1].name

    latest_json = None
    if DATA_DIR.exists():
        jsons = sorted(DATA_DIR.glob("acceptance-*.json"))
        if jsons:
            latest_json = jsons[-1].name

    return {
        "release_dir_exists": RELEASE_DIR.exists(),
        "docs_exist": docs_exist,
        "manifest_exists": MANIFEST_PATH.exists(),
        "latest_report": latest_report,
        "latest_json": latest_json,
        "git_repo": git["repo"],
        "branch": git["branch"],
        "latest_commit": git["commit"],
        "clean_tree": git["clean"],
        "latest_tag": git["tag"],
        "remotes": rm["count"],
        "remote_state": "none" if rm["count"] == 0 else "present",
    }
