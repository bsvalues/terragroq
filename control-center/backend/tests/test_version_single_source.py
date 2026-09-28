"""One release must report one version number.

The operations audit found three numbers for the same release: the FastAPI app
version, the /api/status version, a hard-coded engine string, and the git tags
(whose real latest was v1.3.1). The tag is the source of truth.
"""

import re
import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parent.parent)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import state_reader


def test_version_is_resolved_from_the_git_tag():
    info = state_reader.get_version_info()

    assert info["version_source"] == "git-tag"
    assert re.fullmatch(r"v\d+(\.\d+)*", info["version"]), info["version"]
    assert info["version"] == info["latest_tag"]


def test_version_is_the_highest_tag_not_the_lexicographic_one():
    # v1.3.1 > v1.3.0 > v1.2.0 lexicographically here, but v1.10.0 > v1.9.0 only
    # under numeric ordering. Confirm the ordering is numeric.
    assert state_reader._version_key("v1.10.0") > state_reader._version_key("v1.9.0")


def test_env_override_wins_and_is_labelled(monkeypatch):
    monkeypatch.setenv("WILLIAMOS_VERSION", "v9.9.9-test")

    info = state_reader.get_version_info()

    assert info["version"] == "v9.9.9-test"
    assert info["version_source"] == "env"


def test_status_endpoint_reports_the_same_version_as_the_resolver():
    import app
    from fastapi.testclient import TestClient

    client = TestClient(app.app)
    payload = client.get("/api/status").json()

    resolved = state_reader.get_version_info()
    assert payload["version"] == resolved["version"]
    assert payload["engine"] == f"WilliamOS {resolved['version']}"
