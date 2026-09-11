#!/usr/bin/env python3
"""GPU tabular capability qualification — CPU baseline vs cuML/RAPIDS on DAEDALUS.

Doctrine this file follows (WilliamOS Intelligence Fabric):

* IF-05 benchmark matrix (docs/governance/williamos-intelligence-fabric/18-...): measure the
  accelerator, the host<->device transfer, the cold/warm behaviour and the failure path — and report
  derived metrics (transfer-vs-compute share, bytes moved, cold-start share), never a bare speedup.
* Hardware ROI contract (12-...): evidence before hardware; a no-purchase answer is valid; no exact
  gain claim when the measurement is too variable.
* Executable capability inventory (promotion rule): this harness produces MEASURED evidence only.
  It never promotes the capability; promotion is a reviewed owner act.

Workload shape mirrors the real Benton County PACS workload found on aegis (pacs_oltp: ~2.5M
parcel rows, ~2.9M improvement-feature rows, ~97M collection transactions). The VALUES are synthetic
and generated here, so no county/protected data is read, copied or moved. The real-data run is a
separate, owner-authorized action.

Usage:
  python benchmark.py --parcels 2500000 --transactions 50000000 --seed 20260911 --out out/

Tasks (each is a real assessor workload, not a synthetic toy):
  1. aggregation      — collection-transaction rollup per parcel          (cuDF   vs pandas)
  2. regression       — sale-price valuation model                        (cuML   vs sklearn)
  3. clustering       — valuation-zone / comparable grouping              (cuML   vs sklearn)
  4. decomposition    — PCA over parcel features                          (cuML   vs sklearn)
  5. outlier          — sales-ratio anomaly detection (assessor's own work) (cuML vs sklearn)
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
import traceback

import numpy as np

EVIDENCE_SCHEMA = "williamos-gpu-tabular-qualification/1"


# --------------------------------------------------------------------------------------- utilities

def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def gpu_memory_bytes():
    """(free, total) device memory in bytes, or (None, None) when CUDA is unavailable."""
    try:
        import cupy

        free, total = cupy.cuda.runtime.memGetInfo()
        return int(free), int(total)
    except Exception:
        return None, None


def host_memory_bytes():
    try:
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
    except Exception:
        pass
    return None


def host_total_memory_bytes():
    try:
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) * 1024
    except Exception:
        pass
    return None


def peak_host_rss_bytes() -> int | None:
    try:
        import resource

        return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) * 1024
    except Exception:
        return None


def timed(fn):
    """Run fn(), returning (result, wall_seconds, error_string_or_None)."""
    start = time.perf_counter()
    try:
        value = fn()
    except Exception as exc:  # failure behaviour is evidence, never a crash
        return None, time.perf_counter() - start, f"{type(exc).__name__}: {exc}"
    return value, time.perf_counter() - start, None


def version_of(module_name: str) -> str | None:
    try:
        module = __import__(module_name)
        return getattr(module, "__version__", None)
    except Exception:
        return None


def dist_version(distribution_name: str) -> str | None:
    """Installed distribution version, or None. A None is surfaced as a warning, never hidden."""
    try:
        from importlib.metadata import version

        return version(distribution_name)
    except Exception:
        return None


def first_dist_version(*distribution_names: str) -> str | None:
    """First of the given distributions that resolves — packaging names vary by release."""
    for name in distribution_names:
        resolved = dist_version(name)
        if resolved:
            return resolved
    return None


def to_numpy(value):
    """Host NumPy view of a value that may be device-resident.

    Two distinct device paths exist and both refuse implicit conversion:
      * cuDF Series/DataFrame  -> .to_numpy()
      * CuPy ndarray           -> .get()
    np.asarray() on either raises in the installed versions, so each is handled explicitly. Applied
    to every device result in this harness so the pattern cannot silently reappear on one path only.
    """
    if hasattr(value, "to_numpy"):
        return value.to_numpy()
    if (type(value).__module__ or "").split(".")[0] == "cupy" and hasattr(value, "get"):
        return value.get()
    return np.asarray(value)


# ------------------------------------------------------------------------------------ synthetic data

def make_parcels(n_rows: int, rng: np.random.Generator) -> dict:
    """Parcel-level feature matrix, shaped like PACS property_val + improvement features."""
    land = rng.lognormal(mean=11.6, sigma=0.55, size=n_rows).round(0)
    living_area = np.clip(rng.normal(1850, 620, n_rows), 400, 9000).round(0)
    year_built = np.clip(rng.normal(1979, 26, n_rows), 1890, 2025).round(0)
    bedrooms = np.clip(rng.poisson(3.2, n_rows), 1, 9).astype(np.int16)
    bathrooms = np.clip(rng.normal(2.1, 0.8, n_rows), 1, 7).round(1)
    lot_acres = np.clip(rng.lognormal(-1.1, 0.9, n_rows), 0.02, 40).round(3)
    quality = np.clip(rng.normal(3.1, 0.7, n_rows), 1, 5).round(1)
    condition = np.clip(rng.normal(3.3, 0.6, n_rows), 1, 5).round(1)
    neighborhood = rng.integers(1, 420, n_rows).astype(np.int32)
    tax_area = rng.integers(1, 190, n_rows).astype(np.int32)
    improvement = (living_area * quality * 68.0 + rng.normal(0, 24000, n_rows)).round(0)
    assessed_total = (land + improvement).round(0)
    # Sale price: a genuine, learnable signal (so parity between CPU and GPU is a real check).
    sale_price = (
        improvement * 1.12
        + land * 0.94
        + (2025 - year_built) * 690.0 * -1.0
        + bathrooms * 7400.0
        + bedrooms * 3100.0
        + quality * 15500.0
        + rng.normal(0, 31000, n_rows)
    ).round(0)
    sale_price = np.clip(sale_price, 45000, None)
    return {
        "land_value": land,
        "improvement_value": improvement,
        "assessed_total": assessed_total,
        "living_area": living_area,
        "year_built": year_built,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "lot_acres": lot_acres,
        "quality_code": quality,
        "condition_code": condition,
        "neighborhood_code": neighborhood,
        "tax_area": tax_area,
        "sale_price": sale_price,
    }


def make_transactions(n_parcels: int, n_tx: int, rng: np.random.Generator) -> dict:
    """Collection/levy transaction stream shaped like pacs_oltp.coll_transaction."""
    parcel_id = rng.integers(0, n_parcels, n_tx).astype(np.int64)
    amount = rng.lognormal(mean=6.4, sigma=1.15, size=n_tx).round(2)
    tx_type = rng.integers(1, 24, n_tx).astype(np.int16)
    year = rng.integers(2016, 2027, n_tx).astype(np.int16)
    late_flag = (rng.random(n_tx) < 0.19).astype(np.int8)
    return {"parcel_id": parcel_id, "amount": amount, "tx_type": tx_type, "tax_year": year, "late": late_flag}


def write_parquet(path: str, columns: dict) -> int:
    import pandas as pd

    os.makedirs(os.path.dirname(path), exist_ok=True)
    frame = pd.DataFrame(columns)
    frame.to_parquet(path, index=False)
    return os.path.getsize(path)


# ------------------------------------------------------------------------------------------ tasks

def task_aggregation(tx_path: str, cpu_first: bool) -> dict:
    """Collection rollup per parcel — the 100M-row case (cuDF groupby vs pandas)."""
    result = {"task": "aggregation", "workload": "collection-transaction rollup per parcel"}

    def cpu():
        import pandas as pd

        frame = pd.read_parquet(tx_path)
        grouped = frame.groupby("parcel_id", as_index=False).agg(
            total_amount=("amount", "sum"), tx_count=("amount", "size"), late_count=("late", "sum")
        )
        return {
            "rows": int(len(frame)),
            "groups": int(len(grouped)),
            "sum": float(grouped["total_amount"].sum()),
            "max_group_total": float(grouped["total_amount"].max()),
        }

    def gpu():
        import cudf

        frame = cudf.read_parquet(tx_path)
        grouped = frame.groupby("parcel_id", as_index=False).agg(
            {"amount": ["sum", "count"], "late": "sum"}
        )
        totals = to_numpy(grouped.iloc[:, 1].astype("float64"))
        return {
            "rows": int(len(frame)),
            "groups": int(len(grouped)),
            "sum": float(totals.sum()),
            "max_group_total": float(totals.max()),
        }

    order = (cpu, gpu) if cpu_first else (gpu, cpu)
    labels = ("cpu", "gpu") if cpu_first else ("gpu", "cpu")
    observed = {}
    for label, fn in zip(labels, order):
        value, seconds, error = timed(fn)
        # metrics stay at the top level so parity is comparable with the other tasks
        observed[label] = {"seconds": seconds, "error": error, **(value or {})}
    result.update(observed)
    _add_parity(result, observed, keys=["sum", "groups", "max_group_total"])
    return result


def task_regression(parcels_path: str, cpu_first: bool) -> dict:
    """Sale-price valuation model (cuML RandomForestRegressor vs sklearn)."""
    import pandas as pd

    frame = pd.read_parquet(parcels_path)
    features = frame.drop(columns=["sale_price"]).to_numpy(dtype="float32")
    target = frame["sale_price"].to_numpy(dtype="float32")
    result = {"task": "regression", "workload": "sale-price valuation model", "rows": int(len(frame))}

    def cpu():
        from sklearn.ensemble import RandomForestRegressor

        model = RandomForestRegressor(n_estimators=40, max_depth=14, n_jobs=-1, random_state=7)
        model.fit(features, target)
        predictions = model.predict(features[:200000])
        return float(np.sqrt(np.mean((predictions - target[:200000]) ** 2)))

    def gpu():
        from cuml.ensemble import RandomForestRegressor

        model = RandomForestRegressor(n_estimators=40, max_depth=14, random_state=7)
        model.fit(features, target)
        predictions = model.predict(features[:200000])
        predictions = to_numpy(predictions).ravel()
        return float(np.sqrt(np.mean((predictions - target[:200000]) ** 2)))

    order = (cpu, gpu) if cpu_first else (gpu, cpu)
    labels = ("cpu", "gpu") if cpu_first else ("gpu", "cpu")
    observed = {}
    for label, fn in zip(labels, order):
        value, seconds, error = timed(fn)
        observed[label] = {"seconds": seconds, "error": error, "rmse": value}
    result.update(observed)
    _add_parity(result, observed, key="rmse", rel_tolerance=0.30)
    return result


def task_clustering(parcels_path: str, cpu_first: bool) -> dict:
    """Valuation-zone / comparable grouping (cuML KMeans vs sklearn)."""
    import pandas as pd

    frame = pd.read_parquet(parcels_path)
    features = frame.drop(columns=["sale_price"]).to_numpy(dtype="float32")
    result = {"task": "clustering", "workload": "valuation-zone grouping", "rows": int(len(frame))}

    def cpu():
        from sklearn.cluster import KMeans

        model = KMeans(n_clusters=24, n_init=4, random_state=7)
        model.fit(features)
        return float(model.inertia_)

    def gpu():
        from cuml.cluster import KMeans

        model = KMeans(n_clusters=24, n_init=4, random_state=7)
        model.fit(features)
        return float(model.inertia_)

    order = (cpu, gpu) if cpu_first else (gpu, cpu)
    labels = ("cpu", "gpu") if cpu_first else ("gpu", "cpu")
    observed = {}
    for label, fn in zip(labels, order):
        value, seconds, error = timed(fn)
        observed[label] = {"seconds": seconds, "error": error, "inertia": value}
    result.update(observed)
    _add_parity(result, observed, key="inertia", rel_tolerance=0.05)
    return result


def task_decomposition(parcels_path: str, cpu_first: bool) -> dict:
    """PCA over parcel features (cuML PCA vs sklearn)."""
    import pandas as pd

    frame = pd.read_parquet(parcels_path)
    features = frame.drop(columns=["sale_price"]).to_numpy(dtype="float32")
    result = {"task": "decomposition", "workload": "parcel feature PCA", "rows": int(len(frame))}

    def cpu():
        from sklearn.decomposition import PCA

        model = PCA(n_components=8, random_state=7)
        model.fit(features)
        # explained_variance_ratio_ sums to exactly 1.0 by construction, so it can never detect a
        # wrong decomposition. Compare the dominant component's share and the magnitude of the
        # leading variances instead.
        return {
            "pc1_explained_ratio": float(model.explained_variance_ratio_[0]),
            "leading_variance_l2": float(np.linalg.norm(model.explained_variance_)),
        }

    def gpu():
        from cuml.decomposition import PCA

        model = PCA(n_components=8)
        model.fit(features)
        ratio = to_numpy(model.explained_variance_ratio_)
        variance = to_numpy(model.explained_variance_)
        return {
            "pc1_explained_ratio": float(ratio[0]),
            "leading_variance_l2": float(np.linalg.norm(variance)),
        }

    order = (cpu, gpu) if cpu_first else (gpu, cpu)
    labels = ("cpu", "gpu") if cpu_first else ("gpu", "cpu")
    observed = {}
    for label, fn in zip(labels, order):
        value, seconds, error = timed(fn)
        observed[label] = {"seconds": seconds, "error": error, **(value or {})}
    result.update(observed)
    _add_parity(result, observed, keys=["pc1_explained_ratio", "leading_variance_l2"], rel_tolerance=0.02)
    return result


def task_outlier(parcels_path: str, cpu_first: bool) -> dict:
    """Sales-ratio outlier detection — the assessor's own statistical work (cuML vs sklearn)."""
    import pandas as pd

    frame = pd.read_parquet(parcels_path)
    ratio = (frame["assessed_total"] / frame["sale_price"]).to_numpy(dtype="float32")
    features = ratio.reshape(-1, 1)
    result = {"task": "outlier", "workload": "sales-ratio anomaly detection", "rows": int(len(ratio))}

    def cpu():
        from sklearn.ensemble import IsolationForest

        model = IsolationForest(n_estimators=100, random_state=7, n_jobs=-1)
        labels = model.fit_predict(features)
        return int((labels == -1).sum())

    def gpu():
        from cuml.ensemble import IsolationForest

        model = IsolationForest(n_estimators=100, random_state=7)
        labels = model.fit_predict(features)
        labels = to_numpy(labels).ravel()
        return int((labels == -1).sum())

    order = (cpu, gpu) if cpu_first else (gpu, cpu)
    labels_order = ("cpu", "gpu") if cpu_first else ("gpu", "cpu")
    observed = {}
    for label, fn in zip(labels_order, order):
        value, seconds, error = timed(fn)
        observed[label] = {"seconds": seconds, "error": error, "outliers": value}
    result.update(observed)
    _add_parity(result, observed, key="outliers", rel_tolerance=0.35)
    return result


def _add_parity(result: dict, observed: dict, key: str | None = None, rel_tolerance: float = 0.02,
                keys: list | None = None) -> None:
    """Record parity between CPU and GPU, and the honest derived metrics. No bare speedup claim.

    Accepts several metrics at once (keys=) so a task's correctness claim cannot rest on a single
    scalar that is insensitive to a wrong result. The reported delta is the worst of them.
    """
    cpu, gpu = observed.get("cpu"), observed.get("gpu")
    if not cpu or not gpu or cpu.get("error") or gpu.get("error"):
        result["parity"] = {"comparable": False, "reason": "a side failed; see per-side error"}
        return
    metric_keys = list(keys) if keys else [key or "sum"]
    metrics = {}
    worst_delta = 0.0
    for metric in metric_keys:
        cpu_value, gpu_value = cpu.get(metric), gpu.get(metric)
        if cpu_value in (None, 0) or gpu_value is None:
            result["parity"] = {"comparable": False, "reason": f"metric unavailable: {metric}"}
            return
        delta = abs(gpu_value - cpu_value) / abs(cpu_value)
        metrics[metric] = {"cpu": cpu_value, "gpu": gpu_value, "relative_delta": delta}
        worst_delta = max(worst_delta, delta)
    result["parity"] = {
        "metrics": metric_keys,
        "worst_metric": max(metrics, key=lambda name: metrics[name]["relative_delta"]),
        "relative_delta": worst_delta,
        "within_tolerance": worst_delta <= rel_tolerance,
        "tolerance": rel_tolerance,
        "detail": metrics,
    }
    if cpu["seconds"] > 0:
        result["timing"] = {
            "cpu_seconds": cpu["seconds"],
            "gpu_seconds": gpu["seconds"],
            "ratio_cpu_over_gpu": cpu["seconds"] / gpu["seconds"] if gpu["seconds"] > 0 else None,
        }


# ------------------------------------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parcels", type=int, default=2_500_000)
    parser.add_argument("--transactions", type=int, default=20_000_000)
    parser.add_argument("--seed", type=int, default=20260911)
    parser.add_argument("--out", default="out")
    parser.add_argument("--tasks", default="aggregation,regression,clustering,decomposition,outlier")
    parser.add_argument("--keep-data", action="store_true")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    rng = np.random.default_rng(args.seed)

    # Cold start is measured BEFORE anything else imports these modules: resolving the binding
    # below imports cuML (which imports CuPy), so measuring afterwards reports a meaningless ~0 s
    # import cost. Both numbers are real only in this order.
    _, import_seconds, import_error = timed(lambda: __import__("cupy"))

    def _first_device_work():
        import cupy

        array = cupy.arange(1024, dtype="float32")
        return float(cupy.asnumpy(array.sum()))

    _, device_seconds, device_error = timed(_first_device_work)

    evidence = {
        "schemaVersion": EVIDENCE_SCHEMA,
        "startedAt": now_iso(),
        "host": {
            "node": platform.node(),
            "os": f"{platform.system()} {platform.release()}",
            "kernel": platform.version(),
            "python": platform.python_version(),
            "cpuCount": os.cpu_count(),
            "totalMemoryBytes": host_total_memory_bytes(),
        },
        "binding": {
            "runtimeId": "cuml-cu13",
            "runtimeVersion": version_of("cuml"),
            "runtimeDistribution": dist_version("cuml-cu13"),
            "cudfVersion": version_of("cudf"),
            "cupyVersion": version_of("cupy"),
            "sklearnVersion": version_of("sklearn"),
            "numpyVersion": version_of("numpy"),
            "pandasVersion": dist_version("pandas"),
            "cudaRuntimeVersion": first_dist_version("nvidia-cuda-runtime-cu13", "nvidia-cuda-runtime"),
            "cudaToolkitVersion": dist_version("cuda-toolkit"),
            "pythonEnvironment": sys.prefix,
            "computeResourceClass": "local-gpu-tabular",
        },
        "dataset": {"parcels": args.parcels, "transactions": args.transactions, "seed": args.seed,
                    "provenance": "synthetic, schema- and scale-matched to pacs_oltp; no county rows used"},
        "tasks": [],
        "failures": [],
        "warnings": [],
        "promoted": False,
        "note": "MEASURED evidence only. Capability promotion is a reviewed owner act (IF promotion rule).",
    }

    # A binding that silently degrades to nulls is not evidence, so unresolved values are named.
    for field, value in evidence["binding"].items():
        if value is None:
            evidence["warnings"].append(f"binding value unresolved on this host: {field}")

    # Cold-start numbers were captured before any module import above; record them now.
    evidence["coldStart"] = {
        "firstImportSeconds": import_seconds,
        "firstDeviceWorkSeconds": device_seconds,
        "error": device_error or import_error,
    }

    try:
        driver = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version,memory.total,compute_cap", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
        evidence["gpu"] = {"nvidiaSmi": driver}
    except Exception as exc:
        evidence["gpu"] = {"nvidiaSmi": f"unavailable: {exc}"}

    free_bytes, total_bytes = gpu_memory_bytes()
    evidence["gpu"]["freeBytesAtStart"] = free_bytes
    evidence["gpu"]["totalBytes"] = total_bytes

    print(f"[data] generating {args.parcels:,} parcels …", flush=True)
    parcels = make_parcels(args.parcels, rng)
    parcels_path = os.path.join(args.out, "parcels.parquet")
    write_seconds_start = time.perf_counter()
    parcel_bytes = write_parquet(parcels_path, parcels)
    evidence["dataset"]["parcelBytes"] = parcel_bytes
    del parcels

    transactions = make_transactions(args.parcels, args.transactions, rng)
    tx_path = os.path.join(args.out, "transactions.parquet")
    tx_bytes = write_parquet(tx_path, transactions)
    evidence["dataset"]["transactionBytes"] = tx_bytes
    evidence["dataset"]["generationSeconds"] = time.perf_counter() - write_seconds_start
    del transactions
    print(f"[data] parcels={parcel_bytes/1e6:.1f}MB transactions={tx_bytes/1e6:.1f}MB", flush=True)

    plan = [name.strip() for name in args.tasks.split(",") if name.strip()]
    for name in plan:
        print(f"[task] {name} …", flush=True)
        cpu_first = name not in {"regression", "clustering"}  # alternate order to expose warm-cache bias
        free_before_task, _ = gpu_memory_bytes()
        try:
            if name == "aggregation":
                record = task_aggregation(tx_path, cpu_first)
            elif name == "regression":
                record = task_regression(parcels_path, cpu_first)
            elif name == "clustering":
                record = task_clustering(parcels_path, cpu_first)
            elif name == "decomposition":
                record = task_decomposition(parcels_path, cpu_first)
            elif name == "outlier":
                record = task_outlier(parcels_path, cpu_first)
            else:
                continue
        except Exception as exc:
            record = {"task": name, "error": f"{type(exc).__name__}: {exc}", "traceback": traceback.format_exc()[-1500:]}
            evidence["failures"].append(record)
        record["peakHostRssBytes"] = peak_host_rss_bytes()
        record["freeVramBytesBefore"] = free_before_task
        free_after, _ = gpu_memory_bytes()
        record["freeVramBytesAfter"] = free_after
        evidence["tasks"].append(record)
        parity = record.get("parity") or {}
        print(f"        parity={parity.get('within_tolerance')} delta={parity.get('relative_delta')}", flush=True)

    # A parity miss is a machine-readable outcome, not something a reader must infer from a nested
    # flag: a run can honestly report failures:[] and still have a task outside its tolerance.
    evidence["parityFailures"] = sorted(
        task["task"] for task in evidence["tasks"]
        if isinstance(task.get("parity"), dict) and task["parity"].get("within_tolerance") is False
    )
    evidence["finishedAt"] = now_iso()
    evidence["host"]["peakHostRssBytes"] = peak_host_rss_bytes()
    evidence["host"]["availableMemoryBytes"] = host_memory_bytes()
    if not args.keep_data:
        for path in (parcels_path, tx_path):
            try:
                os.remove(path)
            except OSError:
                pass
    out_path = os.path.join(args.out, "qualification.json")
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(evidence, handle, indent=2)
    print(f"[evidence] {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
