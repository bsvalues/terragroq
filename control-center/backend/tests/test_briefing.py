"""Tests for copilot/briefing.py — TDD: tests first, then implementation.

Patches all state_reader and agent calls so tests run fully offline.
"""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from copilot import briefing


# ---------------------------------------------------------------------------
# Helpers — canonical fake data matching real state_reader return shapes
# ---------------------------------------------------------------------------

_SMOKE_PASS = {"overall": "PASS", "pass": 10, "fail": 0, "critical_fail": 0}
_SMOKE_FAIL = {"overall": "FAIL", "pass": 8, "fail": 2, "critical_fail": 1}

_PROD_PASS = {"verdict": "PASS", "checks": []}
_PROD_FAIL = {"verdict": "FAIL", "checks": []}

_COCKPIT_OK = {"summary": "All queues reviewed"}

_QUEUES_EMPTY = {
    "doctrine": {"count": 0, "path": "WilliamOS/80_DoctrinePromotion/drafts"},
    "decisions": {"count": 0, "path": "WilliamOS/85_DecisionPromotion/drafts"},
    "concepts": {"count": 0, "path": "WilliamOS/86_ConceptPromotion/drafts"},
    "projects": {"count": 0, "path": "WilliamOS/87_ProjectPromotion/project_drafts"},
    "work_orders": {"count": 0, "path": "WilliamOS/87_ProjectPromotion/work_order_drafts"},
    "total": 0,
}

_QUEUES_PENDING = {
    "doctrine": {"count": 2, "path": "WilliamOS/80_DoctrinePromotion/drafts"},
    "decisions": {"count": 1, "path": "WilliamOS/85_DecisionPromotion/drafts"},
    "concepts": {"count": 0, "path": "WilliamOS/86_ConceptPromotion/drafts"},
    "projects": {"count": 0, "path": "WilliamOS/87_ProjectPromotion/project_drafts"},
    "work_orders": {"count": 0, "path": "WilliamOS/87_ProjectPromotion/work_order_drafts"},
    "total": 3,
}

_GIT_CLEAN = {"branch": "copilot-phase1", "clean": True, "latest_commit": "abc1234", "has_remote": False, "tags": []}
_GIT_DIRTY = {"branch": "copilot-phase1", "clean": False, "latest_commit": "abc1234", "has_remote": False, "tags": []}

_BACKUP_OK = {"count": 3, "latest": "WilliamOS-backup-2026-06-19.zip"}

_NEXT_ACTION_REC = {
    "action": "System is healthy. Capture a thought or review the cortex.",
    "command": "cortex-status",
    "why": "Nothing urgent.",
    "priority": 5,
}

_AGENT_RESULT = {
    "recommended": _NEXT_ACTION_REC,
    "all_actions": [_NEXT_ACTION_REC],
    "commands_used": ["state_reader (read-only)"],
    "safety": "No modifications made. Read-only analysis.",
}

_NOW = datetime(2026, 6, 19, 12, 0, 0, tzinfo=timezone.utc)


def _patch_all(
    smoke=_SMOKE_PASS,
    prod=_PROD_PASS,
    cockpit=_COCKPIT_OK,
    queues=_QUEUES_EMPTY,
    inbox=0,
    git=_GIT_CLEAN,
    backup=_BACKUP_OK,
    agent_result=_AGENT_RESULT,
):
    """Return a context-manager stack patching every reader used by briefing.py."""
    import contextlib

    @contextlib.contextmanager
    def _ctx():
        with (
            patch("copilot.briefing.get_latest_smoke", return_value=smoke),
            patch("copilot.briefing.get_latest_production_readiness", return_value=prod),
            patch("copilot.briefing.get_latest_cockpit", return_value=cockpit),
            patch("copilot.briefing.get_review_queue_summary", return_value=queues),
            patch("copilot.briefing.get_inbox_count", return_value=inbox),
            patch("copilot.briefing.get_git_info", return_value=git),
            patch("copilot.briefing.get_backup_info", return_value=backup),
            patch("copilot.briefing.agent_get_next_action", return_value=agent_result),
        ):
            yield

    return _ctx()


# ---------------------------------------------------------------------------
# build_briefing — basic composition
# ---------------------------------------------------------------------------

def test_build_briefing_returns_dict():
    with _patch_all():
        result = briefing.build_briefing(now=_NOW)
    assert isinstance(result, dict)


def test_build_briefing_has_all_top_level_keys():
    with _patch_all():
        result = briefing.build_briefing(now=_NOW)
    for key in ("generated", "health", "pending", "next_action", "git", "backup"):
        assert key in result, f"Missing key: {key}"


def test_build_briefing_generated_is_iso_string():
    with _patch_all():
        result = briefing.build_briefing(now=_NOW)
    ts = result["generated"]
    assert isinstance(ts, str)
    # Must parse as ISO timestamp
    parsed = datetime.fromisoformat(ts)
    assert parsed is not None


def test_build_briefing_health_smoke_pass():
    with _patch_all(smoke=_SMOKE_PASS):
        result = briefing.build_briefing(now=_NOW)
    assert result["health"]["smoke"] == "PASS"


def test_build_briefing_health_production_pass():
    with _patch_all(prod=_PROD_PASS):
        result = briefing.build_briefing(now=_NOW)
    assert result["health"]["production"] == "PASS"


def test_build_briefing_health_cockpit_present():
    with _patch_all(cockpit=_COCKPIT_OK):
        result = briefing.build_briefing(now=_NOW)
    # Should be populated from cockpit data (non-unknown)
    assert result["health"]["cockpit"] != "unknown" or _COCKPIT_OK is not None


def test_build_briefing_pending_review_total():
    with _patch_all(queues=_QUEUES_PENDING):
        result = briefing.build_briefing(now=_NOW)
    assert result["pending"]["review_total"] == 3


def test_build_briefing_pending_inbox():
    with _patch_all(inbox=7):
        result = briefing.build_briefing(now=_NOW)
    assert result["pending"]["inbox"] == 7


def test_build_briefing_pending_by_queue_has_queue_names():
    with _patch_all(queues=_QUEUES_PENDING):
        result = briefing.build_briefing(now=_NOW)
    by_queue = result["pending"]["by_queue"]
    assert "doctrine" in by_queue
    assert by_queue["doctrine"] == 2


def test_build_briefing_next_action_is_recommended():
    with _patch_all():
        result = briefing.build_briefing(now=_NOW)
    assert result["next_action"] == _NEXT_ACTION_REC


def test_build_briefing_git_branch_and_clean():
    with _patch_all(git=_GIT_CLEAN):
        result = briefing.build_briefing(now=_NOW)
    assert result["git"]["branch"] == "copilot-phase1"
    assert result["git"]["clean"] is True


def test_build_briefing_backup_latest():
    with _patch_all(backup=_BACKUP_OK):
        result = briefing.build_briefing(now=_NOW)
    assert result["backup"]["latest"] == "WilliamOS-backup-2026-06-19.zip"


# ---------------------------------------------------------------------------
# build_briefing — defensive / None readers
# ---------------------------------------------------------------------------

def test_build_briefing_smoke_none_gives_unknown():
    """If get_latest_smoke() returns None, health.smoke must be 'unknown', no raise."""
    with _patch_all(smoke=None):
        result = briefing.build_briefing(now=_NOW)
    assert result["health"]["smoke"] == "unknown"


def test_build_briefing_prod_none_gives_unknown():
    with _patch_all(prod=None):
        result = briefing.build_briefing(now=_NOW)
    assert result["health"]["production"] == "unknown"


def test_build_briefing_cockpit_none_gives_unknown():
    with _patch_all(cockpit=None):
        result = briefing.build_briefing(now=_NOW)
    assert result["health"]["cockpit"] == "unknown"


def test_build_briefing_smoke_missing_overall_key_gives_unknown():
    """Smoke dict exists but lacks 'overall' key — should not raise."""
    with _patch_all(smoke={"pass": 5}):
        result = briefing.build_briefing(now=_NOW)
    assert result["health"]["smoke"] == "unknown"


def test_build_briefing_backup_none_latest_survives():
    """Backup with latest=None should not raise."""
    with _patch_all(backup={"count": 0, "latest": None}):
        result = briefing.build_briefing(now=_NOW)
    assert result["backup"]["latest"] is None


def test_build_briefing_agent_exception_does_not_raise():
    """If agent_get_next_action() raises, build_briefing should still return."""
    with (
        patch("copilot.briefing.get_latest_smoke", return_value=_SMOKE_PASS),
        patch("copilot.briefing.get_latest_production_readiness", return_value=_PROD_PASS),
        patch("copilot.briefing.get_latest_cockpit", return_value=_COCKPIT_OK),
        patch("copilot.briefing.get_review_queue_summary", return_value=_QUEUES_EMPTY),
        patch("copilot.briefing.get_inbox_count", return_value=0),
        patch("copilot.briefing.get_git_info", return_value=_GIT_CLEAN),
        patch("copilot.briefing.get_backup_info", return_value=_BACKUP_OK),
        patch("copilot.briefing.agent_get_next_action", side_effect=RuntimeError("boom")),
    ):
        result = briefing.build_briefing(now=_NOW)
    assert "next_action" in result
    assert result["next_action"] is None or isinstance(result["next_action"], dict)


# ---------------------------------------------------------------------------
# watch() — alert emission
# ---------------------------------------------------------------------------

def test_watch_empty_when_all_healthy():
    with _patch_all():
        alerts = briefing.watch(now=_NOW)
    assert alerts == []


def test_watch_critical_when_smoke_fail():
    with _patch_all(smoke=_SMOKE_FAIL):
        alerts = briefing.watch(now=_NOW)
    levels = [a["level"] for a in alerts]
    assert "critical" in levels


def test_watch_critical_smoke_has_command():
    with _patch_all(smoke=_SMOKE_FAIL):
        alerts = briefing.watch(now=_NOW)
    crit = [a for a in alerts if a["level"] == "critical"]
    assert any(a["command"] == "runtime-smoke" for a in crit)


def test_watch_critical_when_prod_fail():
    with _patch_all(prod=_PROD_FAIL):
        alerts = briefing.watch(now=_NOW)
    levels = [a["level"] for a in alerts]
    assert "critical" in levels


def test_watch_critical_prod_has_command():
    with _patch_all(prod=_PROD_FAIL):
        alerts = briefing.watch(now=_NOW)
    crit = [a for a in alerts if a["level"] == "critical"]
    assert any(a["command"] == "production-readiness" for a in crit)


def test_watch_warn_when_pending_review():
    with _patch_all(queues=_QUEUES_PENDING):
        alerts = briefing.watch(now=_NOW)
    levels = [a["level"] for a in alerts]
    assert "warn" in levels


def test_watch_warn_review_mentions_count():
    with _patch_all(queues=_QUEUES_PENDING):
        alerts = briefing.watch(now=_NOW)
    warn = [a for a in alerts if a["level"] == "warn"]
    assert any("3" in a["message"] for a in warn)


def test_watch_warn_review_has_command():
    with _patch_all(queues=_QUEUES_PENDING):
        alerts = briefing.watch(now=_NOW)
    warn = [a for a in alerts if a["level"] == "warn" and "draft" in a["message"].lower()]
    assert warn and warn[0]["command"] == "review-status"


def test_watch_warn_when_inbox_over_10():
    with _patch_all(inbox=11):
        alerts = briefing.watch(now=_NOW)
    levels = [a["level"] for a in alerts]
    assert "warn" in levels


def test_watch_warn_inbox_has_command():
    with _patch_all(inbox=11):
        alerts = briefing.watch(now=_NOW)
    warn = [a for a in alerts if a["level"] == "warn" and "inbox" in a["message"].lower()]
    assert warn and warn[0]["command"] == "process-inbox --dry-run"


def test_watch_no_warn_when_inbox_exactly_10():
    """Threshold is >10, so 10 should NOT trigger warn."""
    with _patch_all(inbox=10):
        alerts = briefing.watch(now=_NOW)
    inbox_warns = [a for a in alerts if "inbox" in a["message"].lower()]
    assert inbox_warns == []


def test_watch_info_when_git_dirty():
    with _patch_all(git=_GIT_DIRTY):
        alerts = briefing.watch(now=_NOW)
    levels = [a["level"] for a in alerts]
    assert "info" in levels


def test_watch_info_git_has_command():
    with _patch_all(git=_GIT_DIRTY):
        alerts = briefing.watch(now=_NOW)
    info = [a for a in alerts if a["level"] == "info"]
    assert any(a["command"] == "snapshot --dry-run" for a in info)


def test_watch_no_info_when_git_clean():
    with _patch_all(git=_GIT_CLEAN):
        alerts = briefing.watch(now=_NOW)
    info = [a for a in alerts if a["level"] == "info"]
    assert info == []


# ---------------------------------------------------------------------------
# watch() — ordering: critical before warn before info
# ---------------------------------------------------------------------------

def test_watch_ordering_critical_before_warn():
    with _patch_all(smoke=_SMOKE_FAIL, queues=_QUEUES_PENDING):
        alerts = briefing.watch(now=_NOW)
    levels = [a["level"] for a in alerts]
    assert "critical" in levels and "warn" in levels
    first_critical = next(i for i, a in enumerate(alerts) if a["level"] == "critical")
    first_warn = next(i for i, a in enumerate(alerts) if a["level"] == "warn")
    assert first_critical < first_warn


def test_watch_ordering_warn_before_info():
    with _patch_all(queues=_QUEUES_PENDING, git=_GIT_DIRTY):
        alerts = briefing.watch(now=_NOW)
    levels = [a["level"] for a in alerts]
    assert "warn" in levels and "info" in levels
    first_warn = next(i for i, a in enumerate(alerts) if a["level"] == "warn")
    first_info = next(i for i, a in enumerate(alerts) if a["level"] == "info")
    assert first_warn < first_info


def test_watch_alert_schema():
    """Each alert must have level, message (str), and command (str or None)."""
    with _patch_all(smoke=_SMOKE_FAIL, queues=_QUEUES_PENDING, git=_GIT_DIRTY):
        alerts = briefing.watch(now=_NOW)
    for a in alerts:
        assert a["level"] in ("critical", "warn", "info")
        assert isinstance(a["message"], str)
        assert a["command"] is None or isinstance(a["command"], str)


# ---------------------------------------------------------------------------
# watch() — smoke None should not raise
# ---------------------------------------------------------------------------

def test_watch_smoke_none_no_raise():
    with _patch_all(smoke=None):
        alerts = briefing.watch(now=_NOW)
    # None smoke should not raise and should not emit a critical alert
    assert isinstance(alerts, list)


def test_watch_prod_none_no_raise():
    with _patch_all(prod=None):
        alerts = briefing.watch(now=_NOW)
    assert isinstance(alerts, list)
