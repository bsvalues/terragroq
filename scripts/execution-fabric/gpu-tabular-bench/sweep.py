#!/usr/bin/env python3
"""Synthetic scale sweep: derive conservative CPU<->GPU crossover thresholds for DAEDALUS cuML.

Two measured points (60k, 2.5M) proved that size matters. They cannot tell HERMES where to switch.
This script measures the placement curve so the switch point is derived from data instead of guessed.

It deliberately REUSES the reviewed task functions and generators from benchmark.py rather than
reimplementing them, so the curve is measured by the same code that produced the qualification
evidence.

For each requested size it runs the requested tasks (CPU and GPU) and records, per task:
  * CPU and GPU seconds, and the CPU/GPU ratio
  * correctness parity against the task's own declared tolerance
Then it derives, per task, a conservative threshold:

  gpu_preferred_above_rows = the SMALLEST measured size at which the GPU wins by at least `--margin`
                             AND parity passes at that size and at EVERY larger measured size
  cpu_preferred_rows       = the LARGEST measured size at which the CPU still wins

A task whose evidence never reaches the margin is reported as `insufficient_evidence` with the CPU
path as the default. That is the honest outcome when the curve does not justify a switch, and it is
the safe one for placement.

Usage:
  python sweep.py --sizes 50000,100000,250000,500000,1000000,2500000 --out sweep
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from benchmark import (  # noqa: E402  (reuse the reviewed, evidence-producing code)
    make_parcels,
    make_transactions,
    now_iso,
    task_aggregation,
    task_clustering,
    task_regression,
    warm_runtimes,
    write_parquet,
)

SWEEP_SCHEMA = "williamos-gpu-tabular-placement-curve/1"

TASK_SPECS = {
    "regression": {"rows_label": "parcels", "tolerance_sensitive": True},
    "clustering": {"rows_label": "parcels", "tolerance_sensitive": True},
    "aggregation": {"rows_label": "transactions", "tolerance_sensitive": True},
}


def run_one_size(size: int, tx_per_parcel: int, tasks: list[str], out_dir: str, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    record: dict = {"parcels": size, "transactions": size * tx_per_parcel, "tasks": {}}

    t0 = time.perf_counter()
    parcels_path = os.path.join(out_dir, f"parcels-{size}.parquet")
    write_parquet(parcels_path, make_parcels(size, rng))
    tx_path = os.path.join(out_dir, f"transactions-{size}.parquet")
    write_parquet(tx_path, make_transactions(size, size * tx_per_parcel, rng))
    record["generationSeconds"] = time.perf_counter() - t0

    for task in tasks:
        if task == "regression":
            result = task_regression(parcels_path, cpu_first=True)
        elif task == "clustering":
            result = task_clustering(parcels_path, cpu_first=True)
        elif task == "aggregation":
            result = task_aggregation(tx_path, cpu_first=True)
        else:
            continue
        parity = result.get("parity") or {}
        timing = result.get("timing") or {}
        record["tasks"][task] = {
            "cpuSeconds": (result.get("cpu") or {}).get("seconds"),
            "gpuSeconds": (result.get("gpu") or {}).get("seconds"),
            "ratioCpuOverGpu": timing.get("ratio_cpu_over_gpu"),
            "parityWithinTolerance": parity.get("within_tolerance"),
            "parityDelta": parity.get("relative_delta"),
            "parityTolerance": parity.get("tolerance"),
            "cpuError": (result.get("cpu") or {}).get("error"),
            "gpuError": (result.get("gpu") or {}).get("error"),
        }
        print(f"    {task:12s} cpu={record['tasks'][task]['cpuSeconds']:.3f}s "
              f"gpu={record['tasks'][task]['gpuSeconds']:.3f}s "
              f"ratio={record['tasks'][task]['ratioCpuOverGpu']:.3f} "
              f"parity={record['tasks'][task]['parityWithinTolerance']}", flush=True)

    for path in (parcels_path, tx_path):
        try:
            os.remove(path)
        except OSError:
            pass
    return record


def derive_thresholds(sizes: list[int], per_size: list[dict], tasks: list[str], margin: float) -> dict:
    """Conservative per-task crossover, derived only from what was measured."""
    derived: dict = {}
    for task in tasks:
        points = []
        for size, record in zip(sizes, per_size):
            entry = record["tasks"].get(task)
            if not entry:
                continue
            points.append((size, entry))
        # Points where the answer is both faster on GPU by the margin and actually correct.
        eligible = [size for size, e in points
                    if e.get("ratioCpuOverGpu") and e["ratioCpuOverGpu"] >= 1.0 + margin
                    and e.get("parityWithinTolerance") is True]
        cpu_wins = [size for size, e in points
                    if e.get("ratioCpuOverGpu") and e["ratioCpuOverGpu"] < 1.0]
        measured = [size for size, _ in points]

        threshold = None
        at_floor = False
        if eligible:
            candidate = min(eligible)
            # The winner must hold at every measured size at or above the candidate.
            larger = [size for size in measured if size >= candidate]
            if all(size in eligible for size in larger):
                threshold = candidate
                at_floor = (candidate == min(measured))

        derived[task] = {
            "measuredSizes": measured,
            "gpuPreferredAboveRows": threshold,
            "cpuPreferredAtOrBelowRows": max(cpu_wins) if cpu_wins else None,
            "insufficientEvidence": threshold is None,
            "thresholdIsAtMeasurementFloor": at_floor,
            "placementDefaultWhenBelowThreshold": "cpu",
            "marginRequired": margin,
            "note": ("no measured size reaches the required margin with passing parity; keep this "
                     "task on the CPU path and measure more sizes before switching"
                     if threshold is None else
                     "threshold equals the smallest measured size: the true crossover is at or below "
                     "it and is UNMEASURED there, so the CPU default below the threshold is a "
                     "conservative choice, not a measured one"
                     if at_floor else
                     "threshold holds at the candidate size and every larger measured size"),
        }
    return derived


def rederive(curve_path: str, margin: float | None = None) -> dict:
    """Recompute thresholds from an existing curve — the measurements are not repeated."""
    document = json.load(open(curve_path, encoding="utf-8"))
    sizes = [point["parcels"] for point in document["points"]]
    tasks = list(document["points"][0]["tasks"].keys()) if document["points"] else []
    document["thresholds"] = derive_thresholds(sizes, document["points"], tasks,
                                               margin if margin is not None else document.get("marginRequired", 0.25))
    if margin is not None:
        document["marginRequired"] = margin
    return document


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", default="50000,100000,250000,500000,1000000,2500000")
    parser.add_argument("--tx-per-parcel", type=int, default=8)
    parser.add_argument("--tasks", default="regression,clustering,aggregation")
    parser.add_argument("--margin", type=float, default=0.25,
                        help="fractional margin the GPU must beat the CPU by to be preferred")
    parser.add_argument("--seed", type=int, default=20260911)
    parser.add_argument("--out", default="sweep")
    parser.add_argument("--rederive-from", default=None,
                        help="recompute thresholds from an existing placement-curve.json (no re-measure)")
    args = parser.parse_args()

    if args.rederive_from:
        document = rederive(args.rederive_from, args.margin)
        with open(args.rederive_from, "w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=2)
        print(f"[thresholds re-derived from {args.rederive_from}]")
        for task, entry in document["thresholds"].items():
            print(f"    {task:12s} gpu above {entry['gpuPreferredAboveRows']} rows "
                  f"(atMeasurementFloor={entry['thresholdIsAtMeasurementFloor']})")
        return 0

    sizes = [int(s) for s in args.sizes.split(",") if s.strip()]
    tasks = [t.strip() for t in args.tasks.split(",") if t.strip()]
    for task in tasks:
        if task not in TASK_SPECS:
            print(f"unknown task: {task}", file=sys.stderr)
            return 2

    raw_dir = os.path.join(args.out, "data")
    os.makedirs(raw_dir, exist_ok=True)
    curve_path = os.path.join(args.out, "placement-curve.json")

    document = {
        "schemaVersion": SWEEP_SCHEMA,
        "startedAt": now_iso(),
        "seed": args.seed,
        "transactionsPerParcel": args.tx_per_parcel,
        "marginRequired": args.margin,
        "provenance": "synthetic, schema- and scale-matched to pacs_oltp; no county rows used",
        "promoted": False,
        "points": [],
    }

    per_size: list[dict] = []

    # Warm the device families once, before any size is timed, so every point on the curve is measured
    # from the same warm state. Without this the first size's first task absorbs import + CUDA context
    # + first-call costs and the derived threshold is drawn from a contaminated point (observed: the
    # 50k regression point looked slower than the 100k one).
    document["warmUpSeconds"] = warm_runtimes()
    print(f"[warmup] {document['warmUpSeconds']:.3f}s", flush=True)

    for size in sizes:
        print(f"[size] {size:,}", flush=True)
        record = run_one_size(size, args.tx_per_parcel, tasks, raw_dir, args.seed)
        per_size.append(record)
        document["points"].append(record)
        # Write after every size so a long sweep survives interruption.
        with open(curve_path, "w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=2)

    document["thresholds"] = derive_thresholds(sizes, per_size, tasks, args.margin)
    document["finishedAt"] = now_iso()
    with open(curve_path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)

    print("[thresholds]")
    for task, entry in document["thresholds"].items():
        print(f"    {task:12s} gpu above {entry['gpuPreferredAboveRows']} rows "
              f"(insufficient_evidence={entry['insufficientEvidence']})")
    print(f"[curve] {curve_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())