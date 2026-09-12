#!/usr/bin/env python3
"""Resident GPU-tabular worker — executes one reviewed workload on one device, as JSON in / JSON out.

Runs inside the reviewed DAEDALUS environment (/home/daedalus/.venvs/cuml-qual) via the existing
fabric SSH transport, invoked by scripts/execution-fabric/gpu-tabular-dispatch.mjs. The compute
itself comes from gpu_tabular_workload.py — the SAME module the qualification harness imports —
so a dispatched job cannot diverge from what was measured.

Protocol (stdin: one JSON request, stdout: one JSON result):
  request  = {"schemaVersion": 1, "action": "health" | "run",
              "jobId": "...", "workload": "regression|clustering|aggregation|...",
              "device": "cpu" | "cuda",
              "synthetic": {"parcels": int, "transactions": int, "seed": int},
              "cancelFile": "/abs/path", "scratchDir": "/abs/path"}

Only synthetic generation is supported: the source of a job's data is the reviewed generator at a
declared shape and seed. There is no database-connection code path in this file at all.

Exit codes: 0 SUCCEEDED, 1 request invalid, 2 FAILED (workload error), 3 CANCELLED, 4 health
reported with the device unavailable (still valid JSON).
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from gpu_tabular_workload import execute  # noqa: E402

CANCEL_POLL_SECONDS = 0.25


def emit(payload: dict, code: int, result_file: str | None = None) -> int:
    text = json.dumps(payload, default=str)
    if result_file:
        # Written FIRST: a lost SSH channel must not lose a completed result (the dispatcher adopts
        # this file during recovery instead of recomputing). Never written for CANCELLED.
        os.makedirs(os.path.dirname(result_file), exist_ok=True)
        with open(result_file, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
    sys.stdout.write(text + "\n")
    sys.stdout.flush()
    return code


def clean_data(request: dict) -> None:
    """Remove generated parquet, keep the scratch dir and its result file for the dispatcher."""
    for name in ("parcels.parquet", "transactions.parquet"):
        candidate = os.path.join(request["scratchDir"], name)
        try:
            os.remove(candidate)
        except OSError:
            pass


def cancelled(cancel_file: str | None) -> bool:
    return bool(cancel_file) and os.path.exists(cancel_file)


def binding_health() -> dict:
    """Report the reviewed binding as actually observed right now, never as configured intent."""
    health = {"schemaVersion": 1, "action": "health", "ok": False, "python": sys.version.split()[0]}
    try:
        import cuml

        health["cumlVersion"] = getattr(cuml, "__version__", None)
    except Exception as exc:  # noqa: BLE001
        health["cumlError"] = f"{type(exc).__name__}: {exc}"
    cudf_version = None
    try:
        import cudf

        cudf_version = getattr(cudf, "__version__", None)
    except Exception as exc:  # noqa: BLE001
        health["cudfError"] = f"{type(exc).__name__}: {exc}"
    health["cudfVersion"] = cudf_version

    free_bytes = total_bytes = None
    try:
        import subprocess

        smi = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=15, check=True,
        )
        free_mib, total_mib = (int(float(value)) for value in smi.stdout.strip().splitlines()[0].split(","))
        free_bytes, total_bytes = free_mib * 1024 * 1024, total_mib * 1024 * 1024
        health["deviceQuerySucceeded"] = True
    except Exception as exc:  # noqa: BLE001 - a failed query must NOT read as healthy
        health["deviceQuerySucceeded"] = False
        health["deviceError"] = f"{type(exc).__name__}: {exc}"
    health["deviceFreeBytes"] = free_bytes
    health["deviceTotalBytes"] = total_bytes

    cupy_ok = False
    if health["deviceQuerySucceeded"]:
        try:
            import cupy

            array = cupy.arange(8, dtype="float32")
            cupy_ok = float(array.sum()) == 28.0
        except Exception as exc:  # noqa: BLE001
            health["cupyError"] = f"{type(exc).__name__}: {exc}"
    health["deviceComputeOk"] = cupy_ok
    # A device is healthy only if the query succeeded AND a real compute round-trip worked.
    health["deviceHealthy"] = bool(health["deviceQuerySucceeded"] and cupy_ok)
    health["ok"] = True  # the health REPORT itself succeeded; deviceHealthy carries the verdict
    return health


def generate_synthetic(request: dict, cancel_file: str | None) -> dict:
    """Produce the job's parquet inputs with the reviewed generators. Synthetic only."""
    from benchmark import make_parcels, make_transactions, write_parquet  # reviewed generators

    synthetic = request["synthetic"]
    parcels = int(synthetic["parcels"])
    transactions = int(synthetic.get("transactions") or parcels * int(synthetic.get("transactionsPerParcel", 8)))
    seed = int(synthetic["seed"])
    scratch = request["scratchDir"]
    os.makedirs(scratch, exist_ok=True)
    rng = np.random.default_rng(seed)
    started = time.perf_counter()
    paths = {}
    if request["workload"] == "aggregation":
        paths["tx"] = os.path.join(scratch, "transactions.parquet")
        write_parquet(paths["tx"], make_transactions(parcels, transactions, rng))
    else:
        paths["parcels"] = os.path.join(scratch, "parcels.parquet")
        write_parquet(paths["parcels"], make_parcels(parcels, rng))
    return {"paths": paths, "generationSeconds": time.perf_counter() - started,
            "parcels": parcels, "transactions": transactions, "seed": seed}


def run_job(request: dict) -> int:
    required = ("jobId", "workload", "device", "synthetic", "scratchDir")
    missing = [field for field in required if field not in request]
    if missing:
        return emit({"status": "INVALID", "missing": missing}, 1)
    workload = request["workload"]
    device = request["device"]
    result_file = request.get("resultFile")
    if device not in ("cpu", "cuda"):
        return emit({"status": "INVALID", "detail": "device must be cpu|cuda"}, 1)
    if workload not in ("regression", "clustering", "aggregation", "decomposition", "outlier"):
        return emit({"status": "INVALID", "detail": f"unknown workload {workload!r}"}, 1)
    cancel_file = request.get("cancelFile")
    if cancelled(cancel_file):
        return emit({"status": "CANCELLED", "phase": "before-start"}, 3)

    started = time.perf_counter()
    try:
        generated = generate_synthetic(request, cancel_file)
    except Exception as exc:  # noqa: BLE001
        return emit({"status": "FAILED", "phase": "generation",
                     "error": f"{type(exc).__name__}: {exc}"}, 2, result_file)
    if cancelled(cancel_file):
        clean_data(request)
        return emit({"status": "CANCELLED", "phase": "after-generation"}, 3)

    try:
        result = execute(
            workload, device,
            parcels_path=generated["paths"].get("parcels"),
            tx_path=generated["paths"].get("tx"),
        )
    except Exception as exc:  # noqa: BLE001
        clean_data(request)
        outcome = {"status": "FAILED", "phase": "execute", "error": f"{type(exc).__name__}: {exc}"}
        if device == "cuda":
            # A device-side failure is exactly what the bounded CPU fallback is for; the dispatcher
            # decides, the worker only reports. Mark the device suspect.
            outcome["deviceSuspect"] = True
        return emit(outcome, 2, result_file)

    elapsed = time.perf_counter() - started
    if cancelled(cancel_file):
        # The artifact check above runs before the result is declared: a cancelled job that still
        # emits a result is not a cancellation. No result file is written, so recovery can never
        # adopt an output for cancelled work.
        clean_data(request)
        return emit({"status": "CANCELLED", "phase": "after-execute-discarded"}, 3)

    clean_data(request)
    return emit({
        "status": "SUCCEEDED",
        "workload": workload,
        "device": device,
        "value": result["value"],
        "workloadSeconds": result["seconds"],
        "totalSeconds": elapsed,
        "dataset": {key: generated[key] for key in ("parcels", "transactions", "seed", "generationSeconds")},
        "binding": binding_health(),
        "syntheticDataOnly": True,
        "promoted": False,
    }, 0, result_file)


def main() -> int:
    # SIGTERM arrives from the job wrapper when the dispatcher cancels: report a clean CANCELLED
    # result on the channel (no result file — cancelled work must never produce adoptable output),
    # then die; the CUDA context dies with the process (the proven device-release path).
    def _terminate(_signum, _frame):
        try:
            sys.stdout.write(json.dumps({"status": "CANCELLED", "phase": "signal-term",
                                         "syntheticDataOnly": True}) + "\n")
            sys.stdout.flush()
        except Exception:  # noqa: BLE001 - best effort before hard exit
            pass
        os._exit(3)

    signal.signal(signal.SIGTERM, _terminate)

    try:
        request = json.loads(sys.stdin.read())
    except Exception as exc:  # noqa: BLE001
        return emit({"status": "INVALID", "detail": f"unparseable request: {exc}"}, 1)
    if request.get("schemaVersion") != 1:
        return emit({"status": "INVALID", "detail": "schemaVersion must be 1"}, 1)
    if request.get("action") == "health":
        health = binding_health()
        return emit(health, 0 if health["deviceHealthy"] else 4)
    if request.get("action") == "run":
        return run_job(request)
    return emit({"status": "INVALID", "detail": "action must be health|run"}, 1)


if __name__ == "__main__":
    sys.exit(main())
