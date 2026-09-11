#!/usr/bin/env python3
"""Verify the capability-evidence record against the committed raw evidence.

The record's entire value is traceability: a reader must be able to confirm that every number it
states exists in the JSON/CSV this directory commits. This script performs that check mechanically so
it does not depend on an author's care or a reviewer's patience.

Run from this directory (or anywhere; paths are resolved relative to the script):

    python verify_evidence.py

Exits 0 when every checked figure is traceable, 1 otherwise. What is checked:

  * both results tables, cell by cell — seconds, ratio, parity flag, worst-metric delta, tolerance;
  * the prose cold-start / peak-RSS / memory figures drawn from the primary run;
  * the placement-thresholds record against the committed placement curve (points and derived block);
  * a superseded-figure scan over current claims;
  * evidence-artifact integrity: required files present, and no artifact claiming `promoted: true` —
    a JSON cannot promote itself, promotion is a reviewed registry transition.

It FAILS CLOSED. If the thresholds record or the placement curve is absent, verification fails instead
of skipping that check: a checker that reports success for missing evidence is worse than no checker,
because placement thresholds would then be trusted without being verifiable.

Deliberately NOT checked: section-5 prose ratios and the section-4 Nsight figures, which live in the CSV
rather than the JSONs. The superseded-figure scan exempts correction tables and "earlier revisions
reported X" prose, so documenting superseded values is not punished.

It is a consistency check over committed artifacts, not a re-measurement: it cannot confirm the hardware
produced the numbers, only that the record claims nothing the evidence files lack.
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
THRESHOLDS_RECORD = os.path.normpath(os.path.join(
    HERE, "..", "..", "..", "docs", "governance", "williamos-intelligence-fabric",
    "capability-evidence", "gpu-tabular-placement-thresholds-2026-09-11.md",
))
CURVE = os.path.join(EVIDENCE, "placement-curve.json")

TASK_KEYWORDS = {
    "aggregation": "aggregation",
    "regression": "regression",
    "clustering": "clustering",
    "decomposition": "PCA",
    "outlier": "outliers",
}

# Figures from superseded runs. Their presence means a stale number survived an edit.
#
# This list must be maintained as the evidence is corrected: each entry was a real published figure
# that later measurement invalidated. The first group is the cold-contaminated revision (one-off setup
# charged to whichever task ran first); the second is the earlier single-scale revision.
STALE_FIGURES = [
    # cold-contaminated revision (superseded by the warm-up methodology)
    "4.82×", "83.70", "20.98", "0.39×", "323×", "5.20 GB", "0.126 s", "0.276 s",
    "0.047×", "0.020×", "27.6×", "1.20×", "2.47×", "0.00098",
    # earlier revision (single scale, before the two-run reproducibility pair)
    "5.12", "19.87", "4.86×", "0.048", "0.021×", "318×", "310×", "4.4617",
]


def number(cell: str) -> float | None:
    cleaned = cell.replace("**", "").replace(",", "")
    match = re.search(r"(\d+(?:\.\d+)?)", cleaned)
    return float(match.group(1)) if match else None


def current_claims(text: str) -> str:
    """The part of a record that asserts CURRENT results.

    A correction table deliberately cites the superseded values it replaces, and prose that says
    "earlier revisions reported X" is doing the same. Those citations must not be flagged as stale
    claims, or the stale-figure scan punishes exactly the transparency it exists to encourage.
    """
    marker = "## Correction"
    for candidate in ("## Correction to", "## Correction"):
        idx = text.find(candidate)
        if idx != -1:
            text = text[:idx]
            break
    historical = ("earlier revision", "previously published", "superseded", "corrected (warm)")
    kept = [line for line in text.splitlines()
            if not any(word in line.lower() for word in historical)]
    return "\n".join(kept)


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


def verify_thresholds_record(problems: list[str]) -> int:
    """Check the placement-thresholds record against the committed placement curve.

    Returns the number of tasks verified (0 when the record or curve is absent, so this stays optional
    for checkouts that predate it).
    """
    if not (os.path.exists(THRESHOLDS_RECORD) and os.path.exists(CURVE)):
        # FAIL CLOSED. The thresholds record and the curve it cites are part of the committed artifact
        # set; if either is absent the threshold claims are unverifiable, and silently skipping the
        # check would report success for evidence that is not there. This is the difference between a
        # verifier and a decoration — HERMES must not rely on placement thresholds the checker cannot
        # confirm.
        for path in (THRESHOLDS_RECORD, CURVE):
            if not os.path.exists(path):
                problems.append(
                    f"required threshold evidence missing: {os.path.basename(path)} — verification "
                    f"FAILS CLOSED rather than skipping the check"
                )
        return 0
    record = open(THRESHOLDS_RECORD, encoding="utf-8").read()
    curve = json.load(open(CURVE, encoding="utf-8"))
    thresholds = curve.get("thresholds") or {}

    # The curve table in the record must match the measured points.
    lines = record.splitlines()
    for i, line in enumerate(lines):
        if line.strip().startswith("| Rows |"):
            for row in lines[i + 2:]:
                if not row.strip().startswith("|"):
                    break
                cells = [c.strip() for c in row.strip().strip("|").split("|")]
                if len(cells) < 4:
                    continue
                size = number(cells[0])
                if size is None:
                    continue
                point = next((p for p in curve["points"] if p["parcels"] == int(size)), None)
                if not point:
                    problems.append(f"thresholds record: size {int(size)} not in the committed curve")
                    continue
                for cell, task in zip(cells[1:4], ("regression", "clustering", "aggregation")):
                    got, want = number(cell), point["tasks"][task]["ratioCpuOverGpu"]
                    if got is None or not close(got, want, max(0.006, abs(want) * 0.015)):
                        problems.append(f"thresholds record: {task} @{int(size)} claims {got}, curve has {want:.4f}")
            break

    # The derived threshold table must match the derived block.
    verified = 0
    for i, line in enumerate(lines):
        if line.strip().startswith("| Task |") and "GPU-preferred" in line:
            for row in lines[i + 2:]:
                if not row.strip().startswith("|"):
                    break
                cells = [c.strip() for c in row.strip().strip("|").split("|")]
                if len(cells) < 4:
                    continue
                task = task_for(cells[0])
                entry = thresholds.get(task or "")
                if not entry:
                    problems.append(f"thresholds record: row {cells[0]!r} has no derived threshold")
                    continue
                claimed = number(cells[1])
                want = entry["gpuPreferredAboveRows"]
                if want is None:
                    problems.append(f"thresholds record: {task} states a threshold but the curve says insufficientEvidence")
                elif claimed is None or abs(claimed - want) > 1:
                    problems.append(f"thresholds record: {task} threshold {claimed} vs curve {want}")
                floor_claimed = "yes" in cells[2].replace("*", "").strip().lower()
                if floor_claimed != bool(entry["thresholdIsAtMeasurementFloor"]):
                    problems.append(f"thresholds record: {task} floor flag {floor_claimed} vs curve "
                                    f"{entry['thresholdIsAtMeasurementFloor']}")
                verified += 1
            break

    if verified == 0:
        problems.append("thresholds record: could not parse the derived-threshold table")
    return verified


def main() -> int:
    record = open(RECORD, encoding="utf-8").read()
    full = json.load(open(os.path.join(EVIDENCE, "qualification-full-2.5M.json"), encoding="utf-8"))
    small = json.load(open(os.path.join(EVIDENCE, "qualification-small-60k.json"), encoding="utf-8"))

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

    # Evidence artifacts are INPUTS to a reviewed transition, never the transition itself. An artifact
    # that says `promoted: true` is asserting an authority it does not have, so it is rejected: the
    # traceable source of a promotion is the machine-registry state change, not a field in a JSON.
    for name in ("qualification-full-2.5M.json", "qualification-full-2.5M-run2.json",
                 "qualification-small-60k.json", "placement-curve.json",
                 "live-cancellation-proof.json"):
        path = os.path.join(EVIDENCE, name)
        if not os.path.exists(path):
            problems.append(f"required evidence file missing: {name}")
            continue
        try:
            data = json.load(open(path, encoding="utf-8"))
        except Exception as exc:
            problems.append(f"{name}: unreadable ({exc})")
            continue
        if data.get("promoted") is not False:
            problems.append(
                f"{name}: promoted={data.get('promoted')!r} — an evidence artifact cannot promote "
                f"itself; promotion is a reviewed registry transition"
            )

    thresholds_text = open(THRESHOLDS_RECORD, encoding="utf-8").read() if os.path.exists(THRESHOLDS_RECORD) else ""
    for stale in STALE_FIGURES:
        if stale in current_claims(record):
            problems.append(f"stale figure present in the qualification record: {stale!r}")
        if thresholds_text and stale in current_claims(thresholds_text):
            problems.append(f"stale figure present in the thresholds record: {stale!r}")

    # A parity miss must be machine-readable, and the record must agree with it.
    if small["parityFailures"] != ["outlier"]:
        problems.append(f"small-scale parityFailures is {small['parityFailures']}, expected ['outlier']")
    if full["parityFailures"]:
        problems.append(f"full-scale parityFailures is {full['parityFailures']}, expected []")

    # The Nsight figures quoted in the record are seconds/shares, and they live in the CSV rather than
    # in the JSONs. They are NOT checked here (see the README); an earlier ns-nanosecond token loop was
    # dead code and has been removed rather than left implying coverage that never fired.

    thresholds_verified = verify_thresholds_record(problems)

    if problems:
        print("EVIDENCE RECORD DOES NOT MATCH THE COMMITTED EVIDENCE:")
        for problem in problems:
            print("  -", problem)
        return 1

    print("evidence record matches the committed evidence:")
    print(f"  full-scale table: {len(parsed[0])} tasks verified against qualification-full-2.5M.json")
    print(f"  small-scale table: {len(parsed[1])} tasks verified against qualification-small-60k.json")
    if thresholds_verified:
        print(f"  placement thresholds: {thresholds_verified} tasks verified against placement-curve.json")
    print("  table cells (seconds, ratio, parity, delta, tolerance), prose cold-start/RSS/memory figures,")
    print("  evidence-artifact integrity (all required files present, none self-promoting),")
    print("  and superseded-figure scan all clean.")
    print("  NOT checked here: section-5 prose ratios and the section-4 Nsight figures in the CSV.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
