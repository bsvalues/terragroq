"""Tests for copilot/tools.py — tool catalog and safety-gated runner."""

from unittest.mock import patch

import pytest
from copilot import tools


# ---------------------------------------------------------------------------
# catalog
# ---------------------------------------------------------------------------

def test_catalog_has_registry_commands():
    names = [t["function"]["name"] for t in tools.catalog()]
    assert "backup-status" in names and len(names) >= 80


def test_catalog_schema_shape():
    """Each entry must be a function-type schema. WilliamOS commands have an
    'args' array parameter; synthetic tools (e.g. 'remember') may use a
    different parameter set."""
    for entry in tools.catalog():
        assert entry["type"] == "function"
        fn = entry["function"]
        assert "name" in fn
        assert "description" in fn
        assert "properties" in fn["parameters"]
        # WilliamOS command entries use an 'args' array; skip synthetic tools
        if fn["name"] != tools.REMEMBER:
            props = fn["parameters"]["properties"]
            assert "args" in props
            assert props["args"]["type"] == "array"


# ---------------------------------------------------------------------------
# run — safe path
# ---------------------------------------------------------------------------

def test_run_safe_executes():
    with patch("copilot.tools.command_runner.run_command",
               return_value={"ok": True, "stdout": "Backup: ok", "stderr": ""}):
        out = tools.run("backup-status", {})
    assert out["ok"] and "Backup" in out["observation"]


def test_run_safe_folds_stdout_stderr():
    with patch("copilot.tools.command_runner.run_command",
               return_value={"ok": True, "stdout": "out", "stderr": "err"}):
        out = tools.run("backup-status", {})
    assert "out" in out["observation"]
    assert "err" in out["observation"]


# ---------------------------------------------------------------------------
# run — confirm-required path
# ---------------------------------------------------------------------------

def test_run_confirm_blocks_until_confirmed():
    out = tools.run("snapshot", {"args": ["--message", "x"]}, confirmed=False)
    assert out["needs_confirm"] is True and out["ok"] is False


def test_run_confirm_executes_when_confirmed():
    with patch("copilot.tools.command_runner.run_command",
               return_value={"ok": True, "stdout": "snapshot done", "stderr": ""}):
        out = tools.run("snapshot", {"args": ["--message", "x"]}, confirmed=True)
    assert out["ok"] is True


def test_run_confirm_does_not_call_runner_when_unconfirmed():
    with patch("copilot.tools.command_runner.run_command") as mock_runner:
        out = tools.run("snapshot", {}, confirmed=False)
    mock_runner.assert_not_called()
    assert out["needs_confirm"] is True


# ---------------------------------------------------------------------------
# run — forbidden path
# ---------------------------------------------------------------------------

def test_run_forbidden_returns_not_ok():
    with patch("copilot.tools.command_runner.run_command") as mock_runner:
        out = tools.run("git-init", {})
    mock_runner.assert_not_called()
    assert out["ok"] is False
    assert out["needs_confirm"] is False
    assert "forbidden" in out["observation"].lower() or "not" in out["observation"].lower()


# ---------------------------------------------------------------------------
# run — unknown command
# ---------------------------------------------------------------------------

def test_run_unknown_command_returns_not_ok():
    with patch("copilot.tools.command_runner.run_command") as mock_runner:
        out = tools.run("totally-unknown-cmd-xyz", {})
    mock_runner.assert_not_called()
    assert out["ok"] is False


# ---------------------------------------------------------------------------
# run — args extraction
# ---------------------------------------------------------------------------

def test_run_passes_args_from_arguments():
    with patch("copilot.tools.command_runner.run_command",
               return_value={"ok": True, "stdout": "done", "stderr": ""}) as mock_runner:
        tools.run("backup-status", {"args": ["--verbose"]})
    # backup-status is safe (no confirm); confirmed flag passed through as-is (False default)
    mock_runner.assert_called_once_with("backup-status", ["--verbose"], False)


def test_run_empty_args_when_not_provided():
    with patch("copilot.tools.command_runner.run_command",
               return_value={"ok": True, "stdout": "done", "stderr": ""}) as mock_runner:
        tools.run("backup-status", {})
    mock_runner.assert_called_once_with("backup-status", [], False)


# ---------------------------------------------------------------------------
# remember tool — catalog and intercept
# ---------------------------------------------------------------------------

def test_catalog_includes_remember():
    """catalog() must include a 'remember' function with a 'fact' parameter."""
    names = [t["function"]["name"] for t in tools.catalog()]
    assert "remember" in names

    remember_entry = next(t for t in tools.catalog() if t["function"]["name"] == "remember")
    fn = remember_entry["function"]
    assert "fact" in fn["parameters"]["properties"]
    assert fn["parameters"]["properties"]["fact"]["type"] == "string"

    # Module-level constant must equal the tool name
    assert tools.REMEMBER == "remember"


def test_remember_tool_schema_has_required_fact():
    """The remember tool schema must mark 'fact' as required."""
    remember_entry = next(t for t in tools.catalog() if t["function"]["name"] == "remember")
    fn = remember_entry["function"]
    assert "required" in fn["parameters"]
    assert "fact" in fn["parameters"]["required"]


def test_run_remember_returns_error_not_routed():
    """If tools.run is ever called with 'remember', it must return an error (not route to safety)."""
    with patch("copilot.tools.safety.check_command") as mock_safety:
        out = tools.run("remember", {"fact": "test"})
    # safety.check_command must NOT be called for remember
    mock_safety.assert_not_called()
    assert out["ok"] is False
    assert "loop" in out["observation"].lower() or "remember" in out["observation"].lower()
