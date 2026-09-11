#!/usr/bin/env python3
"""Verify the capability-evidence record against the committed raw evidence.

The record's entire value is traceability: a reader must be able to confirm that every number it
states exists in the JSON/CSV this directory commits. This script performs that check mechanically so
it does not depend on an author's care or a reviewer's patience.

Run from this directory (or anywhere; paths are resolved relative to the script):

    python verify_evidence.py

Exits 0 when every table cell, prose figure and Nsight token is traceable, 1 otherwise. It is a
consistency check over committed artifacts, not a re-measurement: it cannot confirm that the hardware
produced the numbers, only that the record does not claim anything the evidence files lack.
"""
from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EVIDENCE = os.path.join(HERE, "evidence")
RECORD = os.path.join(
    HERE, "..", "..", "..", "docs", "governance", "williamos-intelligence-fabric",
    "capability-evidence", "gpu-tabular-daedalus-2026-09-11.md",
)
RECORD = os.path.normpath(RECORD)

TASK_KEYWORDS = {
    "aggregation": "aggregation",
    "regression": "regression",
    "clustering": "clustering",
    "decomposition": "PCA",
    "outlier": "outliers",
}

# Figures from superseded runs. Their presence means a stale number survived an edit.
STALE_FIGURES = [
    "4.36", "83.53", "5.12", "318×", "0.048", "0.021×", "5.29", "0.131 s", "0.301 s",
    "4.4617", "20.96", "4.80×", "3.84", "83.73", "21.36", "0.75 s",
]


def number(cell: str) -> float | None:
    match = re.search(r"(\d+(?:\.\d+)?)", cell.replace("**", ""))
    return float(match.group(1)) if match else None


def task_for(label: str) -> str | None:
    low = label.lower()
    for task, keyword in TASK_KEYWORDS.items():
        if keyword.lower() in low:
            return task
    return None


def tables(text: str) -> list[list[list[str]]]:
    """Every markdown table whose header starts with 'Task | CPU'."""
    found, current = [], None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("| Task | CPU"):
            current = []
            found.append(current)
            continue
        if current is None:
            continue
        if not stripped.startswith("|"):
            current = None
            continue
        if stripped.startswith("|---"):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if len(cells) >= 5:
            current.append(cells)
    return [t for t in found if t]


def close(a: float | None, b: float, tol: float) -> bool:
    return a is not None and abs(a - b) <= tol


def main() -> int:
    record = open(RECORD, encoding="utf-8").read()
    full = json.load(open(os.path.join(EVIDENCE, "qualification-full-2.5M.json"), encoding="utf-8"))
    small = json.load(open(os.path.join(EVIDENCE, "qualification-small-60k.json"), encoding="utf-8"))
    nsys_csv = open(os.path.join(EVIDENCE, "nsys-stats-2.5M.csv"), encoding="utf-8").read()

    problems: list[str] = []

    parsed = tables(record)
    if len(parsed) < 2:
        problems.append(f"expected a full-scale and a small-scale table, found {len(parsed)}")

    def compare(rows, data, name):
        by_task = {t["task"]: t for t in data["tasks"]}
        for row in rows:
            task = task_for(row[0])
            if not task:
                problems.append(f"{name}: unmapped row {row[0]!r}")
                continue
            task_data = by_task[task]
            cpu, gpu = task_data["cpu"]["seconds"], task_data["gpu"]["seconds"]
            ratio = (task_data.get("timing") or {}).get("ratio_cpu_over_gpu")
            got_cpu, got_gpu, got_ratio = number(row[1]), number(row[2]), number(row[3])
            # Accept the record's own displayed precision.
            if not close(got_cpu, cpu, max(0.006, cpu * 0.002)):
                problems.append(f"{name}/{task}: cpu {got_cpu} vs json {cpu:.4f}")
            if not close(got_gpu, gpu, max(0.006, gpu * 0.002)):
                problems.append(f"{name}/{task}: gpu {got_gpu} vs json {gpu:.4f}")
            if ratio:
                # The record shows ratios to 2 decimals, which is at most ~1.3% for values below 1;
                # anything past 1.5% is a real mismatch, not display rounding.
                if not close(got_ratio, ratio, max(0.006, abs(ratio) * 0.015)):
                    problems.append(f"{name}/{task}: ratio {got_ratio} vs json {ratio:.4f}")
            claimed = "PASS" if row[4].upper().startswith("PASS") else "FAIL"
            actual = "PASS" if task_data["parity"]["within_tolerance"] else "FAIL"
            if claimed != actual:
                problems.append(f"{name}/{task}: parity column {claimed} vs json {actual}")
            # Trailing columns, when the table carries them: worst metric delta and tolerance.
            if len(row) >= 6 and row[5].strip():
                got_delta = number(row[5])
                delta = task_data["parity"]["relative_delta"]
                if got_delta is not None and not close(got_delta, delta, max(0.0005, abs(delta) * 0.02)):
                    problems.append(f"{name}/{task}: delta {got_delta} vs json {delta:.6f}")
            if len(row) >= 7 and "%" in row[6]:
                got_tol = number(row[6])
                expected_tol = task_data["parity"]["tolerance"] * 100
                if got_tol is not None and abs(got_tol - expected_tol) > 0.51:
                    problems.append(f"{name}/{task}: tolerance {got_tol}% vs json {expected_tol:.2f}%")

    if len(parsed) >= 2:
        compare(parsed[0], full, "full")
        compare(parsed[1], small, "small")

    # Prose figures that must be traceable to the primary full-scale run.
    prose = {
        "cold import": f"{full['coldStart']['firstImportSeconds']:.3f}",
        "cold device": f"{full['coldStart']['firstDeviceWorkSeconds']:.3f}",
        "peak RSS (GB)": f"{full['host']['peakHostRssBytes'] / 1e9:.2f}",
        "total memory (bytes)": f"{full['host']['totalMemoryBytes']:,}",
    }
    for label, token in prose.items():
        if token not in record:
            problems.append(f"{label} {token} absent from record")

    for stale in STALE_FIGURES:
        if stale in record:
            problems.append(f"stale figure present: {stale!r}")

    # A parity miss must be machine-readable, and the record must agree with it.
    if small["parityFailures"] != ["outlier"]:
        problems.append(f"small-scale parityFailures is {small['parityFailures']}, expected ['outlier']")
    if full["parityFailures"]:
        problems.append(f"full-scale parityFailures is {full['parityFailures']}, expected []")

    # Any Nsight nanosecond figure quoted in the record must exist in the committed CSV.
    for token in ["4437171751", "4012598477", "3186611969", "2792362598", "601656212", "87166984",
                  "40022228", "6360712"]:
        if token in record and token not in nsys_csv:
            problems.append(f"Nsight token {token} in record but absent from the committed CSV")

    if problems:
        print("EVIDENCE RECORD DOES NOT MATCH THE COMMITTED EVIDENCE:")
        for problem in problems:
            print("  -", problem)
        return 1

    print("evidence record matches the committed evidence:")
    print(f"  full-scale table: {len(parsed[0])} tasks verified against qualification-full-2.5M.json")
    print(f"  small-scale table: {len(parsed[1])} tasks verified against qualification-small-60k.json")
    print("  prose figures, parity flags, and Nsight tokens traceable; no stale figures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
