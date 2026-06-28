"""WilliamOS Control Center — Local Operator Agent.

Deterministic. Reads state, recommends actions. Never modifies anything directly.
No external LLM required. All logic is rule-based.
"""

from state_reader import (
    get_home_summary,
    get_latest_smoke,
    get_latest_production_readiness,
    get_latest_cockpit,
    get_review_queue_summary,
    validate_review_path,
    get_review_item,
)


def get_next_action() -> dict:
    summary = get_home_summary()
    actions = []

    if not summary["today"]["exists"]:
        actions.append({
            "action": "Create today's daily note",
            "command": "today",
            "why": "No daily note yet. Start your day.",
            "priority": 1,
        })

    queues = summary["review_queues"]
    if queues["total"] > 0:
        top_queue = max(
            [(k, v) for k, v in queues.items() if k != "total" and isinstance(v, dict)],
            key=lambda x: x[1]["count"],
            default=None,
        )
        if top_queue and top_queue[1]["count"] > 0:
            actions.append({
                "action": f"Review {top_queue[0]} drafts ({top_queue[1]['count']} pending)",
                "command": f"{top_queue[0].rstrip('s')}-status" if top_queue[0] != "work_orders" else "project-status",
                "why": f"You have {queues['total']} drafts waiting for review across all queues.",
                "priority": 2,
            })

    if summary["inbox_count"] > 5:
        actions.append({
            "action": f"Process inbox ({summary['inbox_count']} notes)",
            "command": "process-inbox --dry-run",
            "why": "Inbox is getting full. Process to surface patterns.",
            "priority": 3,
        })

    smoke = get_latest_smoke()
    if smoke and smoke.get("overall") != "PASS":
        actions.append({
            "action": "Investigate smoke failures",
            "command": "runtime-smoke",
            "why": f"Last smoke result: {smoke.get('overall')}. {smoke.get('fail', 0)} failures.",
            "priority": 1,
        })

    if not actions:
        actions.append({
            "action": "System is healthy. Capture a thought or review the cortex.",
            "command": "cortex-status",
            "why": "Nothing urgent. Good time for reflection.",
            "priority": 5,
        })

    actions.sort(key=lambda a: a["priority"])
    return {
        "recommended": actions[0],
        "all_actions": actions,
        "commands_used": ["state_reader (read-only)"],
        "safety": "No modifications made. Read-only analysis.",
    }


def summarize_today() -> dict:
    summary = get_home_summary()
    cockpit = get_latest_cockpit()

    lines = []
    lines.append(f"Date: {summary['today']['date']}")
    lines.append(f"Daily note: {'exists' if summary['today']['exists'] else 'not yet created'}")
    lines.append(f"Inbox: {summary['inbox_count']} notes")
    lines.append(f"Review queue: {summary['review_queues']['total']} drafts pending")
    lines.append(f"Backups: {summary['backup']['count']} archives")
    lines.append(f"Git: {summary['git']['latest_commit'] or 'unknown'}")
    lines.append(f"Remote: {'YES — investigate' if summary['git']['has_remote'] else 'none (correct)'}")
    lines.append(f"Tags: {', '.join(summary['git']['tags']) if summary['git']['tags'] else 'none'}")

    return {
        "summary": "\n".join(lines),
        "data": summary,
        "commands_used": ["state_reader (read-only)"],
        "safety": "No modifications made.",
    }


def explain_review_queues() -> dict:
    queues = get_review_queue_summary()
    total = queues.get("total", 0)
    if total == 0:
        return {
            "summary": "All review queues are empty. No drafts are waiting.",
            "recommendation": "Good time to capture new ideas or run a weekly review.",
            "commands_used": ["state_reader (read-only)"],
            "safety": "No modifications made.",
        }

    lines = []
    for name, q in queues.items():
        if name == "total" or not isinstance(q, dict):
            continue
        if q["count"] > 0:
            lines.append(f"  {name}: {q['count']} drafts in {q['path']}")

    return {
        "summary": f"{total} drafts waiting for review across all queues.",
        "detail": "\n".join(lines),
        "recommendation": "Start with the queue that has the most items. Use 'review-queues' to see details.",
        "why": "Drafts in review queues are ideas, decisions, or doctrine that were promoted from the inbox but haven't been accepted into official folders yet. They need human review before becoming part of the permanent system.",
        "commands_used": ["state_reader (read-only)"],
        "safety": "No modifications made.",
    }


def explain_health() -> dict:
    summary = get_home_summary()
    smoke = get_latest_smoke()
    prod = get_latest_production_readiness()

    checks = []
    all_ok = True

    if summary["git"]["has_remote"]:
        checks.append({"check": "Git remote", "status": "WARNING", "detail": "A remote was detected. WilliamOS should be local-only."})
        all_ok = False
    else:
        checks.append({"check": "Git remote", "status": "OK", "detail": "No remote. Correct."})

    if summary["backup"]["count"] > 0:
        checks.append({"check": "Backups", "status": "OK", "detail": f"{summary['backup']['count']} archives. Latest: {summary['backup']['latest']}"})
    else:
        checks.append({"check": "Backups", "status": "WARNING", "detail": "No backup archives found."})
        all_ok = False

    if smoke and smoke.get("overall") == "PASS":
        checks.append({"check": "Smoke suite", "status": "OK", "detail": "Last smoke: PASS"})
    elif smoke:
        checks.append({"check": "Smoke suite", "status": "WARNING", "detail": f"Last smoke: {smoke.get('overall', 'UNKNOWN')}"})
        all_ok = False
    else:
        checks.append({"check": "Smoke suite", "status": "UNKNOWN", "detail": "No smoke results found."})

    if prod and prod.get("verdict") == "PASS":
        checks.append({"check": "Production gate", "status": "OK", "detail": "Last production readiness: PASS"})
    elif prod:
        checks.append({"check": "Production gate", "status": "WARNING", "detail": f"Last production readiness: {prod.get('verdict', 'UNKNOWN')}"})
        all_ok = False
    else:
        checks.append({"check": "Production gate", "status": "UNKNOWN", "detail": "No production readiness results found."})

    return {
        "overall": "HEALTHY" if all_ok else "NEEDS ATTENTION",
        "checks": checks,
        "why": "System health tracks whether WilliamOS is safe to use: no remote leaks, backups exist, runtime tests pass, and production gate is clear.",
        "commands_used": ["state_reader (read-only)"],
        "safety": "No modifications made.",
    }


def what_can_i_ignore() -> dict:
    summary = get_home_summary()
    queues = summary["review_queues"]

    ignorable = []

    if summary["inbox_count"] <= 3:
        ignorable.append("Inbox is manageable — no urgency to process.")

    empty_queues = [k for k, v in queues.items() if k != "total" and isinstance(v, dict) and v["count"] == 0]
    if empty_queues:
        ignorable.append(f"Empty review queues (no action needed): {', '.join(empty_queues)}")

    if summary["backup"]["count"] >= 2:
        ignorable.append("Backup coverage is solid — no need to run another backup today.")

    if not summary["git"]["has_remote"]:
        ignorable.append("No remote detected — git safety is fine, no action needed.")

    if summary["git"]["tags"]:
        ignorable.append(f"Release tags exist ({', '.join(summary['git']['tags'][-2:])}) — no tagging urgency.")

    if not ignorable:
        ignorable.append("Nothing is clearly ignorable right now. Review the agent's next action.")

    return {
        "summary": "Things you can safely skip today:",
        "items": ignorable,
        "why": "Not everything that shows a count needs your attention. This list highlights what's stable enough to leave alone.",
        "commands_used": ["state_reader (read-only)"],
        "safety": "No modifications made.",
    }


def review_draft(path_str: str) -> dict:
    validation = validate_review_path(path_str)
    if not validation["valid"]:
        return {"ok": False, "error": validation["reason"]}

    item = get_review_item(path_str)
    if not item.get("ok"):
        return item

    fm = item["frontmatter"]
    draft_type = fm.get("type", "unknown")

    quality = {}
    title = item["title"]
    quality["title"] = "good" if title and len(title) > 10 else ("needs_work" if title else "missing")

    skip_headings = {
        "Human Review Checklist", "Generator Notes",
        "Similar Existing Doctrine", "Similar Existing Projects",
        "Similar Existing Concepts", "Similar Existing Decisions",
    }
    placeholder_count = 0
    filled_count = 0
    placeholder_names = []
    for sec in item["sections"]:
        if sec["heading"] in skip_headings:
            continue
        if any(m in sec["content"] for m in ("(Draft", "(None identified", "(Define ")):
            placeholder_count += 1
            placeholder_names.append(sec["heading"])
        elif sec["content"].strip():
            filled_count += 1

    if placeholder_count + filled_count == 0:
        quality["content"] = "empty"
    elif placeholder_count == 0:
        quality["content"] = "complete"
    elif placeholder_count <= filled_count:
        quality["content"] = "partial"
    else:
        quality["content"] = "mostly_placeholder"

    has_evidence = any(s["heading"] == "Source Evidence" and s["content"].strip() for s in item["sections"])
    quality["evidence"] = "good" if has_evidence else "missing"

    concerns = []
    if placeholder_names:
        concerns.append(f"Placeholder sections need your words: {', '.join(placeholder_names)}")
    if item["checklist_done"] == 0 and item["checklist_total"] > 0:
        concerns.append("No checklist items completed yet")

    if quality["content"] == "complete" and item["checklist_done"] == item["checklist_total"]:
        recommendation = "Ready for acceptance. All sections filled, checklist complete."
    elif quality["content"] in ("complete", "partial"):
        recommendation = "Getting close. Fill remaining placeholders and complete the checklist."
    else:
        recommendation = "Needs work. Fill in the placeholder sections with your own thinking before reviewing."

    return {
        "ok": True,
        "summary": f"Draft {draft_type}: {item['title']}",
        "quality": quality,
        "checklist_status": f"{item['checklist_done']} of {item['checklist_total']} items complete",
        "concerns": concerns,
        "recommendation": recommendation,
        "commands_used": ["state_reader (read-only)"],
        "safety": "No modifications made. Read-only analysis.",
    }


def post_acceptance_guidance() -> dict:
    summary = get_home_summary()
    queues = summary["review_queues"]
    total_drafts = queues.get("total", 0)
    git = summary["git"]

    steps = []
    steps.append("Refresh review queues to see updated draft counts.")
    steps.append("Generate a closure checklist to track post-acceptance tasks.")
    steps.append("Run closure dry-run to preview what will be refreshed.")
    steps.append("Run closure to generate the closure report and refresh queues/cockpit.")
    steps.append("Run snapshot dry-run to see what a git snapshot would include.")

    snapshot_recommendation = "recommended" if not git.get("has_remote") else "caution"
    snapshot_note = (
        "Snapshot recommended — captures the acceptance in git history."
        if snapshot_recommendation == "recommended"
        else "Remote detected. Snapshot is local-only — verify no push will occur."
    )

    warnings = []
    if git.get("has_remote"):
        warnings.append("Git remote detected. Do not push after snapshot.")
    warnings.append("Do not auto-commit. Review the snapshot dry-run first.")
    warnings.append("Do not delete the original draft — it stays as audit trail.")

    return {
        "ok": True,
        "summary": "Post-acceptance guidance",
        "steps": steps,
        "remaining_drafts": total_drafts,
        "snapshot_recommendation": snapshot_recommendation,
        "snapshot_note": snapshot_note,
        "warnings": warnings,
        "safety": "Read-only analysis. No modifications made.",
    }


def summarize_safety() -> dict:
    prod = get_latest_production_readiness()
    smoke = get_latest_smoke()
    summary = get_home_summary()

    status = "HEALTHY"
    concerns = []

    if summary["git"]["has_remote"]:
        status = "WARNING"
        concerns.append("Git remote detected — WilliamOS should be local-only.")

    if smoke and smoke.get("critical_fail", 0) > 0:
        status = "CRITICAL"
        concerns.append(f"Critical smoke failures: {smoke['critical_fail']}")

    if prod and prod.get("verdict") != "PASS":
        status = "WARNING"
        concerns.append(f"Production readiness: {prod.get('verdict', 'UNKNOWN')}")

    if summary["backup"]["count"] == 0:
        status = "WARNING"
        concerns.append("No backup archives found.")

    if not concerns:
        concerns.append("All systems nominal.")

    return {
        "status": status,
        "concerns": concerns,
        "backup_count": summary["backup"]["count"],
        "latest_backup": summary["backup"]["latest"],
        "has_remote": summary["git"]["has_remote"],
        "latest_tag": summary["git"]["tags"][-1] if summary["git"]["tags"] else None,
        "commands_used": ["state_reader (read-only)"],
        "safety": "No modifications made.",
    }
