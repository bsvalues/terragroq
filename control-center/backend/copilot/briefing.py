"""WilliamOS Co-Pilot — Briefing and Watchdog.

build_briefing(now=None) -> dict
    Compose a point-in-time status briefing from all readers.
    Defensive: any reader returning None/missing keys fills with "unknown"/0.
    Never raises.

watch(now=None) -> list[dict]
    Return alert dicts for anything requiring attention.
    Each: {"level": "critical"|"warn"|"info", "message": str, "command": str|None}
    Ordered: critical first, then warn, then info.
    Returns [] when everything is healthy/empty.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# sys.path: ensure state_reader and agent are importable (mirrors copilot/__init__.py)
# ---------------------------------------------------------------------------
_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

# ---------------------------------------------------------------------------
# Import state readers
# ---------------------------------------------------------------------------
from state_reader import (
    get_latest_smoke,
    get_latest_production_readiness,
    get_latest_cockpit,
    get_review_queue_summary,
    get_inbox_count,
    get_git_info,
    get_backup_info,
)

# Agent is imported with an alias so tests can patch it cleanly at
# copilot.briefing.agent_get_next_action
try:
    from agent import get_next_action as agent_get_next_action  # type: ignore
except Exception:  # pragma: no cover — only happens if agent.py is missing
    def agent_get_next_action() -> dict:  # type: ignore
        return {}

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_LEVEL_ORDER = {"critical": 0, "warn": 1, "info": 2}


def _safe_get(data: Optional[dict], key: str, default=None):
    """Return data[key] if data is a dict and key exists, else default."""
    if not isinstance(data, dict):
        return default
    return data.get(key, default)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_briefing(now: Optional[datetime] = None) -> dict:
    """Compose a briefing dict from all state readers.

    Parameters
    ----------
    now:
        Override the current timestamp (useful for testing).

    Returns
    -------
    dict with keys: generated, health, pending, next_action, git, backup
    """
    if now is None:
        now = datetime.now(timezone.utc)

    # -- health section -------------------------------------------------------
    smoke = None
    prod = None
    cockpit = None
    try:
        smoke = get_latest_smoke()
    except Exception:
        pass
    try:
        prod = get_latest_production_readiness()
    except Exception:
        pass
    try:
        cockpit = get_latest_cockpit()
    except Exception:
        pass

    smoke_overall = _safe_get(smoke, "overall", "unknown") or "unknown"
    prod_verdict = _safe_get(prod, "verdict", "unknown") or "unknown"
    # For cockpit we surface the summary string, or "unknown"
    if cockpit is None:
        cockpit_summary = "unknown"
    elif isinstance(cockpit, dict) and cockpit:
        cockpit_summary = cockpit.get("summary") or str(cockpit)
    else:
        cockpit_summary = "unknown"

    health = {
        "smoke": smoke_overall,
        "production": prod_verdict,
        "cockpit": cockpit_summary,
    }

    # -- pending section -------------------------------------------------------
    queues = {}
    inbox = 0
    try:
        queues = get_review_queue_summary() or {}
    except Exception:
        pass
    try:
        inbox = get_inbox_count() or 0
    except Exception:
        pass

    review_total = queues.get("total", 0) if isinstance(queues, dict) else 0
    by_queue = {
        k: (v["count"] if isinstance(v, dict) else 0)
        for k, v in queues.items()
        if k != "total" and isinstance(v, dict)
    }

    pending = {
        "review_total": review_total,
        "inbox": inbox,
        "by_queue": by_queue,
    }

    # -- next_action -----------------------------------------------------------
    next_action = None
    try:
        agent_result = agent_get_next_action()
        next_action = _safe_get(agent_result, "recommended")
    except Exception:
        pass

    # -- git -------------------------------------------------------------------
    git_raw = {}
    try:
        git_raw = get_git_info() or {}
    except Exception:
        pass

    git = {
        "branch": git_raw.get("branch", git_raw.get("latest_commit", "unknown")),
        "clean": git_raw.get("clean", "unknown"),
    }
    # Preserve any extra keys callers might rely on
    for k, v in git_raw.items():
        if k not in git:
            git[k] = v

    # -- backup ----------------------------------------------------------------
    backup_raw = {}
    try:
        backup_raw = get_backup_info() or {}
    except Exception:
        pass

    backup = {
        "latest": backup_raw.get("latest"),
    }
    for k, v in backup_raw.items():
        if k not in backup:
            backup[k] = v

    return {
        "generated": now.isoformat(),
        "health": health,
        "pending": pending,
        "next_action": next_action,
        "git": git,
        "backup": backup,
    }


def watch(now: Optional[datetime] = None) -> list[dict]:
    """Return watchdog alerts sorted critical -> warn -> info.

    Returns [] when everything is healthy/empty. Never raises.
    """
    briefing = build_briefing(now=now)
    alerts: list[dict] = []

    # -- health checks ---------------------------------------------------------
    smoke_val = briefing["health"]["smoke"]
    if smoke_val not in ("PASS", "unknown"):
        alerts.append({
            "level": "critical",
            "message": f"Smoke suite result: {smoke_val}",
            "command": "runtime-smoke",
        })

    prod_val = briefing["health"]["production"]
    if prod_val not in ("PASS", "unknown"):
        alerts.append({
            "level": "critical",
            "message": f"Production readiness verdict: {prod_val}",
            "command": "production-readiness",
        })

    # -- pending checks --------------------------------------------------------
    review_total = briefing["pending"]["review_total"]
    if review_total > 0:
        alerts.append({
            "level": "warn",
            "message": f"{review_total} drafts awaiting review",
            "command": "review-status",
        })

    inbox_count = briefing["pending"]["inbox"]
    if inbox_count > 10:
        alerts.append({
            "level": "warn",
            "message": f"inbox has {inbox_count} items",
            "command": "process-inbox --dry-run",
        })

    # -- git check -------------------------------------------------------------
    git_clean = briefing["git"].get("clean")
    if git_clean is False:
        alerts.append({
            "level": "info",
            "message": "uncommitted changes",
            "command": "snapshot --dry-run",
        })

    # -- sort by level priority ------------------------------------------------
    alerts.sort(key=lambda a: _LEVEL_ORDER.get(a["level"], 99))

    return alerts
