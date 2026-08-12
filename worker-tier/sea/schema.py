"""Structured schemas + tolerant parsers for the edit-adapter contract.

The model is required to answer with JSON only. We parse defensively: a well-formed
`{"edits":[...]}` object is the contract, but we also accept a bare edit object or a
top-level list, and for reviews we fall back to a plain `PASS` / `FAIL: reason` line.
Everything that cannot be coerced into a valid, safe structure is REJECTED (fail-closed).
"""
from __future__ import annotations

import json
from dataclasses import dataclass

VALID_OPS = ("replace", "rewrite")


@dataclass
class Edit:
    file: str
    operation: str
    old_text: str | None = None
    new_text: str | None = None
    content: str | None = None

    @staticmethod
    def from_dict(d: object) -> "Edit":
        if not isinstance(d, dict):
            raise ValueError("edit must be a JSON object")
        file = d.get("file")
        op = d.get("operation")
        if not isinstance(file, str) or not file.strip():
            raise ValueError("edit.file must be a non-empty string")
        if op not in VALID_OPS:
            raise ValueError(f"edit.operation must be one of {VALID_OPS}, got {op!r}")
        e = Edit(
            file=file,
            operation=op,
            old_text=d.get("old_text"),
            new_text=d.get("new_text"),
            content=d.get("content"),
        )
        if op == "replace":
            if not isinstance(e.old_text, str) or e.old_text == "":
                raise ValueError("replace requires a non-empty string 'old_text'")
            if not isinstance(e.new_text, str):
                raise ValueError("replace requires a string 'new_text'")
        elif op == "rewrite":
            if not isinstance(e.content, str):
                raise ValueError("rewrite requires a string 'content'")
        return e


def parse_edits(raw: str) -> tuple[list[Edit] | None, str | None]:
    """Return (edits, None) on success or (None, error) on any malformation."""
    try:
        obj = json.loads(raw)
    except Exception as ex:  # noqa: BLE001 - report any JSON failure verbatim to the model
        return None, f"response is not valid JSON ({ex})"

    if isinstance(obj, list):
        items = obj
    elif isinstance(obj, dict) and "edits" in obj:
        items = obj["edits"]
    elif isinstance(obj, dict) and "file" in obj and "operation" in obj:
        items = [obj]
    else:
        return None, 'response must be a JSON object with an "edits" array'

    if not isinstance(items, list) or not items:
        return None, '"edits" must be a non-empty array'

    edits: list[Edit] = []
    for i, it in enumerate(items):
        try:
            edits.append(Edit.from_dict(it))
        except ValueError as ve:
            return None, f"edits[{i}]: {ve}"
    return edits, None


@dataclass
class Verdict:
    verdict: str  # "PASS" | "FAIL"
    reason: str = ""
    suggested_fix: str = ""


def parse_verdict(raw: str) -> tuple[Verdict | None, str | None]:
    raw = (raw or "").strip()
    try:
        obj = json.loads(raw)
    except Exception:  # noqa: BLE001 - tolerate a plain verdict line
        line = raw.splitlines()[0] if raw else ""
        up = line.upper()
        if up.startswith("PASS"):
            return Verdict("PASS"), None
        if up.startswith("FAIL"):
            return Verdict("FAIL", line.split(":", 1)[1].strip() if ":" in line else ""), None
        return None, "verdict is neither JSON nor a PASS/FAIL line"

    if not isinstance(obj, dict):
        return None, "verdict JSON must be an object"
    v = str(obj.get("verdict", "")).upper()
    if v not in ("PASS", "FAIL"):
        return None, 'verdict must be "PASS" or "FAIL"'
    return Verdict(v, str(obj.get("reason", "")), str(obj.get("suggested_fix", ""))), None
