"""The CLI count probe must distinguish 'unknown' from 'zero'.

The operations audit found the command count had three different truths: the
registry reported one number, the test asserted another, and the live probe
returned ``0``. The zero was a failure being reported as a measurement — the
probe shelled out with a CWD-relative path and swallowed the error.
"""

import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS = str(_REPO_ROOT / "scripts")
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

import williamos_commands


def test_probe_measures_the_real_cli_regardless_of_cwd(monkeypatch, tmp_path):
    # The probe resolves the CLI against the repository root, not the caller's
    # working directory, so an unrelated CWD must not change the answer.
    monkeypatch.chdir(tmp_path)

    count = williamos_commands.count_cli_commands()

    assert count is not None
    assert count == len(williamos_commands.all_commands())


def test_probe_returns_none_never_zero_when_cli_is_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(williamos_commands, "CLI_PATH", tmp_path / "no-such-cli.py")

    # The whole point: an unknown count is None. Returning 0 here is what made a
    # broken probe look like a CLI with no commands.
    assert williamos_commands.count_cli_commands() is None


def test_status_marks_an_unmeasured_count_as_unknown(monkeypatch, tmp_path):
    monkeypatch.setattr(williamos_commands, "CLI_PATH", tmp_path / "no-such-cli.py")

    status = williamos_commands.command_status()

    assert status["cli_count"] is None
    assert status["cli_count_status"] == "UNKNOWN"
    # An unmeasured count is not agreement, so parity must not be claimed.
    assert status["parity"] is False
