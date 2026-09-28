"""Behavior-preservation check for the workload extraction refactor.

Runs the refactored pair-runner task functions (benchmark.py, which now delegates bodies to
gpu_tabular_workload.py) at a small synthetic scale and compares the RESULT STRUCTURE and
parity mechanics against the committed small-scale evidence shape. Timing values differ by
nature; shapes, keys, metric sets, and parity tolerance semantics must not.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from benchmark import (  # noqa: E402
    make_parcels, make_transactions, task_aggregation, task_clustering,
    task_decomposition, task_outlier, task_regression, write_parquet,
)

OUT = os.path.join(HERE, "refactor-check")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(20260911)
rows = 60_000

parcels_path = os.path.join(OUT, "parcels.parquet")
write_parquet(parcels_path, make_parcels(rows, rng))
tx_path = os.path.join(OUT, "transactions.parquet")
write_parquet(tx_path, make_transactions(rows, rows * 8, rng))

records = [
    task_aggregation(tx_path, cpu_first=True),
    task_regression(parcels_path, cpu_first=False),
    task_clustering(parcels_path, cpu_first=False),
    task_decomposition(parcels_path, cpu_first=True),
    task_outlier(parcels_path, cpu_first=True),
]

committed = json.load(open(os.path.join(HERE, "evidence", "qualification-small-60k.json")))
problems = []
by_task = {rec.get("task"): rec for rec in records}
for committed_task in committed["tasks"]:
    name = committed_task.get("task")
    produced = by_task.get(name)
    if produced is None:
        problems.append(f"missing task {name}")
        continue
    # Every measured metric the committed record carries must still be produced, with parity over
    # the same metric set.
    for side in ("cpu", "gpu"):
        if side not in produced:
            problems.append(f"{name}: missing side {side}")
            continue
        for metric, value in (committed_task.get(side) or {}).items():
            if metric in ("seconds", "error"):
                continue
            if metric not in produced[side]:
                problems.append(f"{name}.{side}: metric {metric} no longer produced")
    cp = committed_task.get("parity") or {}
    pp = produced.get("parity") or {}
    if bool(cp.get("metrics", [])) and sorted(cp["metrics"]) != sorted(pp.get("metrics", [])):
        problems.append(f"{name}: parity metric set changed {cp['metrics']} -> {pp.get('metrics')}")
    if bool(cp.get("tolerance")) and cp.get("tolerance") != pp.get("tolerance"):
        problems.append(f"{name}: parity tolerance changed {cp.get('tolerance')} -> {pp.get('tolerance')}")
    if pp.get("comparable") is False:
        problems.append(f"{name}: parity not comparable: {pp.get('reason')}")

print(json.dumps({
    "ok": not problems,
    "problems": problems,
    "parity": {
        name: {
            "comparable": rec.get("parity", {}).get("comparable", True),
            "worstDelta": rec.get("parity", {}).get("relative_delta"),
            "tolerance": rec.get("parity", {}).get("tolerance"),
        } for name, rec in by_task.items()
    },
}, indent=2))
sys.exit(0 if not problems else 1)
