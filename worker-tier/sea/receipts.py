"""Structured, tamper-evident-ish receipts for auditability.

Every model call, rejection, apply, and verify is appended as an event so a run can be replayed
and audited after the fact (the in-VM audit trail the acceptance requires). Time-free by default
so unit tests stay deterministic; the CLI stamps a wall-clock time at the top level.
"""
from __future__ import annotations

import json


class Receipt:
    def __init__(self, kind: str):
        self.kind = kind
        self.events: list[dict] = []

    def add(self, event: str, **data) -> None:
        self.events.append({"event": event, **data})

    def to_dict(self) -> dict:
        return {"kind": self.kind, "events": self.events}

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)
