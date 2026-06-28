"""Tests for DevOps playbook coverage in Control Center smoke."""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path


_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS = str(_ROOT / "scripts")
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

import williamos_control_center


class FakeResponse:
    status = 200

    def __init__(self, data: dict):
        self._data = data

    def read(self) -> bytes:
        return json.dumps(self._data).encode()


def test_devops_smoke_checks_cover_playbook_goal_and_loop(monkeypatch):
    requests: list[tuple[str, dict | None]] = []

    def fake_urlopen(req, timeout=5):  # noqa: ARG001
        url = req if isinstance(req, str) else req.full_url
        body = None
        if not isinstance(req, str) and req.data:
            body = json.loads(req.data.decode())
        requests.append((url, body))

        if url.endswith("/api/devops/playbook"):
            return FakeResponse(
                {
                    "ok": True,
                    "mode": "devops-playbook-operational",
                    "first_slices": [{"wo_id": f"WO-WILLIAMOS-DEVOPS-00{i}"} for i in range(1, 6)],
                    "mistake_patterns": [{"pattern_id": f"MP-{i:03d}"} for i in range(1, 11)],
                    "handoff_banner": {"MUTATION_AUTHORITY": "NO unless explicitly stated"},
                }
            )
        if url.endswith("/api/devops/current-truth"):
            return FakeResponse(
                {
                    "ok": True,
                    "current_truth": {
                        "phase_6_status": "blocked",
                        "posture": "HOLD",
                        "blocked": ["Phase 6 proactive behavior"],
                    },
                }
            )
        if url.endswith("/api/devops/goal"):
            return FakeResponse(
                {
                    "ok": True,
                    "MODE": "EXECUTE",
                    "AUTHORITY_REQUESTED": "A2_LOCAL_MUTATION",
                    "AUTHORITY_GRANTED": "A0_READ_ONLY",
                    "MISTAKE_PATTERN_MATCHES": [{"pattern_id": "MP-009"}],
                    "handoff_banner": {"MUTATION_AUTHORITY": "NO unless explicitly stated"},
                    "work_order_draft": {"STATUS": "draft"},
                }
            )
        if url.endswith("/api/devops/loop"):
            return FakeResponse(
                {
                    "ok": True,
                    "LOOP_TYPE": "VERIFY",
                    "AUTHORITY": "A0_READ_ONLY",
                    "STOP_REASON": "STOP: max iterations reached after non-executing plan.",
                }
            )
        raise AssertionError(f"unexpected URL: {url}")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    checks = williamos_control_center._devops_smoke_checks()

    assert checks == {
        "devops_playbook": "PASS",
        "devops_current_truth": "PASS",
        "devops_goal_classifier": "PASS",
        "devops_loop_planner": "PASS",
    }
    assert any(body and body.get("authority") == "A2_LOCAL_MUTATION" for _, body in requests)
    assert any(body and body.get("loop_type") == "verify" for _, body in requests)
